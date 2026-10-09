import { test } from "node:test";
import assert from "node:assert/strict";
import { CjSimDiagnosticCache } from "../server/cjSimDiagnosticCache.ts";

const summary = {
  counts: { admitted: 60 }, sourceTotal: 60, details: [], page: 0, pageSize: 50,
  version: "a".repeat(64), diagnostics: { period: 60 },
};
const collect = (cache, n = 60) => {
  const collector = cache.collector();
  for (let i = 0; i < n; i++) collector.add({ source: { articleId: i }, reason: "admitted" });
  return collector.finish();
};

test("only validated contexts serve fresh isolated objects, with the existing page shape", () => {
  const cache = new CjSimDiagnosticCache();
  cache.put("org/admin/filter", "token1", summary, collect(cache));
  assert.equal(cache.get("org/operator/filter", "token1", 0, true), undefined);
  assert.equal(cache.get("other-org/admin/filter", "token1", 0, true), undefined);
  assert.equal(cache.get("org/admin/filter", "token2", 0, true), undefined);
  const page = cache.get("org/admin/filter", "token1", 1, true);
  assert.equal(page.details.length, 10);
  assert.equal(page.details[0].source.articleId, 50);
  assert.equal(page.diagnostics, undefined);
  page.details[0].source.articleId = 999;
  page.counts.admitted = 0;
  assert.equal(cache.get("org/admin/filter", "token1", 1, true).details[0].source.articleId, 50);
  assert.equal(cache.get("org/admin/filter", "token1", 0, false).counts.admitted, 60);
  assert.equal(cache.get("org/admin/filter", "token1", 0, false).diagnostics.period, 60);
  assert.deepEqual(cache.get("org/admin/filter", "token1", 99, true).details, []);
});

test("absolute expiry, LRU entry eviction, total budget and oversize streaming fallback", () => {
  let now = 0;
  const cache = new CjSimDiagnosticCache(10_000, 20_000, 2, 100, () => now);
  const put = key => cache.put(key, "t", summary, collect(cache, 1));
  put("a"); put("b");
  assert.ok(cache.get("a", "t", 0, false));
  put("c");
  assert.equal(cache.get("b", "t", 0, false), undefined);
  now = 99;
  assert.ok(cache.get("a", "t", 0, false));
  now = 100;
  assert.equal(cache.get("a", "t", 0, false), undefined, "reads must not extend expiry");
  const small = new CjSimDiagnosticCache(2_000, 2_000);
  small.put("a", "t", summary, collect(small, 1));
  small.put("b", "t", summary, collect(small, 1));
  assert.equal(small.get("a", "t", 0, false), undefined);
  assert.ok(small.get("b", "t", 0, false));
  const oversized = small.collector();
  oversized.add({ source: { descrizione: "x".repeat(2_000) }, reason: "admitted" });
  assert.equal(oversized.finish(), undefined);
  small.put("b", "new", summary, oversized.finish());
  assert.equal(small.get("b", "t", 0, false), undefined);
  small.put("big-summary", "t", { ...summary, diagnostics: { text: "x".repeat(2_000) } }, collect(small, 1));
  assert.equal(small.get("big-summary", "t", 0, false), undefined);
});
