import { test } from 'node:test';
import assert from 'node:assert/strict';

// Test suite Incentivazione interna (gare addetto) — logica pura condivisa
// (`shared/incentivazione.ts`). Sono funzioni pure (nessun server / DB), quindi
// il test importa direttamente il modulo TS via loader `tsx`.
//
// Copre i tre punti critici della gara nel tempo:
//   - `buildCalendar` per mese futuro / corrente / passato (el, tot, mult, pct,
//     rem, from, to) + esclusione festività. Regressione del bug per cui un mese
//     futuro riportava giorni trascorsi != 0 (proiezione e "sblocco gara"
//     distorti).
//   - `projV` / `semOf` inclusi i casi limite (el === 0, valore nullo).
//   - `buildEmps` inclusi `unlockProjected` (tutti i lucchetti g|a),
//     il caso senza dati e il merge dei dati live BiSuite.

const {
  buildCalendar,
  projV,
  semOf,
  buildEmps,
} = await import('../shared/incentivazione.ts');

// Luglio 2026: nessuna festività nazionale, 23 giorni lavorativi
// (1 lug = mercoledì, 31 lug = venerdì).
const JUL_TOT = 23;
const NO_HOL = [];

// ===========================================================================
// buildCalendar — MESE FUTURO: `now` precede l'inizio del mese di gara.
// Nessun giorno trascorso => proiezione neutralizzata (mult 0). È la
// regressione che il task vuole bloccare.
// ===========================================================================
test('buildCalendar: future month reports zero elapsed days', () => {
  const cal = buildCalendar(2026, 7, NO_HOL, new Date(2026, 5, 1)); // 1 giu 2026
  assert.equal(cal.el, 0, 'future month must have 0 elapsed working days');
  assert.equal(cal.tot, JUL_TOT);
  assert.equal(cal.rem, JUL_TOT, 'all working days still remaining');
  assert.equal(cal.pct, 0);
  assert.equal(cal.mult, 0, 'multiplier must be 0 (no projection) for a future month');
  assert.equal(cal.from, '2026-07-01');
  assert.equal(cal.to, '2026-07-01', 'to clamps to month start when nothing elapsed');
});

// ===========================================================================
// buildCalendar — MESE PASSATO: `now` segue la fine del mese => mese intero
// trascorso (el === tot), gara conclusa.
// ===========================================================================
test('buildCalendar: past month is fully elapsed', () => {
  const cal = buildCalendar(2026, 7, NO_HOL, new Date(2026, 7, 15)); // 15 ago 2026
  assert.equal(cal.el, JUL_TOT, 'past month: every working day elapsed');
  assert.equal(cal.tot, JUL_TOT);
  assert.equal(cal.rem, 0);
  assert.equal(cal.pct, 100);
  assert.equal(cal.mult, 1, 'multiplier collapses to 1 when month is fully elapsed');
  assert.equal(cal.from, '2026-07-01');
  assert.equal(cal.to, '2026-07-31', 'to clamps to last day of month');
});

// ===========================================================================
// buildCalendar — MESE CORRENTE: `now` a metà mese => giorni parziali e
// moltiplicatore di proiezione = tot / el.
// ===========================================================================
test('buildCalendar: current month gives partial elapsed + projection multiplier', () => {
  const cal = buildCalendar(2026, 7, NO_HOL, new Date(2026, 6, 15)); // 15 lug 2026
  assert.equal(cal.el, 11, '11 working days from 1 to 15 July 2026');
  assert.equal(cal.tot, JUL_TOT);
  assert.equal(cal.rem, JUL_TOT - 11);
  assert.equal(cal.pct, 48, 'round(11/23*100) = 48');
  assert.equal(cal.mult, JUL_TOT / 11);
  assert.equal(cal.to, '2026-07-15');
});

// ===========================================================================
// buildCalendar — ESCLUSIONE FESTIVITÀ: un giorno lavorativo dichiarato
// festivo riduce sia tot sia el.
// ===========================================================================
test('buildCalendar: a holiday on a weekday is excluded from working days', () => {
  const cal = buildCalendar(2026, 7, ['2026-07-06'], new Date(2026, 7, 15)); // 6 lug = lunedì
  assert.equal(cal.tot, JUL_TOT - 1, 'holiday removes one working day from total');
  assert.equal(cal.el, JUL_TOT - 1, 'past month: elapsed also drops by the holiday');
  // Una festività di sabato/domenica non cambia nulla (già non lavorativo).
  const calWeekend = buildCalendar(2026, 7, ['2026-07-04'], new Date(2026, 7, 15)); // 4 lug = sabato
  assert.equal(calWeekend.tot, JUL_TOT, 'weekend holiday does not change the count');
});

// ===========================================================================
// projV — proiezione lineare. Null se valore nullo o se nessun giorno trascorso.
// ===========================================================================
test('projV: linear projection with null guards', () => {
  const cal = { el: 5, tot: 10, rem: 5, pct: 50, mult: 2, from: '', to: '' };
  assert.equal(projV(10, cal), 20, 'v / el * tot = 10/5*10 = 20');
  assert.equal(projV(null, cal), null, 'null value => null projection');
  const calNoElapsed = { ...cal, el: 0 };
  assert.equal(projV(10, calNoElapsed), null, 'no elapsed days => null projection');
});

// ===========================================================================
// semOf — semaforo: g (raggiunto), a (proiettato sopra target), r (sotto),
// u (nessun dato). Caso limite: el === 0 => proiezione null => r.
// ===========================================================================
test('semOf: traffic-light states', () => {
  const cal = { el: 5, tot: 10, rem: 5, pct: 50, mult: 2, from: '', to: '' };
  assert.equal(semOf(null, 50, cal), 'u', 'no data => u');
  assert.equal(semOf(50, 50, cal), 'g', 'actual >= target => g');
  assert.equal(semOf(60, 50, cal), 'g', 'actual above target => g');
  // 30 ora, proiettato 30/5*10 = 60 >= 50 => a
  assert.equal(semOf(30, 50, cal), 'a', 'below target but projected over => a');
  // 10 ora, proiettato 10/5*10 = 20 < 50 => r
  assert.equal(semOf(10, 50, cal), 'r', 'below target and projected under => r');
  // el === 0 => projV null => non raggiunto => r
  const calNoElapsed = { ...cal, el: 0 };
  assert.equal(semOf(10, 50, calNoElapsed), 'r', 'no elapsed days => r when below target');
  assert.equal(semOf(50, 50, calNoElapsed), 'g', 'already reached even with 0 elapsed => g');
});

// ── tracks di prova per buildEmps ──────────────────────────────────────────
const TRACKS = [
  { id: 'mobile', name: 'Mobile', target: 50, unit: 'pt', isLock: false },
  { id: 'assicurazione', name: 'Assicurazione', target: 7, unit: 'pt', isLock: true },
  { id: 'iva', name: 'IVA', target: 10, unit: 'pt', isLock: true },
  { id: 'accessori', name: 'Accessori', target: 100, unit: '€', isLock: false, live: true },
];

// el=5, tot=10 => moltiplicatore proiezione = 2.
const CAL = { el: 5, tot: 10, rem: 5, pct: 50, mult: 2, from: '', to: '' };

// ===========================================================================
// buildEmps — caso vuoto: nessuna riga valenze => nessun addetto.
// ===========================================================================
test('buildEmps: empty rows => no employees', () => {
  assert.deepEqual(buildEmps(TRACKS, [], [], CAL), []);
});

// ===========================================================================
// buildEmps — addetto senza alcun dato: tutto u, gara NON sbloccata.
// ===========================================================================
test('buildEmps: row with no data is all unknown and does not unlock', () => {
  const [emp] = buildEmps(TRACKS, [{ name: 'Mario' }], [], CAL);
  assert.equal(emp.name, 'Mario');
  assert.equal(emp.status, 'u', 'no data => global status u');
  assert.equal(emp.unlockProjected, false, 'no lock reached/projected => stays locked');
  for (const t of TRACKS) assert.equal(emp.tds[t.id].sem, 'u');
});

// ===========================================================================
// buildEmps — unlockProjected TRUE: tutti i lucchetti g oppure a.
//   assicurazione=7 (= target) => g
//   iva=6, proiettato 6/5*10=12 >= 10 => a
// ===========================================================================
test('buildEmps: all blocking locks g|a => unlockProjected true', () => {
  const rows = [{ name: 'Anna', mobile: 60, assicurazione: 7, iva: 6, accessori: 50 }];
  const [emp] = buildEmps(TRACKS, rows, [], CAL);
  const lockSem = Object.fromEntries(emp.locks.map((l) => [l.id, l.sem]));
  assert.equal(lockSem.assicurazione, 'g');
  assert.equal(lockSem.iva, 'a');
  assert.equal(emp.unlockProjected, true, 'every lock g|a => unlocks');
});

// ===========================================================================
// buildEmps — unlockProjected FALSE: un lucchetto è rosso.
//   iva=2, proiettato 2/5*10=4 < 10 => r
// ===========================================================================
test('buildEmps: a red blocking lock => unlockProjected false', () => {
  const rows = [{ name: 'Luca', mobile: 60, assicurazione: 7, iva: 2, accessori: 200 }];
  const [emp] = buildEmps(TRACKS, rows, [], CAL);
  const lockSem = Object.fromEntries(emp.locks.map((l) => [l.id, l.sem]));
  assert.equal(lockSem.iva, 'r', 'iva projects under target => r');
  assert.equal(emp.unlockProjected, false, 'one red lock blocks the unlock');
});

// ===========================================================================
// buildEmps — merge dati live BiSuite: Accessori/Servizi arrivano dal
// connettore (match nome case-insensitive) e sovrascrivono la riga valenze.
// ===========================================================================
test('buildEmps: live BiSuite data overrides the valenze row', () => {
  const rows = [{ name: 'Giulia', mobile: 60, assicurazione: 7, iva: 12, accessori: null }];
  const live = [{ name: 'GIULIA', acc: 120, serv: 0 }];
  const [emp] = buildEmps(TRACKS, rows, live, CAL);
  assert.equal(emp.tds.accessori.actual, 120, 'live acc value merged into accessori');
  assert.equal(emp.tds.accessori.sem, 'g', '120 >= target 100 => g');
});

// ===========================================================================
// buildEmps — ordinamento per stato: rosso prima, verde dopo
// (STATUS_ORDER r < a/u < g).
// ===========================================================================
test('buildEmps: employees sorted worst-status first', () => {
  const rows = [
    { name: 'Verde', mobile: 60, assicurazione: 7, iva: 12, accessori: 200 }, // tutti g
    { name: 'Rosso', mobile: 1, assicurazione: 7, iva: 1, accessori: 1 }, // qualche r
  ];
  const emps = buildEmps(TRACKS, rows, [], CAL);
  assert.equal(emps[0].name, 'Rosso', 'worst status (r) sorts first');
  assert.equal(emps[1].name, 'Verde');
});

// ===========================================================================
// parseValenzeAoa — lettura del file Excel valenze REALE (foglio "Riepilogo"
// del report WindTre). Fixture stabile in tests/fixtures/valenze-w3.xlsx.
// Verifica che il mapping per-posizione delle piste W3 estragga i valori giusti
// dal file di produzione, ignori la colonna separatore vuota, le 9 colonne
// "... Proiezione" calcolate e la 2ª "PISTA FISSO" (col I, non usata dal
// regolamento), e che la pista J sia "Extra Marginalità" (non "Smartphone").
// ===========================================================================
const XLSX = await import('xlsx');
const { readFileSync } = await import('node:fs');
const { defaultSections, parseValenzeAoa } = await import('../shared/incentivazione.ts');

function loadValenzeFixture() {
  const buf = readFileSync(new URL('./fixtures/valenze-w3.xlsx', import.meta.url));
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
}

const W3_TRACKS = defaultSections().find((s) => s.id === 'ss_w3').tracks;

test('parseValenzeAoa: real Excel — header layout and row count', () => {
  const aoa = loadValenzeFixture();
  assert.ok(aoa.length >= 2, 'fixture must have a header + data rows');
  const header = aoa[0].map((h) => String(h).trim());
  assert.equal(header[0], 'Addetto');
  assert.deepEqual(header.slice(1, 10), [
    'PISTA MOBILE', 'PISTA FISSO', 'PISTA CB', 'PISTA ASSICURAZIONI',
    'PISTA IVA W3', 'PISTA ENERGIA', 'PISTA PROTECTA', 'PISTA FISSO',
    'PISTA EXTRA MARGINALITA',
  ]);
  assert.equal(header[10], '', 'col K is the empty separator');
  assert.ok(header.slice(11).every((h) => /Proiezione$/.test(h)),
    'cols from L onward are computed "Proiezione" columns');
});

test('parseValenzeAoa: real Excel — values mapped by fixed position', () => {
  const rows = parseValenzeAoa(loadValenzeFixture(), W3_TRACKS);
  assert.equal(rows.length, 40, 'file has 40 addetti (no Totale/Media rows)');

  const vit = rows.find((r) => r.name === 'Vitiello Marco');
  assert.ok(vit, 'Vitiello Marco present');
  assert.equal(vit.mobile, 55.5);
  assert.equal(vit.fisso, 22.75);
  assert.equal(vit.cb_rete, 30);
  assert.equal(vit.assicurazione, 13.5);
  assert.equal(vit.iva, 11.5);
  assert.equal(vit.energia, 13);
  assert.equal(vit.protecta, 2);
  // col J = "PISTA EXTRA MARGINALITA" (25), non la 2ª PISTA FISSO col I (5.25).
  assert.equal(vit.extra_marginalita, 25, 'col J read as Extra Marginalità');
  assert.ok(!('smartphone' in vit), 'no legacy "smartphone" key');
});

test('parseValenzeAoa: real Excel — ignores projection + extra columns', () => {
  const rows = parseValenzeAoa(loadValenzeFixture(), W3_TRACKS);
  const keys = Object.keys(rows[0]).filter((k) => k !== 'name');
  // Solo le 8 piste W3 con colonna Excel (mobile..extra_marginalita); le live
  // (accessori/servizi) e tutto il resto (proiezioni, separatore, 2ª fisso)
  // non devono comparire.
  assert.deepEqual(
    keys.sort(),
    ['assicurazione', 'cb_rete', 'energia', 'extra_marginalita', 'fisso', 'iva', 'mobile', 'protecta'],
  );
});
