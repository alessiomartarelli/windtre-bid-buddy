import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const script = "scripts/verify-windtre-recharges.mts";
const snapshot = "tests/fixtures/windtre-cms-recharges-anonymized.json";
function run(args) {
  return spawnSync(process.execPath, ["--import", "tsx", script, ...args], {
    encoding: "utf8",
    // Nessuna credenziale né server richiesto per la riproduzione.
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    timeout: 15000,
  });
}

test("audit CMS riproducibile senza credenziali o accessi di rete", () => {
  const output = run(["--snapshot", snapshot]);
  assert.equal(output.status, 0, output.stderr);
  const result = JSON.parse(output.stdout);
  assert.equal(result.source, "snapshot-pseudonymized");
  assert.equal(result.salesInSnapshot, 176, "snapshot contiene solo gli scontrini ricarica, non tutte le 619 vendite");
  assert.equal(result.entireWorkbook.states.VERIFICATO.count, 108);
  assert.equal(result.entireWorkbook.states.VERIFICATO.providerCents, 184100);
  assert.equal(result.requestedPeriodOnly.states.VERIFICATO.count, 100);
  assert.equal(result.requestedPeriodOnly.states["NON PRESENTE SU FILE"].bisuiteCents, 59100);
  assert.equal(result.outsideRequestedPeriod.count, 8);
});

test("lo script non supporta più collegamenti SSH diretti alla produzione", () => {
  const output = run(["--production-ssh"]);
  assert.notEqual(output.status, 0);
  assert.match(output.stderr, /Opzione non supportata: --production-ssh/);
  assert.equal(output.stdout, "");
});

test("la riproduzione offline non può essere confusa con una nuova lettura del database", () => {
  const output = run(["--snapshot", snapshot, "--org", "some-org"]);
  assert.notEqual(output.status, 0);
  assert.match(output.stderr, /Usare --snapshot senza/);
  assert.equal(output.stdout, "");
});
