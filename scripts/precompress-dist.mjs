#!/usr/bin/env node
// Precompressione BUILD-TIME degli asset statici (Task #243).
//
// Genera i sidecar `.gz` (gzip level 9) e `.br` (brotli quality 11)
// accanto a ogni file compressibile di `dist/public`, così che il server
// di prod (server/compressedStatic.ts) li carichi da disco al boot invece
// di ricomprimere tutto: prima questo passo il boot pagava ~15s di
// compressione sincrona dopo ogni deploy/restart PM2.
//
// Le regole (regex compressibile, soglie min/max, skip di index.html)
// sono ALLINEATE a quelle di server/compressedStatic.ts: se cambi una,
// cambia anche l'altra.
//
// Uso: node scripts/precompress-dist.mjs [dist/public]

import fs from "fs";
import path from "path";
import zlib from "zlib";

const root = path.resolve(process.argv[2] || "dist/public");

const COMPRESSIBLE = /\.(html|js|mjs|css|json|map|svg|txt|xml|wasm|webmanifest)$/i;
const MIN_GZIP_BYTES = 256;
const MAX_GZIP_BYTES = 8 * 1024 * 1024;
// index.html è gestito dal fallback SPA (riscrive i path con BASE_PATH),
// non viene mai servito dal middleware statico: niente sidecar.
const SKIP = /(^|\/)index\.html$/i;

if (!fs.existsSync(root)) {
  console.error(`precompress-dist: directory non trovata: ${root}`);
  process.exit(1);
}

const start = Date.now();
let files = 0;
let bytesRaw = 0;
let bytesGz = 0;
let bytesBr = 0;

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(full);
      continue;
    }
    if (!e.isFile()) continue;
    if (/\.(gz|br)$/i.test(e.name)) continue;
    const urlPath = "/" + path.relative(root, full).split(path.sep).join("/");
    if (SKIP.test(urlPath)) continue;
    if (!COMPRESSIBLE.test(full)) continue;
    const raw = fs.readFileSync(full);
    if (raw.length < MIN_GZIP_BYTES || raw.length > MAX_GZIP_BYTES) continue;

    const gz = zlib.gzipSync(raw, { level: 9 });
    const br = zlib.brotliCompressSync(raw, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
      },
    });
    fs.writeFileSync(full + ".gz", gz);
    fs.writeFileSync(full + ".br", br);
    files += 1;
    bytesRaw += raw.length;
    bytesGz += gz.length;
    bytesBr += br.length;
  }
}

walk(root);

const mb = (n) => (n / (1024 * 1024)).toFixed(2);
console.log(
  `precompress-dist: ${files} file(s), ${mb(bytesRaw)} MB raw → ` +
    `${mb(bytesGz)} MB gzip / ${mb(bytesBr)} MB brotli in ${Date.now() - start} ms`,
);
