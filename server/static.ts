import express, { type Express } from "express";
import fs from "fs";
import path from "path";

const BASE_PATH = process.env.NODE_ENV === "production" ? "/incentivew3" : "";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath, { index: false }));

  app.use("/{*path}", (_req, res) => {
    const indexPath = path.resolve(distPath, "index.html");
    let html = fs.readFileSync(indexPath, "utf-8");
    if (BASE_PATH) {
      html = html.replace("<head>", `<head><base href="${BASE_PATH}/">`);
    }
    res.status(200).set({ "Content-Type": "text/html" }).end(html);
  });
}
