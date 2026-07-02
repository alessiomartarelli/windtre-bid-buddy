import type { Express, Request, Response, NextFunction } from "express";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import crypto from "crypto";
import { promisify } from "util";

const gzipAsync = promisify(zlib.gzip);
const brotliAsync = promisify(zlib.brotliCompress);

interface CacheEntry {
  raw: Buffer;
  gz: Buffer | null;
  br: Buffer | null;
  etag: string;
  mtimeMs: number;
  size: number;
}

const COMPRESSIBLE = /\.(html|js|mjs|css|json|map|svg|txt|xml|wasm|webmanifest)$/i;
const MIN_GZIP_BYTES = 256;
const MAX_GZIP_BYTES = 8 * 1024 * 1024;
// Soglia oltre la quale un file binario non compressibile (immagine,
// font, video, pdf, ecc.) NON viene tenuto in memoria: lo serviamo
// streaming via `fs.createReadStream` per evitare di caricare in RAM
// asset potenzialmente grossi (es. video). I bundle Vite e gli altri
// file compressibili passano comunque per la cache (gzip + raw).
const MAX_CACHED_RAW_BYTES = 2 * 1024 * 1024;

function shouldGzip(p: string, size: number): boolean {
  if (size < MIN_GZIP_BYTES || size > MAX_GZIP_BYTES) return false;
  return COMPRESSIBLE.test(p);
}

// Estensioni dei sidecar precompressi generati in fase di BUILD
// (scripts/precompress-dist.mjs). Se accanto a `foo.js` esistono
// `foo.js.gz` e `foo.js.br` freschi (mtime >= dell'originale, con 2s di
// tolleranza per l'arrotondamento di tar), li carichiamo da disco invece
// di ricomprimere: leggere ~1 MB costa millisecondi, brotli quality 11
// su un bundle da 3 MB costa secondi. È questo che tiene il boot di
// prod sotto il budget (Task #243).
const SIDECAR_MTIME_SLACK_MS = 2000;

function readFreshSidecar(
  filePath: string,
  ext: ".gz" | ".br",
  minMtimeMs: number,
): Buffer | null {
  try {
    const p = filePath + ext;
    const st = fs.statSync(p);
    if (!st.isFile()) return null;
    if (st.mtimeMs + SIDECAR_MTIME_SLACK_MS < minMtimeMs) return null;
    return fs.readFileSync(p);
  } catch {
    return null;
  }
}

/** Verifica che il sidecar decomprima esattamente al raw atteso
 * (guardia contro sidecar corrotti o generati da un'altra build).
 * La decompressione è ~10x più veloce della compressione, quindi il
 * costo al boot resta trascurabile. */
function sidecarMatchesRaw(
  buf: Buffer,
  ext: ".gz" | ".br",
  raw: Buffer,
): boolean {
  try {
    const out =
      ext === ".gz" ? zlib.gunzipSync(buf) : zlib.brotliDecompressSync(buf);
    return out.length === raw.length && out.equals(raw);
  } catch {
    return false;
  }
}

function compressRaw(raw: Buffer): { gz: Buffer; br: Buffer } {
  const gz = zlib.gzipSync(raw, { level: 9 });
  const br = zlib.brotliCompressSync(raw, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
    },
  });
  return { gz, br };
}

function entryFromParts(
  raw: Buffer,
  gz: Buffer | null,
  br: Buffer | null,
  mtimeMs: number,
): CacheEntry {
  const etag = '"' + crypto.createHash("sha1").update(raw).digest("hex") + '"';
  return { raw, gz, br, etag, mtimeMs, size: raw.length };
}

function buildEntry(filePath: string, mtimeMs: number): CacheEntry | null {
  try {
    const raw = fs.readFileSync(filePath);
    if (!shouldGzip(filePath, raw.length)) {
      return entryFromParts(raw, null, null, mtimeMs);
    }
    // Preferisci i sidecar `.gz`/`.br` generati in fase di build: se
    // entrambi esistono, sono freschi e decomprimono al raw atteso, non
    // paghiamo alcuna compressione.
    const gzSidecar = readFreshSidecar(filePath, ".gz", mtimeMs);
    const brSidecar = readFreshSidecar(filePath, ".br", mtimeMs);
    if (
      gzSidecar &&
      brSidecar &&
      sidecarMatchesRaw(gzSidecar, ".gz", raw) &&
      sidecarMatchesRaw(brSidecar, ".br", raw)
    ) {
      return entryFromParts(raw, gzSidecar, brSidecar, mtimeMs);
    }
    const { gz, br } = compressRaw(raw);
    return entryFromParts(raw, gz, br, mtimeMs);
  } catch {
    return null;
  }
}

/** Come `buildEntry` ma con compressione ASINCRONA (zlib threadpool):
 * usato dal warm-up in background al boot per i file senza sidecar,
 * così l'event loop resta libero e l'app risponde subito. */
async function buildEntryAsync(
  filePath: string,
  mtimeMs: number,
): Promise<CacheEntry | null> {
  try {
    const raw = await fs.promises.readFile(filePath);
    if (!shouldGzip(filePath, raw.length)) {
      return entryFromParts(raw, null, null, mtimeMs);
    }
    const gz = (await gzipAsync(raw, { level: 9 })) as Buffer;
    const br = (await brotliAsync(raw, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]:
          zlib.constants.BROTLI_MAX_QUALITY,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
      },
    })) as Buffer;
    return entryFromParts(raw, gz, br, mtimeMs);
  } catch {
    return null;
  }
}

const cache = new Map<string, CacheEntry>();

interface ResolvedFile {
  entry: CacheEntry | null;
  stat: fs.Stats;
}

function getResolved(filePath: string): ResolvedFile | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    if (!COMPRESSIBLE.test(filePath) && stat.size > MAX_CACHED_RAW_BYTES) {
      // File binario "grande" → niente cache in RAM, lo serviamo via
      // stream lasciando comunque ETag (mtime+size) e Cache-Control.
      return { entry: null, stat };
    }
    const cached = cache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs) return { entry: cached, stat };
    const fresh = buildEntry(filePath, stat.mtimeMs);
    if (fresh) cache.set(filePath, fresh);
    return fresh ? { entry: fresh, stat } : null;
  } catch {
    return null;
  }
}

function weakEtagFromStat(stat: fs.Stats): string {
  return 'W/"' + stat.size.toString(16) + '-' + Math.floor(stat.mtimeMs).toString(16) + '"';
}

const TYPE_MAP: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

function contentTypeFor(p: string): string {
  const ext = path.extname(p).toLowerCase();
  return TYPE_MAP[ext] || "application/octet-stream";
}

/**
 * Considera "immutable" qualunque file servito da `/assets/*`: Vite vi
 * emette solo bundle con content-hash nel nome (es. `index-D4Hk9ZpL.js`),
 * quindi cambia URL ad ogni build → cache lunga e nessun rischio di
 * staleness.
 */
function isImmutable(urlPath: string): boolean {
  return /(^|\/)assets\//.test(urlPath);
}

/**
 * Pre-popola la cache scansionando ricorsivamente `root` e costruendo
 * un'entry (raw + gzip level 9 + brotli quality 11 + ETag) per ogni
 * file compressibile sotto la soglia. I file binari "grandi" vengono
 * ignorati: rimangono serviti via stream alla prima richiesta. Da
 * chiamare al boot in produzione per evitare di pagare i ~100-200 ms
 * di compressione sul bundle principale al primo hit dopo un restart
 * PM2 (brotli quality 11 è ancora più costoso del gzip level 9).
 *
 * Accetta una `skip` (RegExp sul path URL relativo) per allineare lo
 * scope a quello del middleware: file mai serviti (es. `index.html`,
 * gestito dal fallback SPA) non vengono precompressi.
 *
 * Ritorna un report con conteggio file e ms impiegati così che il
 * chiamante possa loggarlo.
 */
export function precompressStatic(
  root: string,
  opts: { skip?: RegExp } = {},
): {
  files: number;
  deferred: number;
  bytesRaw: number;
  bytesGz: number;
  bytesBr: number;
  ms: number;
} {
  const start = Date.now();
  const absRoot = path.resolve(root);
  const skip = opts.skip;
  let files = 0;
  let bytesRaw = 0;
  let bytesGz = 0;
  let bytesBr = 0;
  // File compressibili SENZA sidecar di build: comprimerli in sync al
  // boot è quello che causava i 15s di avvio lento (Task #243). Li
  // rimandiamo a un warm-up asincrono in background (zlib threadpool):
  // l'app risponde subito e, se un client arriva prima che il warm-up
  // finisca, il primo hit paga la compressione lazy come da sempre.
  const deferred: Array<{ full: string; mtimeMs: number }> = [];

  const hasFreshSidecars = (full: string, mtimeMs: number): boolean => {
    try {
      for (const ext of [".gz", ".br"] as const) {
        const st = fs.statSync(full + ext);
        if (!st.isFile()) return false;
        if (st.mtimeMs + SIDECAR_MTIME_SLACK_MS < mtimeMs) return false;
      }
      return true;
    } catch {
      return false;
    }
  };

  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      if (!e.isFile()) continue;
      // I sidecar `.gz`/`.br` non sono asset da servire: vengono letti
      // da `buildEntry` accanto al file originale.
      if (/\.(gz|br)$/i.test(e.name)) continue;
      if (skip) {
        const urlPath = "/" + path.relative(absRoot, full).split(path.sep).join("/");
        if (skip.test(urlPath)) continue;
      }
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (!COMPRESSIBLE.test(full) && stat.size > MAX_CACHED_RAW_BYTES) {
        continue;
      }
      if (shouldGzip(full, stat.size) && !hasFreshSidecars(full, stat.mtimeMs)) {
        deferred.push({ full, mtimeMs: stat.mtimeMs });
        continue;
      }
      const entry = buildEntry(full, stat.mtimeMs);
      if (!entry) continue;
      cache.set(full, entry);
      files += 1;
      bytesRaw += entry.size;
      if (entry.gz) bytesGz += entry.gz.length;
      if (entry.br) bytesBr += entry.br.length;
    }
  };

  walk(absRoot);

  if (deferred.length > 0) {
    void (async () => {
      for (const { full, mtimeMs } of deferred) {
        // Se un hit lazy l'ha già messo in cache, non rifare il lavoro.
        const cached = cache.get(full);
        if (cached && cached.mtimeMs === mtimeMs) continue;
        const entry = await buildEntryAsync(full, mtimeMs);
        if (!entry) continue;
        // Non sovrascrivere entry più fresche nel frattempo.
        const again = cache.get(full);
        if (again && again.mtimeMs !== mtimeMs) continue;
        cache.set(full, entry);
      }
      // eslint-disable-next-line no-console
      console.log(
        `[static] background warm-up: compressed ${deferred.length} file(s) senza sidecar di build`,
      );
    })().catch((err) => {
      // eslint-disable-next-line no-console
      console.warn(
        `[static] background warm-up failed (gli asset restano serviti ` +
          `via compressione lazy al primo hit):`,
        err,
      );
    });
  }

  return {
    files,
    deferred: deferred.length,
    bytesRaw,
    bytesGz,
    bytesBr,
    ms: Date.now() - start,
  };
}

/**
 * Misure di compressione sul bundle principale del primo paint (build
 * di riferimento, dist/public/assets/*):
 *
 *   file                      raw      gzip(9)   brotli(11)  br vs gz
 *   index-*.js              3 202 KB    886 KB     709 KB     -19.9%
 *   index-*.css               117 KB     18 KB      14 KB     -20.5%
 *   html2canvas chunk         201 KB     46 KB      38 KB     -18.0%
 *   index.es chunk            158 KB     52 KB      46 KB     -12.6%
 *   purify.es chunk            22 KB      8 KB       7 KB      -9.7%
 *   ─────────────────────────────────────────────────────────
 *   TOTAL primo paint       3 702 KB  1 012 KB     816 KB     -19.4%
 *
 * Brotli (BROTLI_MAX_QUALITY = 11, BROTLI_PARAM_SIZE_HINT = raw size)
 * comprime il primo paint ulteriormente di ~196 KB rispetto a gzip-only,
 * e di ~78% rispetto al raw. Il costo di compressione si paga una sola
 * volta per file (al primo hit, o al boot via `precompressStatic`) e
 * resta in cache finché non cambia `mtime`. Comando di riferimento:
 * `node -e "..."` con `zlib.brotliCompressSync` su ogni asset di
 * `dist/public/assets/`.
 *
 * Middleware generico per servire una directory di file statici con:
 *  - brotli pre-calcolato in memoria (quality 11) e gzip
 *    pre-calcolato (level 9), una volta per file e invalidati sul
 *    cambio di `mtime`. Il client ottiene `br` se lo accetta,
 *    altrimenti `gzip`, altrimenti raw;
 *  - `ETag` su SHA1 del contenuto, con risposta 304 quando l'header
 *    `If-None-Match` corrisponde;
 *  - `Cache-Control` aggressivo (`immutable`, 1 anno) per i bundle Vite
 *    sotto `/assets/`, conservativo (1h + revalidate via ETag) per il
 *    resto.
 *
 * I file binari già compressi (immagini, font, video) vengono serviti
 * raw, sempre con ETag e Cache-Control.
 *
 * Se il file richiesto non esiste sotto `root`, passa al middleware
 * successivo via `next()` senza scrivere nulla.
 */
export function mountCompressedStatic(
  app: Express,
  opts: { root: string; skip?: RegExp },
) {
  const root = path.resolve(opts.root);
  const skip = opts.skip;

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const rel = req.path.replace(/^\/+/, "");
    if (!rel) return next();
    if (rel.includes("..")) return next();
    if (skip && skip.test(req.path)) return next();
    // I sidecar `.gz`/`.br` di build non sono asset pubblici: servono
    // solo a `buildEntry` come precompressi da caricare accanto al file
    // originale. Non li esponiamo come URL.
    if (/\.(gz|br)$/i.test(rel)) return next();

    const safe = path.normalize(rel);
    const candidate = path.join(root, safe);
    if (!candidate.startsWith(root + path.sep) && candidate !== root) {
      return next();
    }

    const resolved = getResolved(candidate);
    if (!resolved) return next();
    const { entry, stat } = resolved;
    const etag = entry ? entry.etag : weakEtagFromStat(stat);

    res.setHeader("Content-Type", contentTypeFor(candidate));
    res.setHeader("ETag", etag);
    res.setHeader("Vary", "Accept-Encoding");
    if (isImmutable(req.path)) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else {
      res.setHeader("Cache-Control", "public, max-age=3600, must-revalidate");
    }

    const inm = req.headers["if-none-match"];
    if (inm && inm === etag) {
      res.status(304).end();
      return;
    }

    if (entry) {
      const accept = String(req.headers["accept-encoding"] || "");
      if (entry.br && /\bbr\b/.test(accept)) {
        res.setHeader("Content-Encoding", "br");
        res.setHeader("Content-Length", String(entry.br.length));
        if (req.method === "HEAD") return res.end();
        return res.end(entry.br);
      }
      if (entry.gz && /\bgzip\b/.test(accept)) {
        res.setHeader("Content-Encoding", "gzip");
        res.setHeader("Content-Length", String(entry.gz.length));
        if (req.method === "HEAD") return res.end();
        return res.end(entry.gz);
      }
      res.setHeader("Content-Length", String(entry.size));
      if (req.method === "HEAD") return res.end();
      return res.end(entry.raw);
    }

    // File binario "grande" non in cache → stream da disco.
    res.setHeader("Content-Length", String(stat.size));
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(candidate).on("error", () => res.end()).pipe(res);
  });
}
