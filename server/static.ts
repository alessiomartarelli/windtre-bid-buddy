import { type Express } from "express";
import fs from "fs";
import path from "path";
import { mountCompressedStatic, precompressStatic } from "./compressedStatic";

const BASE_PATH = process.env.NODE_ENV === "production" ? "/incentivew3" : "";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Servi tutti i file statici di prod (bundle JS/CSS in `/assets/*`,
  // favicon, font, immagini, ecc.) con gzip + ETag + Cache-Control.
  // `index.html` resta gestito dal fallback SPA sotto, che riscrive i
  // path con `BASE_PATH` e non deve essere cacheato dal client.
  // In produzione, pre-comprimi tutti i bundle al boot così che il primo
  // GET dopo un restart PM2 non paghi i ~100-200 ms di gzip level 9 +
  // brotli quality 11 sul bundle principale (~3 MB). In dev evitiamo il
  // costo perché i file sono rigenerati a ogni HMR.
  const SKIP = /(^|\/)index\.html$/i;
  // Soglia di budget per il boot: oltre i 2s la precompressione sta
  // diventando un problema (asset troppo grossi o disco lento) e va
  // investigata.
  const BOOT_BUDGET_MS = 2000;
  if (process.env.NODE_ENV === "production") {
    const report = precompressStatic(distPath, { skip: SKIP });
    const mb = (n: number) => (n / (1024 * 1024)).toFixed(2);
    // eslint-disable-next-line no-console
    console.log(
      `[static] precompressed ${report.files} file(s), ` +
        `${mb(report.bytesRaw)} MB raw → ${mb(report.bytesGz)} MB gzip / ` +
        `${mb(report.bytesBr)} MB brotli in ${report.ms} ms`,
    );
    if (report.ms > BOOT_BUDGET_MS) {
      // eslint-disable-next-line no-console
      console.warn(
        `[static] precompression took ${report.ms} ms ` +
          `(>${BOOT_BUDGET_MS} ms budget): boot is getting slow, ` +
          `controlla la dimensione del bundle in dist/public.`,
      );
    }
  }

  mountCompressedStatic(app, {
    root: distPath,
    skip: SKIP,
  });

  app.use("/{*path}", (_req, res) => {
    const indexPath = path.resolve(distPath, "index.html");
    let html = fs.readFileSync(indexPath, "utf-8");
    if (BASE_PATH) {
      html = html.replaceAll('src="/assets/', `src="${BASE_PATH}/assets/`);
      html = html.replaceAll('href="/assets/', `href="${BASE_PATH}/assets/`);
      html = html.replaceAll('href="/favicon', `href="${BASE_PATH}/favicon`);
    }
    // `index.html` è il manifest che punta ai bundle Vite hashati. Dopo un
    // deploy i vecchi chunk vengono rimossi: se il browser riusa un
    // `index.html` cacheato finisce per richiedere chunk inesistenti e
    // mostra la pagina bianca ("Failed to fetch dynamically imported
    // module"). Forziamo quindi la rivalidazione del manifest a ogni load,
    // mentre gli asset hashati sotto `/assets/*` restano `immutable` 1 anno.
    res
      .status(200)
      .set({
        "Content-Type": "text/html",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      })
      .end(html);
  });
}
