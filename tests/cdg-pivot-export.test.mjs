import { test } from 'node:test';
import assert from 'node:assert/strict';

// Test export Excel pivot voci di costo (Task #357).
//
// Logica PURA: nessun server, nessun DB, nessun xlsx. Testa lo shaping dei
// fogli in shared/cdgPivotExport.ts (estratto da ControlloGestione.tsx):
//   - sanitizeSheetName: >31 char, caratteri vietati, collisioni (dedup);
//   - modalità "Ragione Sociale": foglio Totale + un foglio per RS con
//     voci di costo come righe e riga Totale;
//   - modalità "Punto Vendita": righe PDV × categorie, colonna+riga Totale
//     per RS, colonne limitate a quelle usate dall'RS;
//   - coerenza dei totali con la riga Totale a schermo (totaleGenerale,
//     colTot, somma fogli RS = totale generale).

const { sanitizeSheetName, buildPivotExportSheets } =
  await import('../shared/cdgPivotExport.ts');

// --- Helper per costruire l'input come lo produce pivotData a schermo ---

// spese: [{ rs, pdv (label riga in modalità pdv), cat, imp }]
function buildPivotInput(spese, pivotRaggr) {
  const colonne = new Set();
  const righe = new Map();
  const colTot = new Map();
  let totaleGenerale = 0;
  for (const s of spese) {
    colonne.add(s.cat);
    const rowKey = pivotRaggr === 'rs' ? s.rs : `${s.rs}|${s.pdv || '__nessuno__'}`;
    const rowLabel = pivotRaggr === 'rs' ? s.rs : `${s.pdv || 'Costi generali'} · ${s.rs}`;
    const r = righe.get(rowKey) || { label: rowLabel, rs: s.rs, values: new Map(), totale: 0 };
    r.values.set(s.cat, (r.values.get(s.cat) || 0) + s.imp);
    r.totale += s.imp;
    righe.set(rowKey, r);
    colTot.set(s.cat, (colTot.get(s.cat) || 0) + s.imp);
    totaleGenerale += s.imp;
  }
  const colonneArr = Array.from(colonne).sort((a, b) => (colTot.get(b) || 0) - (colTot.get(a) || 0));
  const righeArr = Array.from(righe.values()).sort((a, b) => b.totale - a.totale);
  return { colonne: colonneArr, righe: righeArr, colTot, totaleGenerale, pivotRaggr };
}

// --- sanitizeSheetName ---

test('sanitizeSheetName: tronca a 31 caratteri', () => {
  const used = new Set();
  const name = sanitizeSheetName('A'.repeat(40), used);
  assert.equal(name.length, 31);
  assert.equal(name, 'A'.repeat(31));
});

test('sanitizeSheetName: rimuove caratteri vietati Excel', () => {
  const used = new Set();
  const name = sanitizeSheetName('RS: Alfa/Beta [test]? *', used);
  assert.equal(name, 'RS Alfa Beta test');
  for (const ch of ['\\\\', '/', '?', '*', '[', ']', ':']) {
    assert.ok(!name.includes(ch), `contiene ${ch}`);
  }
});

test('sanitizeSheetName: nome vuoto dopo sanificazione => "Foglio"', () => {
  const used = new Set();
  assert.equal(sanitizeSheetName('///***', used), 'Foglio');
});

test('sanitizeSheetName: collisioni dedupplicate con suffisso (n)', () => {
  const used = new Set();
  assert.equal(sanitizeSheetName('Alfa Srl', used), 'Alfa Srl');
  assert.equal(sanitizeSheetName('Alfa Srl', used), 'Alfa Srl (2)');
  // Collisione case-insensitive
  assert.equal(sanitizeSheetName('ALFA SRL', used), 'ALFA SRL (3)');
});

test('sanitizeSheetName: collisione su nome lungo resta entro 31 char', () => {
  const used = new Set();
  const long = 'Ragione Sociale Molto Lunga SpA Holding';
  const a = sanitizeSheetName(long, used);
  const b = sanitizeSheetName(long, used);
  assert.equal(a.length, 31);
  assert.ok(b.length <= 31);
  assert.ok(b.endsWith(' (2)'));
  assert.notEqual(a.toLowerCase(), b.toLowerCase());
});

// --- buildPivotExportSheets: modalità "Ragione Sociale" ---

const SPESE_RS = [
  { rs: 'Alfa Srl', cat: 'Affitto', imp: 1000 },
  { rs: 'Alfa Srl', cat: 'Utenze', imp: 250.5 },
  { rs: 'Beta Snc', cat: 'Affitto', imp: 400 },
  { rs: 'Beta Snc', cat: 'Personale', imp: 2000 },
];

test('modalità RS: foglio Totale + un foglio per RS, ordinati per totale', () => {
  const sheets = buildPivotExportSheets(buildPivotInput(SPESE_RS, 'rs'));
  assert.deepEqual(sheets.map(s => s.name), ['Totale', 'Beta Snc', 'Alfa Srl']);
});

test('modalità RS: foglio Totale replica la tabella a schermo con riga Totale', () => {
  const input = buildPivotInput(SPESE_RS, 'rs');
  const [tot] = buildPivotExportSheets(input);
  assert.equal(tot.rows.length, 3); // 2 RS + riga Totale
  const beta = tot.rows[0];
  assert.equal(beta['Ragione Sociale'], 'Beta Snc');
  assert.equal(beta['Affitto'], 400);
  assert.equal(beta['Personale'], 2000);
  assert.equal(beta['Utenze'], 0);
  assert.equal(beta['Totale'], 2400);
  const last = tot.rows.at(-1);
  assert.equal(last['Ragione Sociale'], 'Totale');
  assert.equal(last['Affitto'], 1400);
  assert.equal(last['Personale'], 2000);
  assert.equal(last['Utenze'], 250.5);
  assert.equal(last['Totale'], 3650.5); // totaleGenerale a schermo
  assert.equal(last['Totale'], input.totaleGenerale);
});

test('modalità RS: foglio per RS = voci di costo non-zero + riga Totale', () => {
  const sheets = buildPivotExportSheets(buildPivotInput(SPESE_RS, 'rs'));
  const alfa = sheets.find(s => s.name === 'Alfa Srl');
  // Solo le voci usate da Alfa (niente Personale a 0)
  assert.deepEqual(alfa.rows.map(r => r['Voce di costo']), ['Affitto', 'Utenze', 'Totale']);
  assert.equal(alfa.rows.at(-1)['Importo'], 1250.5);
  const somma = alfa.rows.slice(0, -1).reduce((s, r) => s + r['Importo'], 0);
  assert.equal(somma, alfa.rows.at(-1)['Importo']);
});

test('modalità RS: somma dei fogli RS = totale generale a schermo', () => {
  const input = buildPivotInput(SPESE_RS, 'rs');
  const sheets = buildPivotExportSheets(input);
  const sommaRs = sheets.slice(1).reduce((s, sh) => s + sh.rows.at(-1)['Importo'], 0);
  assert.equal(sommaRs, input.totaleGenerale);
});

// --- buildPivotExportSheets: modalità "Punto Vendita" ---

const SPESE_PDV = [
  { rs: 'Alfa Srl', pdv: 'Negozio Centro', cat: 'Affitto', imp: 700 },
  { rs: 'Alfa Srl', pdv: 'Negozio Centro', cat: 'Utenze', imp: 100 },
  { rs: 'Alfa Srl', pdv: 'Negozio Mare', cat: 'Affitto', imp: 300 },
  { rs: 'Alfa Srl', pdv: null, cat: 'Consulenze', imp: 50 }, // costi generali
  { rs: 'Beta Snc', pdv: 'Negozio Beta', cat: 'Personale', imp: 2000 },
];

test('modalità PDV: righe PDV, colonna e riga Totale coerenti', () => {
  const input = buildPivotInput(SPESE_PDV, 'pdv');
  const sheets = buildPivotExportSheets(input);
  assert.deepEqual(sheets.map(s => s.name), ['Totale', 'Beta Snc', 'Alfa Srl']);

  // Foglio Totale: header "Punto Vendita", riga Totale = totaleGenerale.
  const tot = sheets[0];
  assert.ok('Punto Vendita' in tot.rows[0]);
  assert.equal(tot.rows.at(-1)['Punto Vendita'], 'Totale');
  assert.equal(tot.rows.at(-1)['Totale'], input.totaleGenerale);
  assert.equal(input.totaleGenerale, 3150);

  // Foglio Alfa: 3 righe PDV (incl. Costi generali) + riga Totale.
  const alfa = sheets.find(s => s.name === 'Alfa Srl');
  assert.equal(alfa.rows.length, 4);
  const labels = alfa.rows.map(r => r['Punto Vendita']);
  assert.ok(labels.includes('Negozio Centro · Alfa Srl'));
  assert.ok(labels.includes('Costi generali · Alfa Srl'));
  // Colonne limitate a quelle usate da Alfa: niente "Personale".
  assert.ok(!('Personale' in alfa.rows[0]));
  const totRow = alfa.rows.at(-1);
  assert.equal(totRow['Punto Vendita'], 'Totale');
  assert.equal(totRow['Affitto'], 1000);
  assert.equal(totRow['Utenze'], 100);
  assert.equal(totRow['Consulenze'], 50);
  assert.equal(totRow['Totale'], 1150);
  // Riga Totale = somma delle righe PDV.
  const sommaPdv = alfa.rows.slice(0, -1).reduce((s, r) => s + r['Totale'], 0);
  assert.equal(sommaPdv, totRow['Totale']);
});

test('modalità PDV: somma fogli RS = totale generale', () => {
  const input = buildPivotInput(SPESE_PDV, 'pdv');
  const sheets = buildPivotExportSheets(input);
  const somma = sheets.slice(1).reduce((s, sh) => s + sh.rows.at(-1)['Totale'], 0);
  assert.equal(somma, input.totaleGenerale);
});

// --- Nomi foglio: casi limite dentro l'export completo ---

test('export: nomi RS lunghi/vietati/collidenti producono fogli univoci', () => {
  const longA = 'Ragione Sociale Lunghissima Che Supera 31 SpA';
  const longB = 'Ragione Sociale Lunghissima Che Supera 31 Srl'; // collide dopo troncamento
  const spese = [
    { rs: longA, cat: 'Affitto', imp: 100 },
    { rs: longB, cat: 'Affitto', imp: 90 },
    { rs: 'Alfa: [Roma]/Nord*', cat: 'Utenze', imp: 80 },
    { rs: 'Totale', cat: 'Affitto', imp: 70 }, // collide col foglio riepilogo
  ];
  const sheets = buildPivotExportSheets(buildPivotInput(spese, 'rs'));
  const names = sheets.map(s => s.name);
  assert.equal(new Set(names.map(n => n.toLowerCase())).size, names.length, 'nomi non univoci');
  for (const n of names) {
    assert.ok(n.length <= 31, `nome > 31: ${n}`);
    assert.ok(!/[\\/?*[\]:]/.test(n), `caratteri vietati in: ${n}`);
  }
  assert.equal(names[0], 'Totale');
  assert.ok(names.includes('Totale (2)')); // la RS "Totale" viene dedupplicata
  assert.ok(names.includes('Alfa Roma Nord'));
});

test('export: nessuna riga => nessun foglio (nessun file)', () => {
  const sheets = buildPivotExportSheets(buildPivotInput([], 'rs'));
  assert.deepEqual(sheets, []);
});
