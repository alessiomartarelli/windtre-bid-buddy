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
