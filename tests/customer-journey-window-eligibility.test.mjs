import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCjMobileEligible, pisteInWindow, monthOfIso, buildGettoneJourneys, summarizeDrivers, cjT0Month } from '../shared/customerJourney.ts';
import { computeTimeline, computeItemValidity } from '../client/src/lib/customerJourneyTimeline.ts';
import { driverTableBody, activeDriverCount } from '../shared/customerJourneyExport.ts';

const t0 = '2026-07-20T10:00:00.000Z';
const article = (categoria, tipologia, descrizione) => ({ categoria, tipologia, descrizione });

test('CJ eligibility: BiSuite data, Tourist and alarm SIM signals are excluded without changing voice or Protetti', () => {
  assert.equal(isCjMobileEligible({}), false);
  assert.equal(isCjMobileEligible(article('ALLARMI', 'ALLARMI', 'Windtre Protetti')), false, 'Protetti is a separate driver, not a SIM');
  for (const a of [
    article('TIED CF', 'DATI EASYPAY', 'Super Internet'),
    article('UNTIED', 'RICARICABILE DATI', 'Internet'),
    article('TIED IVA', 'DATI IVA', 'Professional'),
    article('TIED IVA', 'VOCE IVA', 'Professional Data 10'),
    article('TIED IVA', null, 'Professional Data 60'),
    article('TIED IVA', null, 'Professional Data 100'),
    article('ALTRE GA', 'GA TURISTICHE', 'Pass'),
    article('UNTIED', 'RICARICABILE', 'Tourist XXL'),
    article('ALTRE GA', 'ALTRE GA NON TURISTICHE', 'Nuova SIM'),
    article('TIED CF', 'VOCE EASYPAY', 'SIM Allarme'),
    article('UNTIED', 'SIM_ALLARME', 'Security'),
    article('ALTRE GA', null, 'SIM per allarmi'),
    article('UNTIED', null, 'SIM dati'),
  ]) assert.equal(isCjMobileEligible(a), false, JSON.stringify(a));
  for (const a of [
    article('TIED CF', 'VOCE EASYPAY', 'Unlimited 200 giga e dati inclusi'),
    article('UNTIED', 'RICARICABILE VOCE', 'Voce con 100 GB'),
    article('TIED IVA', 'VOCE IVA', 'Professional Full Plus'),
    article('TIED IVA', null, 'Professional World'),
    article('ALTRE GA', 'VOCE', 'Nuova SIM voce'),
    article('VERY MOBILE', null, 'Very 150 giga'),
  ]) assert.equal(isCjMobileEligible(a), true, JSON.stringify(a));
});

test('solar window includes days before the SIM in T0, all T6, excludes previous month and T7', () => {
  const month = monthOfIso(t0);
  for (const d of ['2026-07-01', '2026-07-05', '2027-01-31T23:59:59.999Z']) assert.equal(pisteInWindow(d, month), true);
  for (const d of ['2026-06-30T23:59:59.999Z', '2027-02-01T00:00:00.000Z']) assert.equal(pisteInWindow(d, month), false);
  // Existing policy for unlocatable dates is unchanged.
  assert.equal(pisteInWindow(null, month), true);
  assert.equal(pisteInWindow('bad', month), true);
  assert.equal(pisteInWindow('2027-02-01', null), true);
});

function item(id, driver, eventDate, extra = {}) {
  return { id, driver, state: 'attivato', economicState: 'pagato', dataInserimento: eventDate,
    eventDate, bisuiteSaleId: id, ...extra };
}
function checkParity(items, openedAt = t0) {
  const journey = { openedAt, triggerSaleId: 'sim' };
  const rows = items.map(it => ({ ...it, journeyId: 'j', openedAt, insertedAt: it.dataInserimento,
    cliente: 'Test', customerType: 'privato', pdv: 'PDV', addetto: 'Addetto', valore: 0 }));
  const validity = computeItemValidity(computeTimeline(journey, items), journey);
  const gettone = buildGettoneJourneys(rows);
  const month = cjT0Month(openedAt, rows);
  const summary = summarizeDrivers(rows, month);
  if (gettone.length) assert.equal([...validity.values()].filter(v => v.counts).length, gettone[0].pisteAttive);
  return { validity, gettone, summary };
}

test('card, summaries, confirmed gettone, SIM volumes and historical items share T0–T6 and eligibility', () => {
  const items = [
    item('excluded', 'mobile', '2026-07-01', article('TIED IVA', 'VOCE IVA', 'Professional Data 100')),
    item('tourist', 'mobile', '2026-07-02', article('ALTRE GA', 'GA TURISTICHE', 'Tourist')),
    item('alarm', 'mobile', '2026-07-03', article('ALTRE GA', 'ALTRE GA NON TURISTICHE', 'SIM Allarme')),
    item('sim', 'mobile', t0, article('TIED CF', 'VOCE EASYPAY', 'Voce 100GB')),
    item('previous', 'fisso', '2026-06-30T23:59:59.999Z'),
    item('beforeSim', 'fisso', '2026-07-05'),
    item('t6', 'energia', '2027-01-31T23:59:59.999Z'),
    item('t7', 'telefono', '2027-02-01T00:00:00.000Z'),
    item('lateSim', 'mobile', '2027-02-01', article('UNTIED', 'VOCE', 'Voce')),
    item('protetti', 'protetti', '2026-08-01', article('ALLARMI', 'ALLARMI', 'Windtre Protetti')),
  ];
  const { validity, gettone, summary } = checkParity(items);
  assert.equal(gettone[0].simAttive, 1);
  assert.equal(gettone[0].insertedAt, t0);
  assert.equal(gettone[0].pisteAttive, 3);
  assert.equal(gettone[0].pisteConfermate, 3);
  assert.equal(gettone[0].fatturato, 40);
  assert.equal(gettone[0].fatturatoMaturato, 40);
  assert.equal(validity.get('excluded').kind, 'sim_esclusa');
  assert.equal(validity.get('sim').kind, 'attivante');
  assert.equal(validity.get('beforeSim').counts, true);
  assert.equal(validity.get('previous').kind, 'fuori_periodo');
  assert.equal(validity.get('t7').kind, 'fuori_periodo');
  assert.equal(summary.find(d => d.driver === 'telefono').activated, false);
  assert.equal(summary.find(d => d.driver === 'mobile').count, 1);
  const exported = driverTableBody(summary, false);
  assert.deepEqual(exported.find(row => row[1] === 'Mobile').slice(2), ['Attivato', 1]);
  assert.deepEqual(exported.find(row => row[1] === 'Smartphone').slice(2), ['Attivabile', 0]);
  assert.equal(activeDriverCount({ drivers: summary }), 4, 'list export: SIM plus the same three valid drivers');
  assert.equal(computeTimeline({ openedAt: t0, triggerSaleId: 'excluded' }, items).t0ItemId, 'sim');
});

test('excluded SIMs cannot form a cohort or become the T0 fallback; missing event dates keep existing policy', () => {
  const excluded = item('excluded', 'mobile', '2026-06-01', article('UNTIED', 'RICARICABILE DATI', 'Internet'));
  assert.equal(checkParity([excluded, item('f', 'fisso', t0)]).gettone.length, 0);
  const items = [excluded, item('sim', 'mobile', t0), item('undated', 'energia', null), item('late', 'fisso', '2027-02-01')];
  const { gettone, validity } = checkParity(items, null);
  assert.equal(gettone[0].pisteAttive, 1);
  assert.equal(validity.get('undated').counts, true);
  assert.equal(validity.get('late').counts, false);
  assert.equal(cjT0Month(null, items), monthOfIso(t0));
});
