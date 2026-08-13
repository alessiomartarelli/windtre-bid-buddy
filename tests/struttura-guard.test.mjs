// Test della guardia anti-azzeramento struttura (shared/strutturaGuard.ts).
// Logica pura: niente server né DB. Task #338.
import test from "node:test";
import assert from "node:assert/strict";
import {
  hasAnagrafica,
  countPdvConAnagrafica,
  wouldMassBlankPuntiVendita,
} from "../shared/strutturaGuard.ts";

const pdvPieno = (over = {}) => ({
  id: "pdv-0-abc123",
  codicePos: "9001046475",
  nome: "Fiumicino",
  ragioneSociale: "CMS S.R.L",
  canale: "franchising",
  ...over,
});

const pdvScheletro = () => ({
  id: "pdv-0-xyz999",
  codicePos: "",
  nome: "",
  ragioneSociale: "",
  canale: "franchising",
  tipoPosizione: "strada",
  calendar: { weeklySchedule: { workingDays: [1, 2, 3, 4, 5, 6] } },
});

test("hasAnagrafica: true se almeno un campo anagrafico è valorizzato", () => {
  assert.equal(hasAnagrafica(pdvPieno()), true);
  assert.equal(hasAnagrafica(pdvPieno({ codicePos: "", nome: "", ragioneSociale: "X" })), true);
  assert.equal(hasAnagrafica(pdvPieno({ codicePos: "", nome: "Solo nome", ragioneSociale: "" })), true);
});

test("hasAnagrafica: false per scheletro, whitespace, malformati", () => {
  assert.equal(hasAnagrafica(pdvScheletro()), false);
  assert.equal(hasAnagrafica(pdvPieno({ codicePos: "  ", nome: " ", ragioneSociale: "" })), false);
  assert.equal(hasAnagrafica(null), false);
  assert.equal(hasAnagrafica("stringa"), false);
  assert.equal(hasAnagrafica({ codicePos: 123 }), false);
});

test("countPdvConAnagrafica: conta solo i PDV reali, tollera input malformati", () => {
  assert.equal(countPdvConAnagrafica([pdvPieno(), pdvScheletro(), pdvPieno()]), 2);
  assert.equal(countPdvConAnagrafica([]), 0);
  assert.equal(countPdvConAnagrafica(undefined), 0);
  assert.equal(countPdvConAnagrafica("non-array"), 0);
  assert.equal(countPdvConAnagrafica([null, 42]), 0);
});

test("BLOCCA il pattern dell'incidente: struttura piena → tutti scheletro", () => {
  const current = Array.from({ length: 13 }, (_, i) => pdvPieno({ id: `pdv-${i}` }));
  const incoming = Array.from({ length: 13 }, () => pdvScheletro());
  assert.equal(wouldMassBlankPuntiVendita(current, incoming), true);
});

test("BLOCCA anche l'azzeramento a array vuoto", () => {
  assert.equal(wouldMassBlankPuntiVendita([pdvPieno()], []), true);
});

test("BLOCCA l'azzeramento quasi-totale: 1 riga compilata + scheletri al posto di 13 reali", () => {
  const current = Array.from({ length: 13 }, (_, i) => pdvPieno({ id: `pdv-${i}`, codicePos: `900${i}` }));
  const incoming = [pdvPieno({ codicePos: "9999", nome: "Solo uno" }), ...Array.from({ length: 12 }, () => pdvScheletro())];
  assert.equal(wouldMassBlankPuntiVendita(current, incoming), true);
});

test("NON blocca modifiche legittime", () => {
  const current = [pdvPieno(), pdvPieno({ id: "b", codicePos: "9002" })];
  // modifica di un campo
  assert.equal(wouldMassBlankPuntiVendita(current, [pdvPieno({ nome: "Nuovo nome" }), pdvPieno({ id: "b", codicePos: "9002" })]), false);
  // rimozione parziale (senza scheletri nel payload)
  assert.equal(wouldMassBlankPuntiVendita(current, [pdvPieno()]), false);
  // aggiunta di uno scheletro accanto ai reali (wizard a metà)
  assert.equal(wouldMassBlankPuntiVendita(current, [...current, pdvScheletro()]), false);
});

test("NON blocca quando la struttura corrente è vuota o scheletro (primo setup)", () => {
  assert.equal(wouldMassBlankPuntiVendita([], [pdvScheletro()]), false);
  assert.equal(wouldMassBlankPuntiVendita(undefined, [pdvScheletro()]), false);
  assert.equal(wouldMassBlankPuntiVendita([pdvScheletro()], [pdvScheletro(), pdvScheletro()]), false);
});

test("NON blocca quando incoming non è un array (chiave omessa: gestita con re-iniezione)", () => {
  assert.equal(wouldMassBlankPuntiVendita([pdvPieno()], undefined), false);
  assert.equal(wouldMassBlankPuntiVendita([pdvPieno()], null), false);
});
