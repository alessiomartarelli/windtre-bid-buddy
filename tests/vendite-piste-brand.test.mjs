// Task #534 — tassonomia piste della pagina Vendite BiSuite per modello
// brand (shared/bisuiteClassification.ts): grafico Andamento KPI, Tabella
// PDV × Pista (Pezzi) ed export consumano questi elenchi condivisi.
// Verifica che il modello Vodafone/Fastweb esponga le 8 piste reali
// (Mobile/Fisso/CB/Luce/Gas/IVA Mobile/IVA Wireline/VAS) SENZA le piste
// WindTre-only né la P.IVA generica, e che il modello WindTre resti
// invariato (comportamento storico).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  VENDITE_PISTE_WINDTRE,
  VENDITE_PISTE_VF,
  venditePisteForModel,
  TREND_PISTE_WINDTRE,
  trendPisteForModel,
  TREND_EXTRA_WINDTRE,
  TREND_EXTRA_VF,
  trendExtraForModel,
  PEZZI_EXTRA_COL_KEYS_WINDTRE,
  PEZZI_EXTRA_COL_KEYS_VF,
  pezziExtraColKeysForModel,
  WINDTRE_ONLY_PISTAS,
  getPistaCanvassLabels,
} from '../shared/bisuiteClassification.ts';

test('WindTre: piste tabella e grafico invariate (comportamento storico)', () => {
  assert.deepEqual(venditePisteForModel(false), ['mobile', 'fisso', 'energia', 'assicurazioni', 'protecta']);
  assert.deepEqual(trendPisteForModel(false), ['mobile', 'fisso', 'energia', 'assicurazioni']);
  assert.deepEqual(trendExtraForModel(false), ['iva', 'cb', 'telefoni']);
  assert.deepEqual(pezziExtraColKeysForModel(false), ['iva', 'cb', 'telefoni', 'accEuro', 'srvEuro']);
  assert.equal(venditePisteForModel(false), VENDITE_PISTE_WINDTRE);
  assert.equal(trendPisteForModel(false), TREND_PISTE_WINDTRE);
  assert.equal(trendExtraForModel(false), TREND_EXTRA_WINDTRE);
  assert.equal(pezziExtraColKeysForModel(false), PEZZI_EXTRA_COL_KEYS_WINDTRE);
});

test('VF: 8 piste reali in ordine, tabella = grafico', () => {
  const expected = ['mobile', 'fisso', 'cb', 'luce', 'gas', 'iva_mobile', 'iva_wireline', 'vas'];
  assert.deepEqual(venditePisteForModel(true), expected);
  assert.deepEqual(trendPisteForModel(true), expected);
  assert.equal(venditePisteForModel(true), VENDITE_PISTE_VF);
});

test('VF: nessuna pista WindTre-only né P.IVA generica', () => {
  const vf = new Set(venditePisteForModel(true));
  for (const p of WINDTRE_ONLY_PISTAS) {
    assert.ok(!vf.has(p), `pista WindTre-only "${p}" non deve comparire nel modello VF`);
  }
  assert.ok(!vf.has('iva'), 'la P.IVA generica non deve comparire nel modello VF');
});

test('VF: extra grafico solo Telefoni, colonne extra senza IVA/CB', () => {
  assert.deepEqual(trendExtraForModel(true), ['telefoni']);
  assert.equal(trendExtraForModel(true), TREND_EXTRA_VF);
  assert.deepEqual(pezziExtraColKeysForModel(true), ['telefoni', 'accEuro', 'srvEuro']);
  assert.equal(pezziExtraColKeysForModel(true), PEZZI_EXTRA_COL_KEYS_VF);
  const cols = new Set(pezziExtraColKeysForModel(true));
  assert.ok(!cols.has('iva') && !cols.has('cb'), 'IVA e CB non devono essere colonne extra nel modello VF');
});

test('ogni pista di entrambi i modelli ha una label', () => {
  for (const isVf of [false, true]) {
    const labels = getPistaCanvassLabels(isVf);
    for (const p of venditePisteForModel(isVf)) {
      assert.ok(typeof labels[p] === 'string' && labels[p].length > 0, `label mancante per "${p}" (vf=${isVf})`);
    }
  }
});

test('la pista cb è Upselling solo per Vodafone/Fastweb', () => {
  assert.equal(getPistaCanvassLabels(true).cb, 'Upselling');
  assert.equal(getPistaCanvassLabels(false).cb, 'CB');
});
