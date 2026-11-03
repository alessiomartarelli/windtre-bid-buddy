import test from "node:test";
import assert from "node:assert/strict";
import {
  CAPITOLI_CONFIG, classificaRiga, classifyAndNormalize,
  getStoredDrmsCapitolo, isDrmsExtraPiva,
} from "../client/src/lib/drmsClassifier.ts";

const raw = (extra = {}) => ({
  NOME_GARA: "Gara PIVA Franchising",
  REGOLA_DI_CALCOLO: "Gara Top Partnership Reward Mobile Tied",
  TIPO_FONIA: "MOBILE", TIPO_ATTIVAZIONE: "TIED",
  COMPETENZA: "OTT-26", IMPORTO: "125,50",
  ...extra,
});

test("Extra P.iva ha una categoria dedicata e precede le classificazioni generiche", () => {
  assert.equal(CAPITOLI_CONFIG.EXTRA_PIVA.label, "Extra P.iva");
  for (const TIPO_FONIA of ["MOBILE", "FISSO", "ENERGIA", ""]) {
    assert.equal(classificaRiga(raw({ TIPO_FONIA }), "OTT-26"), "EXTRA_PIVA");
  }
});

test("accetta NOME_GARA o NOME GARA con spazi e maiuscole normalizzati", () => {
  assert.equal(isDrmsExtraPiva({ NOME_GARA: " gara  piva FRANCHISING " }), true);
  const [row] = classifyAndNormalize([raw({ NOME_GARA: undefined, "NOME GARA": "Gara PIVA Franchising" })], "OTT-26");
  assert.equal(row.CAPITOLO, "EXTRA_PIVA");
  assert.equal(row.NOME_GARA, "Gara PIVA Franchising");
});

test("conserva nome, importi positivi/negativi e classificazione dopo il salvataggio JSON", () => {
  const rows = classifyAndNormalize([raw(), raw({ IMPORTO: "-25,00" })], "OTT-26");
  const stored = JSON.parse(JSON.stringify(rows));
  assert.deepEqual(stored.map(r => r.IMPORTO_NUM), [125.5, -25]);
  for (const row of stored) {
    assert.equal(row.NOME_GARA, "Gara PIVA Franchising");
    assert.equal(getStoredDrmsCapitolo({ ...row, CAPITOLO: "PARTNERSHIP_REWARD" }), "EXTRA_PIVA");
  }
});

test("non deduce Extra P.iva da nomi parziali, P.IVA cliente o upload legacy senza nome", () => {
  for (const NOME_GARA of [undefined, "", "Gara PIVA Franchising altro", "Altra gara"]) {
    assert.equal(classificaRiga(raw({ NOME_GARA, P_IVA_CLIENTE: "12345678901" }), "OTT-26"), "PARTNERSHIP_REWARD");
  }
  assert.equal(getStoredDrmsCapitolo({ CAPITOLO: "ALTRO" }), "ALTRO");
});

test("la lettura degli upload mantiene SOS Caring e le altre categorie", () => {
  assert.equal(getStoredDrmsCapitolo({
    CAPITOLO: "PARTNERSHIP_REWARD", DESCRIZIONE_ITEM: "Partnership Reward CB SOS Tied",
  }), "SOS_CARING");
  assert.equal(getStoredDrmsCapitolo({ CAPITOLO: "MOBILE", NOME_GARA: "" }), "MOBILE");
});
