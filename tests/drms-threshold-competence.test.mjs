import test from "node:test";
import assert from "node:assert/strict";
import { getDrmsThresholdForLatestCompetence } from "../client/src/lib/drmsClassifier.ts";

const row = (competence, mobile, fixed = "") => ({
  CAPITOLO: "MOBILE",
  SEQ_ID: competence,
  CODICE_NEGOZIO_COSY: "9001402980",
  CODICE_CONTRATTO: "",
  COMPETENZA: competence,
  TIPO_FONIA: mobile === null ? "FISSO" : "MOBILE",
  TIPO_ATTIVAZIONE: "",
  REGOLA_DI_CALCOLO: "",
  DESCRIZIONE_ITEM: "",
  DESCRIZIONE_PIANO_TARIFFARIO: "",
  DESCRIZIONE_EVENTO: mobile === null ? "Gara Attivazioni Fisso" : "Gara Attivazioni Mobile",
  NATURA: "",
  MNP: "",
  SEGMENTO_CLIENT: "",
  TIPO_ACCESSO: "",
  TIPO_LINEA: "",
  FLAG_CONVERGENZA: "",
  FLAG_SOGLIA_MOBILE: mobile ?? "",
  FLAG_SOGLIA_FISSA: fixed,
  IMPORTO_NUM: 0,
  FISCAL_CODE: "",
  P_IVA_CLIENTE: "",
  POD_PDR: "",
  CAUSALE_STORNO: "",
  DATA_EVENTO: "",
  TIPO_TRANSAZIONE: "",
  DT_ATTIVAZIONE: "",
});

test("usa la soglia della competenza più recente, non il massimo storico del file", () => {
  const rows = [
    row("2025-12", "4"),
    row("2026-06", "2"),
    row("2026-07", "3"),
  ];
  assert.deepEqual(
    getDrmsThresholdForLatestCompetence(rows, "9001402980", "MOBILE", ["2025-12", "2026-06", "2026-07"]),
    { value: 3, competence: "2026-07" },
  );
});

test("segue la competenza scelta dall'utente", () => {
  const rows = [
    row("2026-02", null, "2"),
    row("2026-07", null, "1"),
  ];
  assert.deepEqual(
    getDrmsThresholdForLatestCompetence(rows, "9001402980", "FISSO", ["2026-02"]),
    { value: 2, competence: "2026-02" },
  );
  assert.deepEqual(
    getDrmsThresholdForLatestCompetence(rows, "9001402980", "FISSO", ["2026-07"]),
    { value: 1, competence: "2026-07" },
  );
});

test("non usa righe di altri punti vendita", () => {
  const rows = [row("2026-07", "3"), { ...row("2026-07", "4"), CODICE_NEGOZIO_COSY: "ALTRO" }];
  assert.equal(
    getDrmsThresholdForLatestCompetence(rows, "9001402980", "MOBILE", ["2026-07"]).value,
    3,
  );
});