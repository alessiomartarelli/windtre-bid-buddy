import { test } from 'node:test';
import assert from 'node:assert/strict';

// Test suite Customer Journey — timeline temporale e dettaglio per PDV/ragione
// sociale della scheda cliente (Task #185, coperto da test in Task #186).
//
// È logica PURA: nessun server, nessun DB. Il modulo TS
// `client/src/lib/customerJourneyTimeline.ts` (estratto dal componente React
// CustomerJourney.tsx proprio per renderlo testabile) viene caricato via loader
// `tsx`. Copre i rami logici delicati della timeline:
//   - contratti senza alcuna data => stato vuoto della timeline;
//   - driver/stato sconosciuti => fallback colore grigio + nessun crash;
//   - rilevamento T0: trigger BiSuite, fallback primo mobile, fallback primo
//     evento in assoluto;
//   - stati ko/stornato/annullato attenuati;
//   - asse mesi esteso quando un evento cade fuori dalla finestra T0–T6;
//   - raggruppamento per PDV (destinazione => origine => N/D).

const {
  computeTimeline,
  groupByNegozio,
  cjDriverColor,
  isFadedState,
  itemEventDate,
  itemNegozio,
  monthIndex,
  monthIndexLabel,
  CJ_DEFAULT_DRIVER_COLOR,
  CJ_FADED_STATES,
} = await import('../client/src/lib/customerJourneyTimeline.ts');

// Mappa colori driver "finta" (1:1 con quella reale ma senza trascinare
// lucide-react). Serve solo a verificare il fallback grigio.
const COLOR_MAP = {
  mobile: '#3B82F6',
  fisso: '#10B981',
  energia: '#F59E0B',
};

let nextId = 1;
// Costruisce un item della journey con i soli campi che la timeline legge.
function item(overrides = {}) {
  return {
    id: overrides.id ?? `item_${nextId++}`,
    driver: 'mobile',
    state: 'attivo',
    dataAttivazione: null,
    dataInserimento: null,
    pdvDestinazione: null,
    pdvOrigine: null,
    bisuiteSaleId: null,
    bisuiteId: null,
    ...overrides,
  };
}

function journey(overrides = {}) {
  return {
    openedAt: null,
    triggerSaleId: null,
    triggerBisuiteId: null,
    ...overrides,
  };
}

// ===========================================================================
// SCENARIO 1: nessun contratto con data => timeline in stato vuoto.
// ===========================================================================
test('scenario 1: items without any date => empty timeline', () => {
  const items = [
    item({ dataAttivazione: null, dataInserimento: null }),
    item({ dataAttivazione: null, dataInserimento: null }),
  ];
  const model = computeTimeline(journey(), items);
  assert.equal(model.empty, true, 'no dated item => empty timeline');
  assert.equal(model.rows.length, 0, 'empty timeline has no rows');
  assert.equal(model.months.length, 0, 'empty timeline has no month axis');
  assert.equal(model.t0Date, null);
  assert.equal(model.t0ItemId, undefined);
});

test('scenario 1b: zero items => empty timeline (no crash)', () => {
  const model = computeTimeline(journey(), []);
  assert.equal(model.empty, true);
  assert.equal(model.rows.length, 0);
});

// ===========================================================================
// SCENARIO 2: driver/stato sconosciuti => fallback grigio + nessun crash.
// ===========================================================================
test('scenario 2: unknown driver falls back to gray, no crash', () => {
  assert.equal(cjDriverColor('mobile', COLOR_MAP), '#3B82F6');
  assert.equal(
    cjDriverColor('driver_inesistente', COLOR_MAP),
    CJ_DEFAULT_DRIVER_COLOR,
    'unknown driver must fall back to the default gray',
  );
  assert.equal(cjDriverColor('', COLOR_MAP), CJ_DEFAULT_DRIVER_COLOR);

  // Un item con driver/stato sconosciuti deve comunque finire nella timeline
  // senza eccezioni: il fallback grigio e la label grezza sono gestiti a valle.
  const items = [
    item({
      driver: 'driver_misterioso',
      state: 'stato_misterioso',
      dataAttivazione: '2026-07-10T00:00:00.000Z',
    }),
  ];
  const model = computeTimeline(journey(), items);
  assert.equal(model.empty, false, 'a dated item builds a timeline');
  assert.equal(model.rows.length, 1);
  // Stato sconosciuto NON è attenuato (solo ko/stornato/annullato lo sono).
  assert.equal(isFadedState('stato_misterioso'), false);
});

// ===========================================================================
// SCENARIO 3: rilevamento T0.
//   3a) con trigger BiSuite (triggerSaleId / triggerBisuiteId);
//   3b) fallback alla prima attivazione mobile;
//   3c) fallback al primo evento in assoluto (nessun trigger, nessun mobile).
// ===========================================================================
test('scenario 3a: T0 detected via BiSuite trigger (saleId)', () => {
  const items = [
    item({ id: 'fisso1', driver: 'fisso', dataAttivazione: '2026-07-05T00:00:00.000Z', bisuiteSaleId: 111 }),
    item({ id: 'trigger', driver: 'mobile', dataAttivazione: '2026-08-01T00:00:00.000Z', bisuiteSaleId: 999 }),
  ];
  const model = computeTimeline(journey({ triggerSaleId: 999 }), items);
  assert.equal(model.t0ItemId, 'trigger', 'T0 must be the item matching the trigger saleId');
});

test('scenario 3a-bis: T0 detected via BiSuite trigger (bisuiteId)', () => {
  const items = [
    item({ id: 'a', driver: 'fisso', dataAttivazione: '2026-07-05T00:00:00.000Z', bisuiteId: 5 }),
    item({ id: 'b', driver: 'mobile', dataAttivazione: '2026-08-01T00:00:00.000Z', bisuiteId: 7 }),
  ];
  const model = computeTimeline(journey({ triggerBisuiteId: 5 }), items);
  assert.equal(model.t0ItemId, 'a', 'T0 must be the item matching the trigger bisuiteId');
});

test('scenario 3b: T0 falls back to the earliest mobile activation', () => {
  // Nessun trigger sulla journey: T0 = prima attivazione mobile per data,
  // anche se un fisso è cronologicamente precedente.
  const items = [
    item({ id: 'fisso', driver: 'fisso', dataAttivazione: '2026-07-01T00:00:00.000Z' }),
    item({ id: 'mob_late', driver: 'mobile', dataAttivazione: '2026-09-01T00:00:00.000Z' }),
    item({ id: 'mob_early', driver: 'mobile', dataAttivazione: '2026-08-01T00:00:00.000Z' }),
  ];
  const model = computeTimeline(journey(), items);
  assert.equal(model.t0ItemId, 'mob_early', 'T0 must be the earliest mobile item');
  // t0Date deve coincidere con l'attivazione mobile più precoce.
  assert.equal(model.t0Date.toISOString().slice(0, 10), '2026-08-01');
});

test('scenario 3c: T0 falls back to the earliest event when no trigger/mobile', () => {
  const items = [
    item({ id: 'fisso_late', driver: 'fisso', dataAttivazione: '2026-09-01T00:00:00.000Z' }),
    item({ id: 'energia_early', driver: 'energia', dataAttivazione: '2026-07-15T00:00:00.000Z' }),
  ];
  const model = computeTimeline(journey(), items);
  assert.equal(model.t0ItemId, 'energia_early', 'T0 falls back to the absolute earliest event');
  assert.equal(model.t0Date.toISOString().slice(0, 10), '2026-07-15');
});

test('scenario 3d: explicit journey.openedAt drives T0 date', () => {
  const items = [
    item({ id: 'mob', driver: 'mobile', dataAttivazione: '2026-08-10T00:00:00.000Z' }),
  ];
  const model = computeTimeline(journey({ openedAt: '2026-07-01T00:00:00.000Z' }), items);
  // openedAt vince sulla prima attivazione mobile per la DATA di T0.
  assert.equal(model.t0Date.toISOString().slice(0, 10), '2026-07-01');
  // ...ma l'item marcato T0 resta quello mobile (nessun trigger esplicito).
  assert.equal(model.t0ItemId, 'mob');
});

// ===========================================================================
// SCENARIO 4: stati ko/stornato/annullato attenuati.
// ===========================================================================
test('scenario 4: ko/stornato/annullato are faded states', () => {
  for (const s of ['ko', 'stornato', 'annullato']) {
    assert.equal(isFadedState(s), true, `${s} must be faded`);
    assert.ok(CJ_FADED_STATES.has(s));
  }
  for (const s of ['attivo', 'in_corso', 'da_attivare', '']) {
    assert.equal(isFadedState(s), false, `${s} must NOT be faded`);
  }
});

// ===========================================================================
// SCENARIO 5: asse mesi esteso oltre la finestra T0–T6.
// ===========================================================================
test('scenario 5: month axis spans at least T0..T6', () => {
  // Un solo evento (T0): l'asse copre comunque T0..T6 => 7 colonne.
  const items = [
    item({ id: 'mob', driver: 'mobile', dataAttivazione: '2026-07-01T00:00:00.000Z' }),
  ];
  const model = computeTimeline(journey(), items);
  assert.equal(model.months.length, 7, 'default axis is T0..T6 (7 months)');
  assert.equal(model.months[0], model.t0mi, 'axis starts at T0');
  assert.equal(model.months[6], model.t6mi, 'axis ends at T6');
});

test('scenario 5b: axis extends when an event falls after T6', () => {
  // Mobile a luglio 2026 (T0); un evento a marzo 2027 = T8 (oltre T6).
  const items = [
    item({ id: 'mob', driver: 'mobile', dataAttivazione: '2026-07-01T00:00:00.000Z' }),
    item({ id: 'late', driver: 'fisso', dataAttivazione: '2027-03-01T00:00:00.000Z' }),
  ];
  const model = computeTimeline(journey(), items);
  const lateMi = monthIndex(new Date('2027-03-01T00:00:00.000Z'));
  assert.equal(model.t0mi, monthIndex(new Date('2026-07-01T00:00:00.000Z')));
  assert.equal(model.endMi, lateMi, 'axis must extend to the out-of-window event');
  // luglio 2026 -> marzo 2027 = 9 mesi inclusivi.
  assert.equal(model.months.length, 9, 'axis covers T0..T8 (9 months)');
  assert.equal(model.months.at(-1), lateMi);
});

test('scenario 5c: axis extends backwards when an event precedes T0', () => {
  // openedAt fissa T0 a settembre 2026, ma un contratto è di luglio 2026.
  const items = [
    item({ id: 'early', driver: 'fisso', dataAttivazione: '2026-07-01T00:00:00.000Z' }),
    item({ id: 'mob', driver: 'mobile', dataAttivazione: '2026-09-15T00:00:00.000Z' }),
  ];
  const model = computeTimeline(journey({ openedAt: '2026-09-01T00:00:00.000Z' }), items);
  const earlyMi = monthIndex(new Date('2026-07-01T00:00:00.000Z'));
  assert.equal(model.startMi, earlyMi, 'axis must extend back to the pre-T0 event');
  assert.ok(model.startMi < model.t0mi, 'axis starts before T0');
});

test('scenario 5d: monthIndexLabel is stable across the year boundary', () => {
  const decMi = monthIndex(new Date('2026-12-01T00:00:00.000Z'));
  const janMi = monthIndex(new Date('2027-01-01T00:00:00.000Z'));
  assert.equal(janMi - decMi, 1, 'consecutive months differ by 1 across the year');
  assert.equal(monthIndexLabel(decMi), 'Dic 2026');
  assert.equal(monthIndexLabel(janMi), 'Gen 2027');
});

// ===========================================================================
// SCENARIO 6: raggruppamento per PDV (destinazione => origine => N/D).
// ===========================================================================
test('scenario 6: itemNegozio prefers destinazione, then origine, then N/D', () => {
  assert.equal(
    itemNegozio(item({ pdvDestinazione: 'DEST', pdvOrigine: 'ORIG' })),
    'DEST',
    'destinazione wins when present',
  );
  assert.equal(
    itemNegozio(item({ pdvDestinazione: null, pdvOrigine: 'ORIG' })),
    'ORIG',
    'falls back to origine',
  );
  assert.equal(
    itemNegozio(item({ pdvDestinazione: '', pdvOrigine: '' })),
    'N/D',
    'falls back to N/D when both empty',
  );
});

test('scenario 6b: groupByNegozio groups and sorts by contract count desc', () => {
  const items = [
    item({ driver: 'mobile', pdvDestinazione: 'PDV A' }),
    item({ driver: 'fisso', pdvDestinazione: 'PDV A' }),
    item({ driver: 'energia', pdvOrigine: 'PDV B' }), // destinazione assente => origine
    item({ driver: 'mobile' }), // nessun PDV => N/D
  ];
  const groups = groupByNegozio(items);
  assert.equal(groups.length, 3, 'three distinct negozi: PDV A, PDV B, N/D');
  // Ordinati per numero di contratti decrescente: PDV A (2) per primo.
  assert.equal(groups[0][0], 'PDV A');
  assert.equal(groups[0][1].length, 2);
  const byKey = new Map(groups.map(([k, v]) => [k, v.length]));
  assert.equal(byKey.get('PDV B'), 1);
  assert.equal(byKey.get('N/D'), 1);
});

// ===========================================================================
// SCENARIO 7: itemEventDate (data attivazione => data inserimento => null).
// ===========================================================================
test('scenario 7: itemEventDate prefers attivazione, then inserimento', () => {
  const a = itemEventDate(item({
    dataAttivazione: '2026-08-01T00:00:00.000Z',
    dataInserimento: '2026-07-01T00:00:00.000Z',
  }));
  assert.equal(a.toISOString().slice(0, 10), '2026-08-01', 'attivazione wins');

  const b = itemEventDate(item({
    dataAttivazione: null,
    dataInserimento: '2026-07-01T00:00:00.000Z',
  }));
  assert.equal(b.toISOString().slice(0, 10), '2026-07-01', 'falls back to inserimento');

  assert.equal(itemEventDate(item({})), null, 'no dates => null');
  // Data malformata => null (nessun crash).
  assert.equal(itemEventDate(item({ dataAttivazione: 'not-a-date' })), null);
});
