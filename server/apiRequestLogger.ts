import type { RequestHandler } from "express";
import {
  customerJourneyLogPath,
  isCustomerJourneyLogPath,
  logJsonReplacer,
} from "./logRedact";

/** Shared by the real server and the HTTP regression tests. */
export function createApiRequestLogger(writeLog: (message: string) => void): RequestHandler {
  return (req, res, next) => {
    const start = Date.now();
    const path = req.path;
    const isCustomerJourney = isCustomerJourneyLogPath(path);
    // Report di ricariche e riconciliazioni contengono numeri telefonici e
    // nominativi: non conservarne né serializzarne il body nei log.
    const isRechargeAnalysis = /(?:^|\/)api\/ricariche-analysis(?:\/|$)/.test(path);
    const omitBody = isCustomerJourney || isRechargeAnalysis;
    let capturedJsonResponse: unknown;

    // Do not even retain the CJ body for logging, including error responses.
    if (!omitBody) {
      const originalResJson = res.json;
      res.json = function (bodyJson) {
        capturedJsonResponse = bodyJson;
        return originalResJson.call(this, bodyJson);
      };
    }

    res.on("finish", () => {
      if (!path.includes("/api")) return;
      const routePath = typeof req.route?.path === "string" ? req.route.path : undefined;
      const loggedPath = isCustomerJourney
        ? customerJourneyLogPath(path, routePath)
        : isRechargeAnalysis
          ? (routePath || path)
          : path;
      let logLine = `${req.method} ${loggedPath} ${res.statusCode} in ${Date.now() - start}ms`;
      if (omitBody) {
        logLine += isCustomerJourney
          ? " :: [Customer Journey response body omitted]"
          : " :: [Analisi Ricariche response body omitted]";
      } else if (capturedJsonResponse) {
        const redacted = JSON.stringify(capturedJsonResponse, logJsonReplacer);
        logLine += ` :: ${redacted.length > 2000 ? redacted.slice(0, 2000) + "…[truncated]" : redacted}`;
      }
      writeLog(logLine);
    });
    next();
  };
}
