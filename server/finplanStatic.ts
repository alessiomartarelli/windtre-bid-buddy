import type { Express, Request, Response, NextFunction } from "express";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import crypto from "crypto";

interface CacheEntry {
  raw: Buffer;
  gz: Buffer;
  etag: string;
  mtimeMs: number;
  size: number;
}

function buildEntry(filePath: string): CacheEntry | null {
  try {
    const raw = fs.readFileSync(filePath);
    const stat = fs.statSync(filePath);
    const gz = zlib.gzipSync(raw, { level: 9 });
    const etag = '"' + crypto.createHash("sha1").update(raw).digest("hex") + '"';
    return { raw, gz, etag, mtimeMs: stat.mtimeMs, size: raw.length };
  } catch {
    return null;
  }
}

const cache = new Map<string, CacheEntry>();

function getEntry(filePath: string): CacheEntry | null {
  try {
    const stat = fs.statSync(filePath);
    const cached = cache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached;
    const fresh = buildEntry(filePath);
    if (fresh) cache.set(filePath, fresh);
    return fresh;
  } catch {
    return null;
  }
}

function contentTypeFor(p: string): string {
  if (p.endsWith(".html")) return "text/html; charset=utf-8";
  if (p.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (p.endsWith(".css")) return "text/css; charset=utf-8";
  if (p.endsWith(".json")) return "application/json; charset=utf-8";
  if (p.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

/**
 * Serve i file statici sotto `/finplan/*` con gzip in memoria, ETag e
 * Cache-Control. Indipendente da Vite/express.static: pre-comprimiamo
 * (level 9) la prima volta e usiamo `mtime` come cache-buster.
 *
 * In prod: il file vive in `dist/public/finplan/...`.
 * In dev:  il file vive in `client/public/finplan/...`.
 */
export function mountFinplanStatic(app: Express, opts: { roots: string[] }) {
  const roots = opts.roots.map((r) => path.resolve(r));

  const handler = (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    // Strip leading "/finplan/"
    const rel = req.path.replace(/^\/finplan\/?/, "");
    if (!rel || rel.includes("..")) return next();
    const safe = path.normalize(rel).replace(/^([./\\])+/, "");
    if (!safe) return next();

    let resolved: string | null = null;
    for (const root of roots) {
      const candidate = path.join(root, "finplan", safe);
      // Containment check
      if (!candidate.startsWith(root + path.sep) && candidate !== root) continue;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        resolved = candidate;
        break;
      }
    }
    if (!resolved) return next();

    const entry = getEntry(resolved);
    if (!entry) return next();

    res.setHeader("Content-Type", contentTypeFor(resolved));
    res.setHeader("ETag", entry.etag);
    // Validato dal server tramite ETag ad ogni request: la 2a apertura
    // restituisce 304 Not Modified (poche centinaia di byte) invece dei
    // 5+ MB del bundle FinPlan. Per gli asset secondari (JSON statici)
    // applichiamo lo stesso schema.
    res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    res.setHeader("Vary", "Accept-Encoding");

    const inm = req.headers["if-none-match"];
    if (inm && inm === entry.etag) {
      res.status(304).end();
      return;
    }

    const accept = String(req.headers["accept-encoding"] || "");
    if (/\bgzip\b/.test(accept)) {
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Content-Length", String(entry.gz.length));
      if (req.method === "HEAD") return res.end();
      return res.end(entry.gz);
    }
    res.setHeader("Content-Length", String(entry.size));
    if (req.method === "HEAD") return res.end();
    return res.end(entry.raw);
  };

  app.use("/finplan", handler);
}
