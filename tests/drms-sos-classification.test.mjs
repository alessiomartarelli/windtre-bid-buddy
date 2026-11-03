import test from "node:test";
import assert from "node:assert/strict";
import { classificaRiga, classifyAndNormalize, isDrmsSosCaring } from "../client/src/lib/drmsClassifier.ts";

const row = (description, extra = {}) => ({
  REGOLA_DI_CALCOLO: "Gara Top Partnership Reward Mobile Tied",
  DESCRIZIONE_ITEM: description,
  COMPETENZA: "OTT-26",
  NATURA: "GARE",
  IMPORTO: "125,50",
  ...extra,
});

test("la descrizione SOS prevale sulla regola generica Top Partnership Reward", () => {
  for (const description of ["Partnership Reward CB SOS Tied", "Partnership Reward CB SOS Unt"]) {
    assert.equal(classificaRiga(row(description), "OTT-26"), "SOS_CARING");
  }
});

test("tollera maiuscole e spazi senza accettare descrizioni parziali", () => {
  assert.equal(classificaRiga(row(" partnership  reward cb SOS tied "), "OTT-26"), "SOS_CARING");
  assert.equal(isDrmsSosCaring(row("Partnership Reward CB SOS Tied altro")), false);
});

test("le altre righe Top Partnership Reward mantengono la loro categoria", () => {
  assert.equal(classificaRiga(row("Altro premio"), "OTT-26"), "PARTNERSHIP_REWARD");
  assert.equal(classificaRiga(row("", { REGOLA_DI_CALCOLO: "Gara Top Partnership Reward Mobile Untied" }), "OTT-26"), "PARTNERSHIP_REWARD");
});

test("preserva il riconoscimento legacy nel campo regola", () => {
  assert.equal(classificaRiga(row("", { REGOLA_DI_CALCOLO: "Partnership Reward CB SOS Tied" }), "OTT-26"), "SOS_CARING");
  assert.equal(isDrmsSosCaring({}), false);
});

test("normalizza importi e riconosce anche le righe già salvate come Partnership Reward", () => {
  const [normalized] = classifyAndNormalize([row("Partnership Reward CB SOS Tied")], "OTT-26");
  assert.equal(normalized.CAPITOLO, "SOS_CARING");
  assert.equal(normalized.IMPORTO_NUM, 125.5);
  assert.equal(isDrmsSosCaring({ ...normalized, CAPITOLO: "PARTNERSHIP_REWARD" }), true);
  const [negative] = classifyAndNormalize([row("Partnership Reward CB SOS Tied", { IMPORTO: "-25,00" })], "OTT-26");
  assert.equal(negative.CAPITOLO, "SOS_CARING");
  assert.equal(negative.IMPORTO_NUM, -25);
});
