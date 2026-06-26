import { test } from 'node:test';
import assert from 'node:assert/strict';

// Test di PARITÀ Customer Journey — badge "Conta/Non conta" della scheda vs
// conteggio piste del gettone (Task #216).
//
// La scheda cliente mostra, per ogni contratto, un badge di validità calcolato
// da `computeItemValidity` (client/src/lib/customerJourneyTimeline.ts). Lo
// stesso numero di piste deve coincidere con `pisteAttive` del gettone calcolato
// da `buildGettoneJourneys` (shared/customerJourney.ts). Le due logiche oggi
// condividono gli helper (mesi UTC, regola T0, finestra), ma restano funzioni
// SEPARATE che partono da shape di dati diverse: la scheda da `CustomerJourneyItem`,
// il gettone da `CjReportRow`. Questo test incrociato impedisce che divergano in
// silenzio (di nuovo numeri sbagliati come il caso storico "30€ vs 40€").
//
// È logica PURA: nessun server, nessun DB. I moduli TS sono caricati via loader
// `tsx`. Per ogni scenario costruiamo UN dataset sintetico di contratti e da
// quell'unica sorgente deriviamo entrambe le shape, così la parità è un
// confronto onesto sugli stessi identici dati.

const { computeTimeline, computeItemValidity } = await import(
  '../client/src/lib/customerJourneyTimeline.ts'
);
const { buildGettoneJourneys } = await import('../shared/customerJourney.ts');

let nextId = 1;

// Un contratto sintetico: i campi minimi che entrambe le logiche leggono.
// `eventDate` è un ISO a mezzanotte UTC (come in produzione `openedAt` deriva
// dalla data vendita a mezzanotte UTC) per evitare ambiguità di fuso orario sui
// bordi di mese.
function contract({ driver, state, eventDate, bisuiteSaleId = null, bisuiteId = null }) {
  return { id: `c_${nextId++}`, driver, state, eventDate, bisuiteSaleId, bisuiteId };
}

// Da un singolo elenco di contratti deriva le due shape e lancia entrambe le
// logiche. `journeyOpts` configura la journey condivisa (openedAt/trigger).
function derive(contracts, journeyOpts = {}) {
  const journey = {
    openedAt: journeyOpts.openedAt ?? null,
    triggerSaleId: journeyOpts.triggerSaleId ?? null,
    triggerBisuiteId: journeyOpts.triggerBisuiteId ?? null,
  };

  // Shape scheda: CustomerJourneyItem[] -> timeline -> validità.
  const items = contracts.map((c) => ({
    id: c.id,
    driver: c.driver,
    state: c.state,
    dataAttivazione: c.eventDate,
    dataInserimento: null,
    pdvDestinazione: 'PDV',
    pdvOrigine: null,
    bisuiteSaleId: c.bisuiteSaleId,
    bisuiteId: c.bisuiteId,
  }));
  const model = computeTimeline(journey, items);
  const validity = computeItemValidity(model, journey);
  const validCount = [...validity.values()].filter((v) => v.counts).length;

  // Shape gettone: CjReportRow[] (un'unica journey "J1").
  const rows = contracts.map((c) => ({
    journeyId: 'J1',
    customerKey: 'K1',
    customerType: 'privato',
    cliente: 'Cliente Test',
    pdv: 'PDV',
    addetto: 'ADD',
    state: c.state,
    driver: c.driver,
    valore: 0,
    openedAt: journey.openedAt,
    eventDate: c.eventDate,
  }));
  const gettone = buildGettoneJourneys(rows);

  return { validity, validCount, gettone, model };
}

// Asserisce la parità per una journey IN COHORT (almeno una SIM mobile attiva):
// il gettone deve esistere e `pisteAttive` deve eguagliare il numero di badge
// "Conta" della scheda.
function assertParity(contracts, journeyOpts, msg) {
  const { validCount, gettone } = derive(contracts, journeyOpts);
  assert.equal(gettone.length, 1, `${msg}: journey in cohort presente nel gettone`);
  assert.equal(
    validCount,
    gettone[0].pisteAttive,
    `${msg}: badge "Conta" (${validCount}) == pisteAttive gettone (${gettone[0].pisteAttive})`,
  );
  return { validCount, piste: gettone[0].pisteAttive };
}

// ===========================================================================
// SCENARIO 1: caso base — mobile attivante + una pista cross-sell valida.
// ===========================================================================
test('parità: mobile + 1 pista => 1 badge Conta == 1 pista gettone', () => {
  const contracts = [
    contract({ driver: 'mobile', state: 'attivato', eventDate: '2026-07-05T00:00:00.000Z', bisuiteSaleId: 'S1' }),
    contract({ driver: 'energia', state: 'attivato', eventDate: '2026-07-10T00:00:00.000Z' }),
  ];
  const r = assertParity(contracts, { openedAt: '2026-07-05T00:00:00.000Z', triggerSaleId: 'S1' }, 'base');
  assert.equal(r.piste, 1);
});

// ===========================================================================
// SCENARIO 2: contratto del mese PRIMA di T0 => fuori finestra in entrambe.
// ===========================================================================
test('parità: pista del mese prima di T0 NON conta in nessuna delle due', () => {
  const contracts = [
    contract({ driver: 'mobile', state: 'attivato', eventDate: '2026-07-05T00:00:00.000Z', bisuiteSaleId: 'S1' }),
    contract({ driver: 'fisso', state: 'attivato', eventDate: '2026-06-20T00:00:00.000Z' }), // pre-T0
    contract({ driver: 'energia', state: 'attivato', eventDate: '2026-07-10T00:00:00.000Z' }),
  ];
  const r = assertParity(contracts, { openedAt: '2026-07-05T00:00:00.000Z', triggerSaleId: 'S1' }, 'pre-T0');
  // solo energia conta; il fisso di giugno è fuori periodo.
  assert.equal(r.piste, 1);
});

// ===========================================================================
// SCENARIO 3: driver duplicato (energia gas + luce) => una sola pista.
// ===========================================================================
test('parità: driver duplicato (gas+luce) conta come una pista in entrambe', () => {
  const contracts = [
    contract({ driver: 'mobile', state: 'attivato', eventDate: '2026-07-01T00:00:00.000Z', bisuiteSaleId: 'S1' }),
    contract({ driver: 'energia', state: 'attivato', eventDate: '2026-07-05T00:00:00.000Z' }), // gas
    contract({ driver: 'energia', state: 'attivato', eventDate: '2026-07-08T00:00:00.000Z' }), // luce
  ];
  const r = assertParity(contracts, { openedAt: '2026-07-01T00:00:00.000Z', triggerSaleId: 'S1' }, 'dup-driver');
  assert.equal(r.piste, 1, 'energia (gas+luce) = una sola pista');
});

// ===========================================================================
// SCENARIO 4: stati ko/annullato/stornato => esclusi in entrambe.
// ===========================================================================
test('parità: piste ko/annullato/stornato escluse in entrambe', () => {
  const contracts = [
    contract({ driver: 'mobile', state: 'attivato', eventDate: '2026-07-01T00:00:00.000Z', bisuiteSaleId: 'S1' }),
    contract({ driver: 'fisso', state: 'ko', eventDate: '2026-07-05T00:00:00.000Z' }),
    contract({ driver: 'assicurazioni', state: 'annullato', eventDate: '2026-07-06T00:00:00.000Z' }),
    contract({ driver: 'protetti', state: 'stornato', eventDate: '2026-07-07T00:00:00.000Z' }),
    contract({ driver: 'telefono', state: 'attivato', eventDate: '2026-07-09T00:00:00.000Z' }),
  ];
  const r = assertParity(contracts, { openedAt: '2026-07-01T00:00:00.000Z', triggerSaleId: 'S1' }, 'stati-ko');
  assert.equal(r.piste, 1, 'solo telefono conta; ko/annullato/stornato esclusi');
});

// ===========================================================================
// SCENARIO 5: T0 (trigger) su un contratto NON-mobile => quel contratto NON è
// "attivante" ma conta come pista, esattamente come nel gettone (che esclude
// solo i driver mobile). È il caso che storicamente faceva divergere i numeri.
// ===========================================================================
test('parità: trigger su contratto non-mobile resta pista in entrambe', () => {
  const contracts = [
    // Il trigger BiSuite punta al FISSO: la timeline marca il fisso come T0Item,
    // ma essendo non-mobile NON va escluso come "attivante".
    contract({ driver: 'fisso', state: 'attivato', eventDate: '2026-07-02T00:00:00.000Z', bisuiteSaleId: 'TRIG' }),
    contract({ driver: 'mobile', state: 'attivato', eventDate: '2026-07-04T00:00:00.000Z' }),
    contract({ driver: 'energia', state: 'attivato', eventDate: '2026-07-10T00:00:00.000Z' }),
  ];
  const { model, validity, validCount, gettone } = derive(contracts, {
    openedAt: '2026-07-02T00:00:00.000Z',
    triggerSaleId: 'TRIG',
  });
  // Il T0 della timeline è davvero il fisso (via trigger), ma conta come pista.
  const fissoId = [...validity.entries()].find(([, v]) => v.kind === 'valida' || v.kind === 'attivante');
  assert.ok(fissoId, 'il fisso è classificato');
  assert.equal(gettone.length, 1, 'journey in cohort');
  assert.equal(validCount, gettone[0].pisteAttive, 'parità con trigger non-mobile');
  assert.equal(gettone[0].pisteAttive, 2, 'fisso + energia = 2 piste');
  // verifica esplicita che il fisso-trigger NON sia stato escluso come attivante.
  const fissoValidity = [...validity.entries()].find(
    ([id]) => id === model.t0ItemId,
  )[1];
  assert.equal(fissoValidity.counts, true, 'il fisso-T0 non-mobile conta come pista');
});

// ===========================================================================
// SCENARIO 6: caso ricco che combina TUTTI i rami limite in un'unica journey.
// La parità deve reggere anche quando i rami si mescolano.
// ===========================================================================
test('parità: dataset combinato (tutti i rami limite insieme)', () => {
  const contracts = [
    contract({ driver: 'mobile', state: 'attivato', eventDate: '2026-07-03T00:00:00.000Z', bisuiteSaleId: 'S1' }), // trigger
    contract({ driver: 'mobile', state: 'attivato', eventDate: '2026-08-01T00:00:00.000Z' }), // SIM extra (non pista)
    contract({ driver: 'fisso', state: 'attivato', eventDate: '2026-06-15T00:00:00.000Z' }), // pre-T0 => fuori
    contract({ driver: 'energia', state: 'attivato', eventDate: '2026-07-20T00:00:00.000Z' }), // valida
    contract({ driver: 'energia', state: 'attivato', eventDate: '2026-07-25T00:00:00.000Z' }), // duplicato
    contract({ driver: 'assicurazioni', state: 'ko', eventDate: '2026-07-22T00:00:00.000Z' }), // ko => fuori
    contract({ driver: 'telefono', state: 'attivato', eventDate: '2026-09-01T00:00:00.000Z' }), // valida (oltre T6 ok)
    contract({ driver: 'protetti', state: 'attivato', eventDate: '2026-08-10T00:00:00.000Z' }), // valida
  ];
  const r = assertParity(contracts, { openedAt: '2026-07-03T00:00:00.000Z', triggerSaleId: 'S1' }, 'combinato');
  // piste valide: energia + telefono + protetti = 3 (fisso fuori periodo,
  // assicurazioni ko, energia 2° duplicato, mobile non piste).
  assert.equal(r.piste, 3);
});

// ===========================================================================
// SCENARIO 7: confine della COHORT. Senza alcuna SIM mobile attiva il gettone
// esclude del tutto la journey (cohort = solo clienti con SIM mobile attiva).
// Questo NON è una divergenza silenziosa ma una regola voluta: lo documentiamo
// così è chiaro perché la parità si asserisce solo dentro la cohort.
// ===========================================================================
test('confine cohort: journey senza mobile attiva => esclusa dal gettone', () => {
  const contracts = [
    contract({ driver: 'mobile', state: 'ko', eventDate: '2026-07-01T00:00:00.000Z' }), // mobile NON attiva
    contract({ driver: 'energia', state: 'attivato', eventDate: '2026-07-10T00:00:00.000Z' }),
  ];
  const { gettone } = derive(contracts, { openedAt: '2026-07-01T00:00:00.000Z' });
  assert.equal(gettone.length, 0, 'nessuna SIM mobile attiva => fuori cohort gettone');
});

// ===========================================================================
// SCENARIO 8: stesso dataset, ORDINE delle righe diverso => stessa parità.
// Protegge dalla dipendenza dall'ordine (la query report non lo garantisce).
// ===========================================================================
test('parità: indipendente dall\'ordine dei contratti', () => {
  const base = [
    contract({ driver: 'mobile', state: 'attivato', eventDate: '2026-07-01T00:00:00.000Z', bisuiteSaleId: 'S1' }),
    contract({ driver: 'fisso', state: 'attivato', eventDate: '2026-07-05T00:00:00.000Z' }),
    contract({ driver: 'energia', state: 'attivato', eventDate: '2026-07-08T00:00:00.000Z' }),
  ];
  const opts = { openedAt: '2026-07-01T00:00:00.000Z', triggerSaleId: 'S1' };
  const a = assertParity(base, opts, 'ordine-1');
  const b = assertParity([...base].reverse(), opts, 'ordine-2');
  assert.equal(a.piste, b.piste, 'la parità non dipende dall\'ordine');
  assert.equal(a.piste, 2);
});
