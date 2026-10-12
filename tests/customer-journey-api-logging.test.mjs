import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { createServer } from "node:http";
import { createApiRequestLogger } from "../server/apiRequestLogger.ts";

// Synthetic values only. Unknown/nested fields must be omitted too.
const personal = {
  id: "journey-private-id",
  clienteNome: "Cliente Riservato",
  codiceFiscale: "RSSMRA80A01H501Z",
  partitaIva: "01234567890",
  email: "cliente@example.invalid",
  telefono: "3331234567",
  iccid: "89390100000012345678",
  pod: "IT001E12345678",
  indirizzo: "Via Privata 123",
  addetto: "Operatore Riservato",
  futureField: "personal-field-not-yet-known",
};

async function withServer(run) {
  const lines = [];
  const app = express();
  app.use(createApiRequestLogger(line => lines.push(line)));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(app, `http://127.0.0.1:${server.address().port}`, lines);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test("CJ reports, diagnostics, config and mutations omit all bodies while preserving responses and metadata", async () => {
  await withServer(async (app, base, lines) => {
    for (const prefix of ["", "/mystoredesk"]) {
      for (const [method, route, actual, body, status] of [
        ["get", "/api/customer-journeys", "/api/customer-journeys", [personal], 200],
        ["get", "/api/customer-journeys/report", "/api/customer-journeys/report", [personal], 200],
        ["get", "/api/customer-journeys/report-cohorts", "/api/customer-journeys/report-cohorts", { rows: [personal] }, 200],
        ["get", "/api/customer-journeys/report-mobile-sources", "/api/customer-journeys/report-mobile-sources", { diagnostics: { rows: [personal] } }, 200],
        ["get", "/api/customer-journeys/future-report", "/api/customer-journeys/future-report", { unknown: personal }, 200],
        ["get", "/api/customer-journeys/:id", `/api/customer-journeys/${personal.id}`, { journey: personal, items: [personal] }, 200],
        ["patch", "/api/customer-journey-items/:id/details", `/api/customer-journey-items/${personal.iccid}/details`, personal, 200],
        ["patch", "/api/customer-journeys/:id/ragione-sociale", `/api/customer-journeys/${personal.id}/ragione-sociale`, personal, 200],
        ["get", "/api/customer-journey-config", "/api/customer-journey-config", personal, 200],
        ["post", "/api/customer-journeys/reconcile", "/api/customer-journeys/reconcile", { error: personal }, 500],
      ]) {
        app[method](prefix + route, (_req, res) => res.status(status).json(body));
        const response = await fetch(`${base}${prefix}${actual}?search=${personal.email}`, { method: method.toUpperCase() });
        assert.equal(response.status, status);
        assert.deepEqual(await response.json(), body);
        const line = lines.at(-1);
        assert.match(line, new RegExp(`^${method.toUpperCase()} .* ${status} in \\d+ms :: \\[Customer Journey response body omitted\\]$`));
        assert.ok(line.includes(prefix + route));
        for (const value of Object.values(personal)) assert.ok(!line.includes(value), `leaked ${value}`);
        for (const key of Object.keys(personal)) assert.ok(!line.includes(`"${key}"`), `serialized ${key}`);
      }
    }
  });
});

test("unmatched CJ routes hide path identifiers and non-JSON responses log metadata only", async () => {
  await withServer(async (app, base, lines) => {
    app.get("/api/customer-journeys/export", (_req, res) => res.send(personal.email));
    app.use((_req, res) => res.status(404).json({ error: personal }));
    const response = await fetch(`${base}/mystoredesk/api/customer-journey-items/${personal.iccid}/unknown`);
    assert.equal(response.status, 404);
    assert.match(lines.at(-1), /GET \/api\/customer-journey-items\/\[unmatched\] 404 in \d+ms/);
    const exported = await fetch(`${base}/api/customer-journeys/export`);
    assert.equal(await exported.text(), personal.email);
    assert.match(lines.at(-1), /GET \/api\/customer-journeys\/export 200 in \d+ms/);
    for (const value of Object.values(personal)) assert.ok(!lines.join("\n").includes(value));
  });
});

test("other APIs retain credential redaction and the 2 KB limit; non-API requests are not logged", async () => {
  await withServer(async (app, base, lines) => {
    app.get("/api/example", (_req, res) => res.json({
      count: 7, nested: { password: "password-private", token: "token-private", arbitrary: "enc:v1:private" },
    }));
    app.get("/api/large", (_req, res) => res.json({ text: "x".repeat(3000) }));
    app.get("/health", (_req, res) => res.send("ok"));
    await (await fetch(`${base}/api/example`)).json();
    assert.match(lines[0], /"count":7/);
    assert.match(lines[0], /"password":"\[redacted\]"/);
    assert.match(lines[0], /"token":"\[redacted\]"/);
    assert.match(lines[0], /"arbitrary":"\[redacted\]"/);
    assert.ok(!lines[0].includes("private"));
    await (await fetch(`${base}/api/large`)).json();
    assert.ok(lines[1].endsWith("…[truncated]"));
    assert.equal(lines[1].split(" :: ")[1].length, 2000 + "…[truncated]".length);
    await (await fetch(`${base}/health`)).text();
    assert.equal(lines.length, 2);
  });
});
