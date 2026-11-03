import test from "node:test";
import assert from "node:assert/strict";
import {
  CAPITOLI_CONFIG, classificaRiga, classifyAndNormalize,
  getStoredDrmsCapitolo, isDrmsProtecta,
} from "../client/src/lib/drmsClassifier.ts";

const raw = (extra = {}) => ({
  NOME_GARA: "Gara Protecta", NATURA: "GARE", TIPO_FONIA: "PROTECTA",
  COMPETENZA: "OTT-26", IMPORTO: "125,50", ...extra,
});

test("Gara Protecta ha una categoria dedicata senza dipendere dalla fonia generica", () => {
  assert.equal(CAPITOLI_CONFIG.PROTECTA.label, "Protecta");
  assert.equal(classificaRiga(raw(), "OTT-26"), "PROTECTA");
  assert.equal(classificaRiga(raw({ TIPO_FONIA: "ASSICURAZIONI" }), "OTT-26"), "PROTECTA");
});

test("accetta NOME_GARA e NOME GARA normalizzando spazi e maiuscole", () => {
  assert.equal(isDrmsProtecta({ NOME_GARA: " gara   PROTECTA " }), true);
  const [row] = classifyAndNormalize([raw({ NOME_GARA: undefined, "NOME GARA": "Gara Protecta" })], "OTT-26");
  assert.equal(row.CAPITOLO, "PROTECTA");
  assert.equal(row.NOME_GARA, "Gara Protecta");
});

test("salvataggio e riapertura preservano nome, importi e campi originali per esiti CJ", () => {
  const rows = JSON.parse(JSON.stringify(classifyAndNormalize([
    raw(), raw({ IMPORTO: "-25,00" }),
  ], "OTT-26")));
  assert.deepEqual(rows.map(r => r.IMPORTO_NUM), [125.5, -25]);
  for (const row of rows) {
    assert.equal(row.NOME_GARA, "Gara Protecta");
    assert.equal(row.NATURA, "GARE");
    assert.equal(row.TIPO_FONIA, "PROTECTA");
    assert.equal(getStoredDrmsCapitolo({ ...row, CAPITOLO: "ALTRO" }), "PROTECTA");
  }
});

test("non deduce la gara da fonia, descrizioni parziali o campi legacy mancanti", () => {
  for (const NOME_GARA of [undefined, "", "Gara Protecta altro", "Altra gara"]) {
    assert.equal(isDrmsProtecta({ NOME_GARA }), false);
    assert.equal(classificaRiga(raw({ NOME_GARA }), "OTT-26"), null);
  }
  assert.equal(getStoredDrmsCapitolo({ CAPITOLO: "ALTRO", TIPO_FONIA: "PROTECTA" }), "ALTRO");
  assert.equal(classificaRiga(raw({ NOME_GARA: "", TIPO_FONIA: "ASSICURAZIONI" }), "OTT-26"), "ASSICURAZIONI");
});

test("Extra P.iva e SOS Caring restano separate da Protecta", () => {
  assert.equal(classificaRiga(raw({ NOME_GARA: "Gara PIVA Franchising" }), "OTT-26"), "EXTRA_PIVA");
  assert.equal(classificaRiga(raw({
    NOME_GARA: "", DESCRIZIONE_ITEM: "Partnership Reward CB SOS Tied",
  }), "OTT-26"), "SOS_CARING");
});
