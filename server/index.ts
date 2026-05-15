import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { startBisuiteDailyScheduler } from "./bisuiteScheduler";

const isProduction = process.env.NODE_ENV === "production";
const BASE_PATH = isProduction ? "/incentivew3" : "";

const app = express();
const httpServer = createServer(app);

// Compressione gzip su risposte API/JSON (Task #137). I bundle statici
// hanno già pre-compressione brotli/gzip via mountCompressedStatic; qui
// copriamo le risposte dinamiche (es. /api/finplan, /api/bisuite-sales,
// /api/cdg/*) che possono pesare centinaia di KB.
// Threshold 1 KB: payload piccoli non valgono l'overhead.
app.use(
  compression({
    threshold: 1024,
    filter: (req, res) => {
      if (req.headers["x-no-compression"]) return false;
      return compression.filter(req, res);
    },
  }),
);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: '50mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: '50mb' }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.includes("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        const redacted = JSON.stringify(capturedJsonResponse, (key, value) => {
          if (typeof value === "string" && value.length > 200 && /^data:image\//i.test(value)) {
            return `[dataURL ${value.length} bytes redacted]`;
          }
          return value;
        });
        logLine += ` :: ${redacted.length > 2000 ? redacted.slice(0, 2000) + "…[truncated]" : redacted}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  if (isProduction && BASE_PATH) {
    const subApp = express();
    await registerRoutes(httpServer, subApp);

    subApp.use((err: any, _req: Request, res: Response, next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      console.error("Internal Server Error:", err);
      if (res.headersSent) {
        return next(err);
      }
      return res.status(status).json({ message });
    });

    // Stesso catch-all 404 per /api/* anche in produzione, montato sul
    // sub-app prima dello static handler così che le route eliminate
    // (es. /api/finplan/preload dopo Task #148) restituiscano un 404
    // JSON pulito invece dell'HTML SPA.
    subApp.use("/api", (_req, res) => {
      res.status(404).json({ message: "Not Found" });
    });

    // Stesso 404 esplicito per /finplan/* (iframe HTML standalone
    // rimosso in Task #148). Va PRIMA di `serveStatic` per evitare il
    // fallback SPA che restituirebbe 200 con index.html.
    subApp.use("/finplan", (_req, res) => {
      res.status(404).type("text/plain").send("Not Found");
    });

    serveStatic(subApp);
    app.use(BASE_PATH, subApp);

    app.get("/", (_req, res) => {
      res.redirect(BASE_PATH + "/");
    });
    startBisuiteDailyScheduler();
  } else {
    await registerRoutes(httpServer, app);

    // Catch-all 404 per route /api/* non gestite. Senza questo, le path
    // sconosciute /api/* passerebbero al middleware Vite che risponde 200
    // con index.html (SPA fallback), nascondendo le route eliminate.
    app.use("/api", (_req, res) => {
      res.status(404).json({ message: "Not Found" });
    });

    // Task #148: anche le path /finplan/* (vecchio iframe HTML standalone)
    // devono rispondere 404, NON il fallback SPA di Vite. Lo standalone
    // tool è stato eliminato; chi continua a chiedere `/finplan/index.html`
    // o `/finplan/preload.json` deve sapere subito che non esiste più.
    app.use("/finplan", (_req, res) => {
      res.status(404).type("text/plain").send("Not Found");
    });

    app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      console.error("Internal Server Error:", err);
      if (res.headersSent) {
        return next(err);
      }
      return res.status(status).json({ message });
    });

    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
      if (isProduction) {
        log(`base path: ${BASE_PATH}`);
      }
    },
  );
})();
