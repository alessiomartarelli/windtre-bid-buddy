import type { Express, Request, Response, NextFunction } from "express";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import crypto from "crypto";

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

function buildEntry(filePath: string, mtimeMs: number): CacheEntry | null {
  try {
    const raw = fs.readFileSync(filePath);
    const compressible = shouldGzip(filePath, raw.length);
    const gz = compressible ? zlib.gzipSync(raw, { level: 9 }) : null;
    const br = compressible
      ? zlib.brotliCompressSync(raw, {
          params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]:
              zlib.constants.BROTLI_MAX_QUALITY,
            [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
          },
        })
      : null;
    const etag =
      '"' + crypto.createHash("sha1").update(raw).digest("hex") + '"';
    return { raw, gz, br, etag, mtimeMs, size: raw.length };
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
  return { files, bytesRaw, bytesGz, bytesBr, ms: Date.now() - start };
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
