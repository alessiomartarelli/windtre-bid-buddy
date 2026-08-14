import { test } from 'node:test';
import assert from 'node:assert/strict';

// Task #365: foglio "Bilancio IVA" nell'export Excel della Prima Nota IVA.
// Logica pura in shared/bilancioIvaExport.ts (import relativo: i test tsx
// non risolvono l'alias @shared).
import {
  buildBilancioIvaSheet,
  CREDITO_NOTE,
  BILANCIO_IVA_SHEET_NAME,
} from '../shared/bilancioIvaExport.ts';

const ROWS = [
  { rs: 'Alfa Srl', debito: 220, credito: 50, saldo: 170 },
  { rs: 'Beta Snc', debito: 0, credito: 30.5, saldo: -30.5 },
];
const TOT = { debito: 220, credito: 80.5, saldo: 139.5 };

test('nome foglio coerente con la card', () => {
  assert.equal(BILANCIO_IVA_SHEET_NAME, 'Bilancio IVA');
});

test('status ok: righe per RS + TOTALE con numeri, nessuna nota', () => {
  const sheet = buildBilancioIvaSheet(ROWS, TOT, 'ok');
  assert.equal(sheet.length, 3); // 2 RS + TOTALE
  assert.deepEqual(sheet[0], {
    'Ragione Sociale': 'Alfa Srl',
    'IVA a Debito (vendite)': 220,
    'IVA a Credito (spese CdG)': 50,
    'Saldo': 170,
  });
  assert.deepEqual(sheet[1], {
    'Ragione Sociale': 'Beta Snc',
    'IVA a Debito (vendite)': 0,
    'IVA a Credito (spese CdG)': 30.5,
    'Saldo': -30.5,
  });
  const tot = sheet[2];
  assert.equal(tot['Ragione Sociale'], 'TOTALE');
  assert.equal(tot['IVA a Debito (vendite)'], 220);
  assert.equal(tot['IVA a Credito (spese CdG)'], 80.5);
  assert.equal(tot['Saldo'], 139.5);
});

for (const status of ['no_access', 'error']) {
  test(`status ${status}: credito e saldo vuoti (anche nel TOTALE) + riga NOTA`, () => {
    const sheet = buildBilancioIvaSheet(ROWS, TOT, status);
    assert.equal(sheet.length, 4); // 2 RS + TOTALE + NOTA
    // Mai uno zero "silenzioso": credito e saldo vuoti su tutte le righe.
    for (const row of sheet.slice(0, 3)) {
      assert.equal(row['IVA a Credito (spese CdG)'], '');
      assert.equal(row['Saldo'], '');
    }
    // Il debito resta numerico (arriva dalle vendite, sempre disponibile).
    assert.equal(sheet[0]['IVA a Debito (vendite)'], 220);
    assert.equal(sheet[2]['Ragione Sociale'], 'TOTALE');
    assert.equal(sheet[2]['IVA a Debito (vendite)'], 220);
    // Riga NOTA finale con il messaggio specifico per lo status.
    const nota = sheet[3];
    assert.equal(nota['Ragione Sociale'], CREDITO_NOTE[status]);
    assert.match(nota['Ragione Sociale'], /^NOTA: IVA a credito non disponibile/);
    assert.equal(nota['IVA a Debito (vendite)'], '');
  });
}

test('le note distinguono no_access da error', () => {
  assert.notEqual(CREDITO_NOTE.no_access, CREDITO_NOTE.error);
  assert.match(CREDITO_NOTE.no_access, /Controllo di Gestione non accessibile/);
  assert.match(CREDITO_NOTE.error, /errore nel caricamento/);
});

test('nessuna RS: solo TOTALE (e NOTA se credito indisponibile)', () => {
  const zero = { debito: 0, credito: 0, saldo: 0 };
  assert.equal(buildBilancioIvaSheet([], zero, 'ok').length, 1);
  assert.equal(buildBilancioIvaSheet([], zero, 'error').length, 2);
});
