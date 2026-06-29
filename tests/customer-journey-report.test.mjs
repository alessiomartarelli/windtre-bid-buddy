import { test } from 'node:test';
import assert from 'node:assert/strict';

// Test suite Customer Journey reportistica + filtri condivisi (Task #189).
// Logica pura di `shared/customerJourney.ts`: NON serve né dev server né DB,
// il modulo TS è caricato via loader `tsx`.
//
// Copre i due target del task:
//   - `aggregateReport`: aggregazione item-level lungo una dimensione
//     (negozio / addetto / cliente). clienti = journey distinte (Set su
//     journeyId), contratti = numero item, attivati = item in stato attivo
//     (CJ_ACTIVE_STATES), valore = somma importi, ordinamento per valore↓.
//   - `matchesCjFilters` + `cjSearchMatches`: il filtraggio condiviso fra
//     "Schede clienti" e "Reportistica". Lo stesso predicato deve agire in
//     modo identico su una journey (array di facet PDV/addetti/stati) e su una
//     riga report (singolo PDV/addetto/stato wrappato in array).

const {
  aggregateReport,
  matchesCjFilters,
  cjSearchMatches,
  CJ_ACTIVE_STATES,
  CJ_GETTONE_TABLE,
  CJ_MAX_PISTE,
  gettoneForPiste,
  gettoneIncremento,
  buildGettoneJourneys,
  filterGettoneByDate,
  aggregateGettone,
  gettoneTotals,
  crossSellPercentuali,
  simSaturationPct,
  gettoneDetailByKey,
} = await import('../shared/customerJourney.ts');

// Helper: costruisce una riga report con default sensati.
function row(over = {}) {
  return {
    journeyId: 'j1',
    customerKey: 'k1',
    customerType: 'privato',
    cliente: 'Mario Rossi',
    pdv: 'PDV Roma',
    addetto: 'Anna',
    state: 'attivato',
    driver: 'mobile',
    valore: 10,
    ...over,
  };
}

const byPdv = (r) => ({ key: r.pdv || '—', label: r.pdv || 'Senza negozio' });
const byAddetto = (r) => ({ key: r.addetto || '—', label: r.addetto || 'Senza addetto' });
const byCliente = (r) => ({ key: r.journeyId, label: r.cliente || r.customerKey });

// ===========================================================================
// CJ_ACTIVE_STATES: contratto degli stati "attivi" su cui si basa il conteggio
// `attivati`. Blocca regressioni se qualcuno tocca l'insieme.
// ===========================================================================
test('CJ_ACTIVE_STATES: solo gli stati non-KO/annullato/stornato', () => {
  for (const s of ['inserito', 'in_lavorazione', 'attivato', 'pagato', 'riaccreditato']) {
    assert.equal(CJ_ACTIVE_STATES.has(s), true, `${s} deve contare come attivo`);
  }
  for (const s of ['ko', 'annullato', 'stornato']) {
    assert.equal(CJ_ACTIVE_STATES.has(s), false, `${s} NON deve contare come attivo`);
  }
});

// ===========================================================================
// aggregateReport — conteggi per dimensione NEGOZIO.
// Due journey distinte nello stesso PDV con stati misti: clienti = 2 (Set),
// contratti = 3 item, attivati = 2 (uno ko escluso), valore = somma.
// ===========================================================================
test('aggregateReport: per negozio, clienti=journey distinte, contratti=item', () => {
  const rows = [
    row({ journeyId: 'j1', pdv: 'PDV Roma', state: 'attivato', valore: 10 }),
    row({ journeyId: 'j1', pdv: 'PDV Roma', state: 'ko', valore: 5 }),
    row({ journeyId: 'j2', pdv: 'PDV Roma', state: 'pagato', valore: 20 }),
  ];
  const g = aggregateReport(rows, byPdv);
  assert.equal(g.length, 1, 'un solo negozio');
  assert.equal(g[0].key, 'PDV Roma');
  assert.equal(g[0].clienti, 2, 'due journey distinte (j1, j2)');
  assert.equal(g[0].contratti, 3, 'tre item totali');
  assert.equal(g[0].attivati, 2, 'ko escluso dal conteggio attivati');
  assert.equal(g[0].valore, 35, 'somma 10+5+20');
});

// ===========================================================================
// aggregateReport — clienti conta journey DISTINTE, non item.
// Stessa journey con 3 item => clienti = 1.
// ===========================================================================
test('aggregateReport: clienti = journey distinte anche con più item', () => {
  const rows = [
    row({ journeyId: 'j1', driver: 'mobile' }),
    row({ journeyId: 'j1', driver: 'fisso' }),
    row({ journeyId: 'j1', driver: 'energia' }),
  ];
  const g = aggregateReport(rows, byPdv);
  assert.equal(g[0].clienti, 1, 'una sola journey distinta');
  assert.equal(g[0].contratti, 3, 'tre contratti/item');
});

// ===========================================================================
// aggregateReport — raggruppa per ADDETTO e ordina per valore decrescente.
// ===========================================================================
test('aggregateReport: per addetto, ordinato per valore decrescente', () => {
  const rows = [
    row({ journeyId: 'j1', addetto: 'Anna', valore: 5 }),
    row({ journeyId: 'j2', addetto: 'Bruno', valore: 50 }),
    row({ journeyId: 'j3', addetto: 'Carla', valore: 30 }),
  ];
  const g = aggregateReport(rows, byAddetto);
  assert.deepEqual(g.map((x) => x.label), ['Bruno', 'Carla', 'Anna']);
  assert.deepEqual(g.map((x) => x.valore), [50, 30, 5]);
});

// ===========================================================================
// aggregateReport — tie-break: a parità di valore ordina per contratti↓,
// poi per label (it).
// ===========================================================================
test('aggregateReport: tie-break su contratti poi label', () => {
  const rows = [
    // Beta: valore 10, 1 contratto
    row({ journeyId: 'b1', addetto: 'Beta', valore: 10 }),
    // Alfa: valore 10, 2 contratti => prima di Beta (più contratti)
    row({ journeyId: 'a1', addetto: 'Alfa', valore: 5 }),
    row({ journeyId: 'a2', addetto: 'Alfa', valore: 5 }),
    // Gamma: valore 10, 1 contratto => dopo Beta? stesso valore+contratti => label
    row({ journeyId: 'g1', addetto: 'Gamma', valore: 10 }),
  ];
  const g = aggregateReport(rows, byAddetto);
  // tutti valore 10. Alfa ha 2 contratti => primo. Beta e Gamma 1 contratto,
  // ordinati per label: Beta < Gamma.
  assert.deepEqual(g.map((x) => x.label), ['Alfa', 'Beta', 'Gamma']);
});

// ===========================================================================
// aggregateReport — dimensione CLIENTE: usa journeyId come key, fallback label
// su customerKey quando cliente è vuoto. Input vuoto => array vuoto.
// ===========================================================================
test('aggregateReport: per cliente con fallback label e input vuoto', () => {
  assert.deepEqual(aggregateReport([], byCliente), []);
  const rows = [
    row({ journeyId: 'j1', cliente: '', customerKey: 'PIVA123' }),
    row({ journeyId: 'j1', cliente: '', customerKey: 'PIVA123' }),
  ];
  const g = aggregateReport(rows, byCliente);
  assert.equal(g.length, 1);
  assert.equal(g[0].key, 'j1');
  assert.equal(g[0].label, 'PIVA123', 'fallback su customerKey quando cliente vuoto');
  assert.equal(g[0].clienti, 1);
  assert.equal(g[0].contratti, 2);
});

// ===========================================================================
// cjSearchMatches — ricerca case-insensitive, vuota => sempre match.
// ===========================================================================
test('cjSearchMatches: case-insensitive, vuoto/whitespace = match', () => {
  assert.equal(cjSearchMatches('Mario Rossi', ''), true);
  assert.equal(cjSearchMatches('Mario Rossi', '   '), true);
  assert.equal(cjSearchMatches('Mario Rossi', 'mario'), true);
  assert.equal(cjSearchMatches('Mario Rossi', 'ROSSI'), true);
  assert.equal(cjSearchMatches('Mario Rossi', 'verdi'), false);
  assert.equal(cjSearchMatches('', 'mario'), false);
});

// ===========================================================================
// matchesCjFilters — "tutti" = nessun vincolo, tutto passa.
// ===========================================================================
test('matchesCjFilters: filtri "tutti" lasciano passare tutto', () => {
  const all = { typeFilter: 'tutti', pdvFilter: 'tutti', addettoFilter: 'tutti', stateFilter: 'tutti', search: '' };
  const v = { customerType: 'privato', pdvs: ['PDV Roma'], addetti: ['Anna'], states: ['attivato'], searchHay: 'Mario' };
  assert.equal(matchesCjFilters(v, all), true);
});

// ===========================================================================
// matchesCjFilters — ogni faccetta filtra in modo indipendente.
// ===========================================================================
test('matchesCjFilters: tipo / negozio / addetto / stato filtrano', () => {
  const base = { typeFilter: 'tutti', pdvFilter: 'tutti', addettoFilter: 'tutti', stateFilter: 'tutti', search: '' };
  const v = { customerType: 'privato', pdvs: ['PDV Roma'], addetti: ['Anna'], states: ['attivato'], searchHay: 'Mario' };

  assert.equal(matchesCjFilters(v, { ...base, typeFilter: 'azienda' }), false);
  assert.equal(matchesCjFilters(v, { ...base, typeFilter: 'privato' }), true);

  assert.equal(matchesCjFilters(v, { ...base, pdvFilter: 'PDV Milano' }), false);
  assert.equal(matchesCjFilters(v, { ...base, pdvFilter: 'PDV Roma' }), true);

  assert.equal(matchesCjFilters(v, { ...base, addettoFilter: 'Bruno' }), false);
  assert.equal(matchesCjFilters(v, { ...base, addettoFilter: 'Anna' }), true);

  assert.equal(matchesCjFilters(v, { ...base, stateFilter: 'ko' }), false);
  assert.equal(matchesCjFilters(v, { ...base, stateFilter: 'attivato' }), true);
});

// ===========================================================================
// matchesCjFilters — combinazione di più filtri (AND).
// ===========================================================================
test('matchesCjFilters: i filtri si combinano in AND', () => {
  const v = { customerType: 'azienda', pdvs: ['PDV Roma'], addetti: ['Anna'], states: ['pagato'], searchHay: 'Acme SRL' };
  const f = { typeFilter: 'azienda', pdvFilter: 'PDV Roma', addettoFilter: 'Anna', stateFilter: 'pagato', search: 'acme' };
  assert.equal(matchesCjFilters(v, f), true);
  // un solo mismatch (stato) => escluso
  assert.equal(matchesCjFilters(v, { ...f, stateFilter: 'attivato' }), false);
  // mismatch sulla ricerca => escluso
  assert.equal(matchesCjFilters(v, { ...f, search: 'altro' }), false);
});

// ===========================================================================
// matchesCjFilters — journey multi-facet: una journey con più PDV/addetti/stati
// matcha se uno qualunque dei suoi valori coincide (includes sull'array).
// ===========================================================================
test('matchesCjFilters: journey multi-facet matcha per includes', () => {
  const base = { typeFilter: 'tutti', pdvFilter: 'tutti', addettoFilter: 'tutti', stateFilter: 'tutti', search: '' };
  const j = {
    customerType: 'privato',
    pdvs: ['PDV Roma', 'PDV Milano'],
    addetti: ['Anna', 'Bruno'],
    states: ['attivato', 'ko'],
    searchHay: 'Mario Rossi',
  };
  assert.equal(matchesCjFilters(j, { ...base, pdvFilter: 'PDV Milano' }), true);
  assert.equal(matchesCjFilters(j, { ...base, addettoFilter: 'Bruno' }), true);
  assert.equal(matchesCjFilters(j, { ...base, stateFilter: 'ko' }), true);
  assert.equal(matchesCjFilters(j, { ...base, pdvFilter: 'PDV Napoli' }), false);
});

// ===========================================================================
// matchesCjFilters — facet vuoti (riga senza PDV/addetto/stato) NON matchano
// un filtro specifico, ma passano se il filtro è "tutti".
// ===========================================================================
test('matchesCjFilters: facet vuoti esclusi da filtro specifico', () => {
  const empty = { customerType: 'privato', pdvs: [], addetti: [], states: [], searchHay: '' };
  assert.equal(matchesCjFilters(empty, { typeFilter: 'tutti', pdvFilter: 'PDV Roma', addettoFilter: 'tutti', stateFilter: 'tutti', search: '' }), false);
  assert.equal(matchesCjFilters(empty, { typeFilter: 'tutti', pdvFilter: 'tutti', addettoFilter: 'tutti', stateFilter: 'tutti', search: '' }), true);
});

// ===========================================================================
// COERENZA SCHEDE vs REPORT — stesso filtro, stessa decisione.
// Una journey con 2 item (Roma+attivato, Milano+ko) e le sue 2 righe report.
// Filtrando per pdv=Milano: la journey passa (ha Milano fra i suoi PDV), ma a
// livello report solo la riga di Milano passa. È il comportamento atteso del
// filtraggio condiviso: stessa logica, granularità diversa.
// ===========================================================================
test('coerenza schede/report: stesso predicato, granularità journey vs item', () => {
  const filter = { typeFilter: 'tutti', pdvFilter: 'PDV Milano', addettoFilter: 'tutti', stateFilter: 'tutti', search: '' };

  // vista schede: la journey aggrega entrambi i PDV
  const journeyView = {
    customerType: 'privato',
    pdvs: ['PDV Roma', 'PDV Milano'],
    addetti: ['Anna'],
    states: ['attivato', 'ko'],
    searchHay: 'Mario Rossi',
  };
  assert.equal(matchesCjFilters(journeyView, filter), true, 'la scheda passa se uno dei suoi PDV combacia');

  // vista report: due righe item-level, una sola combacia
  const reportRows = [
    { customerType: 'privato', pdvs: ['PDV Roma'], addetti: ['Anna'], states: ['attivato'], searchHay: 'Mario Rossi' },
    { customerType: 'privato', pdvs: ['PDV Milano'], addetti: ['Anna'], states: ['ko'], searchHay: 'Mario Rossi' },
  ];
  const passed = reportRows.filter((r) => matchesCjFilters(r, filter));
  assert.equal(passed.length, 1, 'solo la riga del PDV filtrato passa');
  assert.deepEqual(passed[0].pdvs, ['PDV Milano']);
});

// ===========================================================================
// ANALISI GETTONI E FATTURATO CROSS-SELL (Task #192)
// Logica pura `shared/customerJourney.ts`: dal numero di piste NON-mobile
// attive in una journey ricava il gettone (tabella a scaglioni), aggrega per
// negozio/addetto e calcola il potenziale non espresso alla saturazione scelta.
// ===========================================================================

// --- gettoneForPiste: tabella a scaglioni + clamp/round ---
test('gettoneForPiste: tabella a scaglioni 0..5 con clamp e round', () => {
  assert.deepEqual(CJ_GETTONE_TABLE, [0, 20, 30, 40, 100, 120]);
  assert.equal(CJ_MAX_PISTE, 5);
  assert.equal(gettoneForPiste(0), 0);
  assert.equal(gettoneForPiste(1), 20);
  assert.equal(gettoneForPiste(2), 30);
  assert.equal(gettoneForPiste(3), 40);
  assert.equal(gettoneForPiste(4), 100);
  assert.equal(gettoneForPiste(5), 120);
  // clamp oltre il massimo e sotto zero
  assert.equal(gettoneForPiste(9), 120);
  assert.equal(gettoneForPiste(-3), 0);
  // round dei decimali
  assert.equal(gettoneForPiste(2.4), 30);
  assert.equal(gettoneForPiste(2.6), 40);
  // valore non finito => 0
  assert.equal(gettoneForPiste(NaN), 0);
});

// --- buildGettoneJourneys: piste = driver NON-mobile distinti attivi ---
test('buildGettoneJourneys: conta driver non-mobile distinti attivi', () => {
  const rows = [
    // journey con mobile (non conta) + fisso attivo + energia attivo => 2 piste
    row({ journeyId: 'j1', driver: 'mobile', state: 'attivato', pdv: 'Roma', addetto: 'Anna', openedAt: '2026-07-05T00:00:00.000Z' }),
    row({ journeyId: 'j1', driver: 'fisso', state: 'attivato', pdv: 'Roma', addetto: 'Anna', openedAt: '2026-07-05T00:00:00.000Z' }),
    row({ journeyId: 'j1', driver: 'energia', state: 'pagato', pdv: 'Roma', addetto: 'Anna', openedAt: '2026-07-05T00:00:00.000Z' }),
    // energia duplicata (gas+luce) => conta una sola volta
    row({ journeyId: 'j1', driver: 'energia', state: 'inserito', pdv: 'Roma', addetto: 'Anna', openedAt: '2026-07-05T00:00:00.000Z' }),
  ];
  const js = buildGettoneJourneys(rows);
  assert.equal(js.length, 1);
  assert.equal(js[0].pisteAttive, 2, 'fisso + energia (energia non duplica)');
  assert.equal(js[0].fatturato, 30, '2 piste => 30€');
  assert.equal(js[0].potenzialePieno, 90, '120 - 30');
  assert.equal(js[0].pdv, 'Roma');
  assert.equal(js[0].addetto, 'Anna');
  assert.equal(js[0].openedAt, '2026-07-05T00:00:00.000Z');
});

// --- buildGettoneJourneys: stati KO non contano come pista attiva ---
test('buildGettoneJourneys: piste in stato non-attivo non contano', () => {
  const rows = [
    row({ journeyId: 'j1', driver: 'mobile', state: 'attivato' }),
    row({ journeyId: 'j1', driver: 'fisso', state: 'ko' }),
    row({ journeyId: 'j1', driver: 'energia', state: 'annullato' }),
    row({ journeyId: 'j1', driver: 'telefono', state: 'stornato' }),
  ];
  const js = buildGettoneJourneys(rows);
  assert.equal(js[0].pisteAttive, 0, 'tutte le piste cross-sell sono KO/annullate/stornate');
  assert.equal(js[0].fatturato, 0);
  assert.equal(js[0].potenzialePieno, 120, 'journey solo-mobile: pieno potenziale residuo');
});

// --- buildGettoneJourneys: attribuzione pdv/addetto dalla SIM mobile ---
test('buildGettoneJourneys: pdv/addetto dalla mobile, fallback su qualunque item', () => {
  // mobile con pdv/addetto valorizzati: prevalgono
  const withMobile = buildGettoneJourneys([
    row({ journeyId: 'j1', driver: 'fisso', state: 'attivato', pdv: 'Milano', addetto: 'Bruno' }),
    row({ journeyId: 'j1', driver: 'mobile', state: 'attivato', pdv: 'Roma', addetto: 'Anna' }),
  ]);
  assert.equal(withMobile[0].pdv, 'Roma', 'pdv della mobile');
  assert.equal(withMobile[0].addetto, 'Anna', 'addetto della mobile');

  // mobile attiva senza pdv/addetto: fallback su qualunque item valorizzato
  const noMobilePdv = buildGettoneJourneys([
    row({ journeyId: 'j2', driver: 'mobile', state: 'attivato', pdv: '', addetto: '' }),
    row({ journeyId: 'j2', driver: 'fisso', state: 'attivato', pdv: 'Napoli', addetto: 'Carla' }),
  ]);
  assert.equal(noMobilePdv[0].pdv, 'Napoli');
  assert.equal(noMobilePdv[0].addetto, 'Carla');
});

// --- buildGettoneJourneys: attribuzione deterministica con più mobile ---
test('buildGettoneJourneys: pdv/addetto deterministici a prescindere dall ordine', () => {
  const a = row({ journeyId: 'j1', driver: 'mobile', state: 'attivato', pdv: 'Roma', addetto: 'Bob' });
  const b = row({ journeyId: 'j1', driver: 'mobile', state: 'attivato', pdv: 'Milano', addetto: 'Anna' });
  const r1 = buildGettoneJourneys([a, b])[0];
  const r2 = buildGettoneJourneys([b, a])[0];
  // minimo lessicografico, indipendente dall'ordine di input
  assert.equal(r1.pdv, 'Milano');
  assert.equal(r1.addetto, 'Anna');
  assert.deepEqual({ pdv: r1.pdv, addetto: r1.addetto }, { pdv: r2.pdv, addetto: r2.addetto });
});

// --- buildGettoneJourneys: finestra T0 — i contratti dei mesi precedenti
// all'attivazione della SIM (T0) NON contano per il gettone (Task #215). ---
test('buildGettoneJourneys: piste prima del mese di T0 non contano', () => {
  // SIM mobile (T0) a luglio 2026. Un fisso a GIUGNO (prima di T0) non deve
  // contare; energia a luglio e telefono ad agosto contano => 2 piste = 30€
  // (non 40€ come sarebbe contando anche il fisso pre-T0).
  const rows = [
    row({ journeyId: 'j1', driver: 'mobile', state: 'attivato', openedAt: '2026-07-05T00:00:00.000Z', eventDate: '2026-07-05T00:00:00.000Z' }),
    row({ journeyId: 'j1', driver: 'fisso', state: 'attivato', openedAt: '2026-07-05T00:00:00.000Z', eventDate: '2026-06-20T00:00:00.000Z' }),
    row({ journeyId: 'j1', driver: 'energia', state: 'attivato', openedAt: '2026-07-05T00:00:00.000Z', eventDate: '2026-07-10T00:00:00.000Z' }),
    row({ journeyId: 'j1', driver: 'telefono', state: 'attivato', openedAt: '2026-07-05T00:00:00.000Z', eventDate: '2026-08-01T00:00:00.000Z' }),
  ];
  const js = buildGettoneJourneys(rows);
  assert.equal(js.length, 1);
  assert.equal(js[0].pisteAttive, 2, 'fisso di giugno escluso, energia+telefono contano');
  assert.equal(js[0].fatturato, 30, '2 piste => 30€ (non 40)');
});

// --- buildGettoneJourneys: stesso mese di T0 conta (estremo incluso) ---
test('buildGettoneJourneys: contratto nello stesso mese di T0 conta', () => {
  const rows = [
    row({ journeyId: 'j1', driver: 'mobile', state: 'attivato', openedAt: '2026-07-20T00:00:00.000Z', eventDate: '2026-07-20T00:00:00.000Z' }),
    // fisso a inizio luglio, PRIMA della SIM ma stesso mese => conta (finestra
    // a granularità mese, estremo incluso).
    row({ journeyId: 'j1', driver: 'fisso', state: 'attivato', openedAt: '2026-07-20T00:00:00.000Z', eventDate: '2026-07-03T00:00:00.000Z' }),
  ];
  const js = buildGettoneJourneys(rows);
  assert.equal(js[0].pisteAttive, 1, 'fisso stesso mese di T0 conta');
});

// --- buildGettoneJourneys: T0 da min(mobile) se openedAt assente ---
test('buildGettoneJourneys: senza openedAt, T0 = mese della prima mobile', () => {
  const rows = [
    row({ journeyId: 'j1', driver: 'mobile', state: 'attivato', openedAt: null, eventDate: '2026-07-15T00:00:00.000Z' }),
    row({ journeyId: 'j1', driver: 'fisso', state: 'attivato', openedAt: null, eventDate: '2026-06-01T00:00:00.000Z' }),
    row({ journeyId: 'j1', driver: 'energia', state: 'attivato', openedAt: null, eventDate: '2026-08-01T00:00:00.000Z' }),
  ];
  const js = buildGettoneJourneys(rows);
  assert.equal(js[0].pisteAttive, 1, 'fisso pre-luglio escluso, solo energia conta');
});

// --- buildGettoneJourneys: eventDate assente => nessuna penalità (conta) ---
test('buildGettoneJourneys: eventDate nullo non penalizza la pista', () => {
  const rows = [
    row({ journeyId: 'j1', driver: 'mobile', state: 'attivato', openedAt: '2026-07-05T00:00:00.000Z', eventDate: '2026-07-05T00:00:00.000Z' }),
    row({ journeyId: 'j1', driver: 'fisso', state: 'attivato', openedAt: '2026-07-05T00:00:00.000Z', eventDate: null }),
  ];
  const js = buildGettoneJourneys(rows);
  assert.equal(js[0].pisteAttive, 1, 'pista senza data conta comunque');
});

// --- filterGettoneByDate: bordi vicino alla mezzanotte (UTC) ---
test('filterGettoneByDate: confronto per data UTC sui bordi mezzanotte', () => {
  const js = buildGettoneJourneys([
    // 22:00 UTC del 31/07 (in Europe/Rome è già 01/08): la data UTC resta 31/07
    row({ journeyId: 'a', driver: 'mobile', state: 'attivato', openedAt: '2026-07-31T22:00:00.000Z' }),
    // mezzanotte UTC del 01/08: fuori dal range luglio
    row({ journeyId: 'b', driver: 'mobile', state: 'attivato', openedAt: '2026-08-01T00:00:00.000Z' }),
  ]);
  const lug = filterGettoneByDate(js, '2026-07-01', '2026-07-31');
  assert.deepEqual(lug.map((j) => j.journeyId), ['a'], 'solo la a (data UTC 2026-07-31) rientra in luglio');
});

// --- filterGettoneByDate: estremi inclusi, senza range passano tutte ---
test('filterGettoneByDate: filtra per coorte data attivazione (estremi inclusi)', () => {
  const js = buildGettoneJourneys([
    row({ journeyId: 'a', driver: 'mobile', state: 'attivato', openedAt: '2026-07-01T08:00:00.000Z' }),
    row({ journeyId: 'b', driver: 'mobile', state: 'attivato', openedAt: '2026-07-15T23:30:00.000Z' }),
    row({ journeyId: 'c', driver: 'mobile', state: 'attivato', openedAt: '2026-08-02T00:00:00.000Z' }),
  ]);
  // range luglio
  const lug = filterGettoneByDate(js, '2026-07-01', '2026-07-31');
  assert.deepEqual(lug.map((j) => j.journeyId).sort(), ['a', 'b']);
  // solo "from"
  const dal15 = filterGettoneByDate(js, '2026-07-15', null);
  assert.deepEqual(dal15.map((j) => j.journeyId).sort(), ['b', 'c']);
  // solo "to"
  const fino1 = filterGettoneByDate(js, null, '2026-07-01');
  assert.deepEqual(fino1.map((j) => j.journeyId), ['a']);
  // nessun range => tutte
  assert.equal(filterGettoneByDate(js, '', '').length, 3);
});

// --- filterGettoneByDate: journey senza openedAt solo senza range ---
test('filterGettoneByDate: journey senza openedAt passa solo senza limiti', () => {
  const js = buildGettoneJourneys([
    row({ journeyId: 'x', driver: 'mobile', state: 'attivato', openedAt: null }),
  ]);
  assert.equal(filterGettoneByDate(js, null, null).length, 1, 'senza range: passa');
  assert.equal(filterGettoneByDate(js, '2026-07-01', null).length, 0, 'con range: esclusa');
});

// --- aggregateGettone: somma fatturato + potenziale alla saturazione ---
test('aggregateGettone: per negozio, fatturato e potenziale a saturazione', () => {
  const js = buildGettoneJourneys([
    // Roma: journey con 1 pista attiva => 20€, potenziale pieno 100
    row({ journeyId: 'j1', driver: 'mobile', state: 'attivato', pdv: 'Roma' }),
    row({ journeyId: 'j1', driver: 'fisso', state: 'attivato', pdv: 'Roma' }),
    // Roma: journey solo-mobile => 0€, potenziale pieno 120
    row({ journeyId: 'j2', driver: 'mobile', state: 'attivato', pdv: 'Roma' }),
    // Milano: journey con 3 piste => 40€, potenziale pieno 80
    row({ journeyId: 'j3', driver: 'mobile', state: 'attivato', pdv: 'Milano' }),
    row({ journeyId: 'j3', driver: 'fisso', state: 'attivato', pdv: 'Milano' }),
    row({ journeyId: 'j3', driver: 'energia', state: 'attivato', pdv: 'Milano' }),
    row({ journeyId: 'j3', driver: 'telefono', state: 'attivato', pdv: 'Milano' }),
  ]);
  const byPdvG = (j) => ({ key: j.pdv || '—', label: j.pdv || 'Senza negozio' });
  const g = aggregateGettone(js, byPdvG, 100);
  // ordinato per fatturato↓: Milano (40) prima di Roma (20)
  assert.deepEqual(g.map((x) => x.label), ['Milano', 'Roma']);
  const milano = g.find((x) => x.label === 'Milano');
  assert.equal(milano.clienti, 1);
  assert.equal(milano.simAttivate, 1);
  assert.equal(milano.conProdotti, 1);
  assert.equal(milano.fatturato, 40);
  assert.equal(milano.potenziale, 80, 'saturazione 100% => pieno residuo');
  const roma = g.find((x) => x.label === 'Roma');
  assert.equal(roma.clienti, 2, 'due journey nello stesso PDV');
  assert.equal(roma.simAttivate, 2, 'due SIM attive nello stesso PDV');
  assert.equal(roma.conProdotti, 1, 'solo una journey ha piste cross-sell');
  assert.equal(roma.fatturato, 20);
  assert.equal(roma.potenziale, 220, '(100 + 120) * 100%');
});

// --- aggregateGettone: la saturazione scala solo il potenziale ---
test('aggregateGettone: saturazione scala il potenziale, non il fatturato', () => {
  const js = buildGettoneJourneys([
    row({ journeyId: 'j1', driver: 'mobile', state: 'attivato', addetto: 'Anna' }),
    row({ journeyId: 'j1', driver: 'fisso', state: 'attivato', addetto: 'Anna' }),
  ]);
  const byAddettoG = (j) => ({ key: j.addetto || '—', label: j.addetto || 'Senza addetto' });
  const g50 = aggregateGettone(js, byAddettoG, 50);
  assert.equal(g50[0].fatturato, 20, 'fatturato invariato dalla saturazione');
  assert.equal(g50[0].potenziale, 50, '100 * 50%');
  // clamp della saturazione fuori range
  const gOver = aggregateGettone(js, byAddettoG, 999);
  assert.equal(gOver[0].potenziale, 100, 'saturazione clampata a 100%');
});

// ===========================================================================
// SIMULATORE SCENARI GETTONE (Task #229)
// `gettoneIncremento` + il parametro `addProducts` di aggregateGettone /
// gettoneTotals: simulano "il X% dei clienti attiva +N prodotti". Il default
// `addProducts = CJ_MAX_PISTE` deve riprodurre il comportamento storico
// (potenziale pieno residuo fino alla saturazione completa).
// ===========================================================================

// --- gettoneIncremento: incremento di gettone per +N piste con cap/clamp ---
test('gettoneIncremento: +N piste con cap a CJ_MAX_PISTE e mai negativo', () => {
  // 1 pista attiva (20€). +1 => 2 piste = 30€ => incremento 10.
  assert.equal(gettoneIncremento(1, 20, 1), 10);
  // 1 pista, +2 => 3 piste = 40€ => incremento 20.
  assert.equal(gettoneIncremento(1, 20, 2), 20);
  // 1 pista, +5 (cap a 5) => 5 piste = 120€ => incremento 100 (= potenziale pieno).
  assert.equal(gettoneIncremento(1, 20, 5), 100);
  // 3 piste (40€), +5 cap a 5 => 120€ => incremento 80.
  assert.equal(gettoneIncremento(3, 40, 5), 80);
  // journey già a saturazione: nessun incremento possibile.
  assert.equal(gettoneIncremento(5, 120, 3), 0);
  // addProducts 0 => nessun incremento.
  assert.equal(gettoneIncremento(2, 30, 0), 0);
  // addProducts non finito => default CJ_MAX_PISTE (saturazione completa).
  assert.equal(gettoneIncremento(1, 20, NaN), 100);
  // addProducts oltre il massimo => clamp a CJ_MAX_PISTE.
  assert.equal(gettoneIncremento(0, 0, 99), 120);
});

// --- aggregateGettone: scenario "+N prodotti" scala il potenziale ---
test('aggregateGettone: scenario +N prodotti per il X% dei clienti', () => {
  const js = buildGettoneJourneys([
    // Anna: 1 pista attiva => 20€ maturato.
    row({ journeyId: 'j1', driver: 'mobile', state: 'attivato', addetto: 'Anna' }),
    row({ journeyId: 'j1', driver: 'fisso', state: 'attivato', addetto: 'Anna' }),
  ]);
  const byAddettoG = (j) => ({ key: j.addetto || '—', label: j.addetto || 'Senza addetto' });
  // 100% dei clienti con +1: incremento pieno = 10 (1->2 piste).
  assert.equal(aggregateGettone(js, byAddettoG, 100, 1)[0].potenziale, 10);
  // 50% dei clienti con +1 => 10 * 50% = 5.
  assert.equal(aggregateGettone(js, byAddettoG, 50, 1)[0].potenziale, 5);
  // 100% con +5 => potenziale pieno residuo (100), come lo storico default.
  assert.equal(aggregateGettone(js, byAddettoG, 100, 5)[0].potenziale, 100);
  // default (addProducts omesso) == +5: backward-compat.
  assert.equal(
    aggregateGettone(js, byAddettoG, 100)[0].potenziale,
    aggregateGettone(js, byAddettoG, 100, 5)[0].potenziale,
    'default addProducts = saturazione completa',
  );
  // 0% dei clienti => nessun potenziale anche con +5.
  assert.equal(aggregateGettone(js, byAddettoG, 0, 5)[0].potenziale, 0);
});

// --- aggregateGettone: +N clampa a saturazione per chi è già avanti ---
test('aggregateGettone: +N somma per gruppo con cap a saturazione per cliente', () => {
  const js = buildGettoneJourneys([
    // Roma j1: 1 pista (20€). +2 => 3 piste = 40€ => +20.
    row({ journeyId: 'j1', driver: 'mobile', state: 'attivato', pdv: 'Roma' }),
    row({ journeyId: 'j1', driver: 'fisso', state: 'attivato', pdv: 'Roma' }),
    // Roma j2: 4 piste (100€). +2 cap a 5 => 120€ => +20.
    row({ journeyId: 'j2', driver: 'mobile', state: 'attivato', pdv: 'Roma' }),
    row({ journeyId: 'j2', driver: 'fisso', state: 'attivato', pdv: 'Roma' }),
    row({ journeyId: 'j2', driver: 'energia', state: 'attivato', pdv: 'Roma' }),
    row({ journeyId: 'j2', driver: 'telefono', state: 'attivato', pdv: 'Roma' }),
    row({ journeyId: 'j2', driver: 'assicurazione', state: 'attivato', pdv: 'Roma' }),
  ]);
  const byPdvG = (j) => ({ key: j.pdv || '—', label: j.pdv || 'Senza negozio' });
  // incremento totale Roma con +2 al 100% = 20 (j1) + 20 (j2 cap) = 40.
  assert.equal(aggregateGettone(js, byPdvG, 100, 2)[0].potenziale, 40);
  // fatturato maturato invariato dallo scenario.
  assert.equal(aggregateGettone(js, byPdvG, 100, 2)[0].fatturato, 120, '20 (j1) + 100 (j2)');
});

// --- gettoneTotals: scenario +N + cohort vuota ---
test('gettoneTotals: scenario +N prodotti e input vuoto', () => {
  const js = buildGettoneJourneys([
    row({ journeyId: 'j1', driver: 'mobile', state: 'attivato' }),
    row({ journeyId: 'j1', driver: 'fisso', state: 'attivato' }),
    row({ journeyId: 'j2', driver: 'mobile', state: 'attivato' }),
  ]);
  // j1: 1 pista (20€) +1 => +10. j2: 0 piste (0€) +1 => 20€ => +20. Tot 30.
  assert.equal(gettoneTotals(js, 100, 1).potenziale, 30);
  // 50% => 15.
  assert.equal(gettoneTotals(js, 50, 1).potenziale, 15);
  // default == +5: backward-compat (220 come i test storici).
  assert.equal(gettoneTotals(js, 100).potenziale, 220);
  assert.equal(gettoneTotals(js, 100, 5).potenziale, 220);
  // cohort vuota => potenziale 0 a prescindere dallo scenario.
  assert.equal(gettoneTotals([], 100, 3).potenziale, 0);
});

// --- gettoneTotals: totali con saturazione ---
test('gettoneTotals: totali sim/clienti/conProdotti/fatturato/potenziale', () => {
  const js = buildGettoneJourneys([
    row({ journeyId: 'j1', driver: 'mobile', state: 'attivato' }),
    row({ journeyId: 'j1', driver: 'fisso', state: 'attivato' }),
    row({ journeyId: 'j2', driver: 'mobile', state: 'attivato' }),
  ]);
  const t = gettoneTotals(js, 100);
  assert.equal(t.clienti, 2);
  assert.equal(t.simAttivate, 2);
  assert.equal(t.conProdotti, 1);
  assert.equal(t.fatturato, 20, 'j1=20 + j2=0');
  assert.equal(t.pisteAttive, 1);
  assert.equal(t.potenziale, 220, '(100 + 120) * 100%');
  // saturazione 25%
  const t25 = gettoneTotals(js, 25);
  assert.equal(t25.potenziale, 55, '220 * 25%');
});

// --- cohort: solo clienti con SIM mobile attiva ---
test('buildGettoneJourneys: cohort esclude mobile non attivo o assente', () => {
  const js = buildGettoneJourneys([
    // a: mobile attivo => IN cohort
    row({ journeyId: 'a', driver: 'mobile', state: 'attivato' }),
    // b: mobile KO + fisso attivo => mobile non attivo => FUORI cohort
    row({ journeyId: 'b', driver: 'mobile', state: 'ko' }),
    row({ journeyId: 'b', driver: 'fisso', state: 'attivato' }),
    // c: solo fisso, nessun mobile => FUORI cohort
    row({ journeyId: 'c', driver: 'fisso', state: 'attivato' }),
  ]);
  assert.deepEqual(js.map((j) => j.journeyId), ['a'], 'solo la journey con SIM mobile attiva');
});

// --- SIM volume vs clienti distinti ---
test('buildGettoneJourneys/totals: SIM attive (volume) vs clienti distinti', () => {
  const js = buildGettoneJourneys([
    // un cliente con 2 SIM mobile attive + 1 mobile KO (non conta) + 1 pista
    row({ journeyId: 'j1', driver: 'mobile', state: 'attivato' }),
    row({ journeyId: 'j1', driver: 'mobile', state: 'pagato' }),
    row({ journeyId: 'j1', driver: 'mobile', state: 'ko' }),
    row({ journeyId: 'j1', driver: 'fisso', state: 'attivato' }),
  ]);
  assert.equal(js.length, 1, 'un solo cliente');
  assert.equal(js[0].simAttive, 2, 'due SIM mobile attive (la KO non conta)');
  const t = gettoneTotals(js, 100);
  assert.equal(t.clienti, 1, 'un cliente distinto');
  assert.equal(t.simAttivate, 2, 'due SIM attivate (volume)');
  assert.equal(t.conProdotti, 1);
});

// --- crossSellPercentuali: math + edge case cohort vuota ---
test('crossSellPercentuali: percentuali con/senza prodotti e cohort vuota', () => {
  assert.deepEqual(crossSellPercentuali(0, 0), { conPct: 0, senzaPct: 0 }, 'cohort vuota => 0/0');
  assert.deepEqual(crossSellPercentuali(4, 1), { conPct: 25, senzaPct: 75 });
  const full = crossSellPercentuali(4, 4);
  assert.equal(full.conPct, 100);
  assert.equal(full.senzaPct, 0);
  // le due percentuali sommano sempre a 100 con cohort non vuota
  const p = crossSellPercentuali(3, 2);
  assert.ok(Math.abs(p.conPct + p.senzaPct - 100) < 1e-9, 'con + senza = 100');
  // clamp se conProdotti > clienti (input incoerente)
  assert.deepEqual(crossSellPercentuali(2, 5), { conPct: 100, senzaPct: 0 });
});

// --- aggregateGettone / gettoneTotals: input vuoto ---
test('analisi gettoni: input vuoto => zero', () => {
  assert.deepEqual(aggregateGettone([], (j) => ({ key: j.pdv, label: j.pdv }), 100), []);
  const t = gettoneTotals([], 100);
  assert.deepEqual(t, { simAttivate: 0, clienti: 0, conProdotti: 0, fatturato: 0, potenziale: 0, pisteAttive: 0 });
});

// --- simSaturationPct: percentuale di saturazione cross-sell per SIM ---
test('simSaturationPct: piste/CJ_MAX_PISTE con clamp', () => {
  assert.equal(simSaturationPct(0), 0, 'nessuna pista => 0%');
  assert.equal(simSaturationPct(CJ_MAX_PISTE), 100, 'tutte le piste => 100%');
  assert.equal(simSaturationPct(CJ_MAX_PISTE / 2), 50, 'metà piste => 50%');
  assert.equal(simSaturationPct(-3), 0, 'clamp negativo => 0%');
  assert.equal(simSaturationPct(999), 100, 'clamp oltre il massimo => 100%');
});

// --- gettoneDetailByKey: dettaglio clienti/SIM per gruppo (click sul PDV) ---
test('gettoneDetailByKey: raggruppa per PDV con saturazione per cliente, ordinata', () => {
  const js = buildGettoneJourneys([
    // Roma j1: 1 pista attiva => 20% saturazione (1/5)
    row({ journeyId: 'j1', cliente: 'Anna', driver: 'mobile', state: 'attivato', pdv: 'Roma' }),
    row({ journeyId: 'j1', cliente: 'Anna', driver: 'fisso', state: 'attivato', pdv: 'Roma' }),
    // Roma j2: 0 piste => 0% saturazione, ma 2 SIM attive
    row({ journeyId: 'j2', cliente: 'Bea', driver: 'mobile', state: 'attivato', pdv: 'Roma' }),
    row({ journeyId: 'j2', cliente: 'Bea', driver: 'mobile', state: 'pagato', pdv: 'Roma' }),
    // Milano j3: 3 piste => 60%
    row({ journeyId: 'j3', cliente: 'Carlo', driver: 'mobile', state: 'attivato', pdv: 'Milano' }),
    row({ journeyId: 'j3', cliente: 'Carlo', driver: 'fisso', state: 'attivato', pdv: 'Milano' }),
    row({ journeyId: 'j3', cliente: 'Carlo', driver: 'energia', state: 'attivato', pdv: 'Milano' }),
    row({ journeyId: 'j3', cliente: 'Carlo', driver: 'telefono', state: 'attivato', pdv: 'Milano' }),
  ]);
  const byPdv = (j) => j.pdv || '—';
  const detail = gettoneDetailByKey(js, byPdv);
  // Roma: due clienti, ordinati per saturazione↓ (Anna 20% prima di Bea 0%)
  const roma = detail.get('Roma');
  assert.equal(roma.length, 2, 'due clienti su Roma');
  assert.deepEqual(roma.map((r) => r.cliente), ['Anna', 'Bea'], 'ordine per saturazione↓');
  assert.equal(roma[0].saturazionePct, 20, 'Anna 1/5 => 20%');
  assert.equal(roma[0].pisteAttive, 1);
  assert.equal(roma[0].fatturato, 20);
  assert.equal(roma[1].saturazionePct, 0, 'Bea senza piste => 0%');
  assert.equal(roma[1].simAttive, 2, 'Bea ha 2 SIM attive');
  // Milano: un cliente con 3 piste => 60%
  const milano = detail.get('Milano');
  assert.equal(milano.length, 1);
  assert.equal(milano[0].saturazionePct, 60, 'Carlo 3/5 => 60%');
  // input vuoto => mappa vuota
  assert.equal(gettoneDetailByKey([], byPdv).size, 0);
});
