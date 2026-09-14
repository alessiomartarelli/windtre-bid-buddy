import assert from "node:assert/strict";
import test from "node:test";
import { formatBisuiteSyncTime } from "../client/src/lib/bisuiteTime.ts";

test("BiSuite lastSync formatta un ISO instant nel fuso Europe/Rome", () => {
  // In inverno Roma è UTC+1: nessun +1 manuale, DST gestito da Intl.
  assert.match(
    formatBisuiteSyncTime("2026-01-15T11:00:00.000Z"),
    /^15\/01\/2026,? 12:00$/,
  );
});

test("BiSuite lastSync non interpreta timestamp senza fuso come ora browser", () => {
  assert.equal(formatBisuiteSyncTime("2026-01-15T12:00:00"), null);
});