import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseVenditaInfo, normalizeCjIccid, cjPhoneEligibility, buildGettoneJourneys,
  cjJourneyReportRows, summarizeDrivers, aggregateGettone, gettoneTotals, gettoneDetailByKey,
} from '../shared/customerJourney.ts';
import { computeTimeline, computeItemValidity } from '../client/src/lib/customerJourneyTimeline.ts';
import { contractsBody, journeyGettoneRows } from '../shared/customerJourneyExport.ts';
import { reconcileCjMobile } from '../shared/customerJourneyDiagnostics.ts';
import { buildCjCohortModel } from '../shared/customerJourneyCohorts.ts';
import { cjPhoneIccidLinks } from '../shared/customerJourneyPhoneLink.ts';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SmartphoneIccidLink } from '../client/src/components/customer-journey/SmartphoneIccidLink.tsx';

// Synthetic identifiers, unrelated to the observed production customer/device.
const A = '89000000000000000001', B = '89000000000000000002', C = '89000000000000000003';
const july = '2026-07-09T00:00:00.000Z', august = '2026-08-09T00:00:00.000Z';
const journey = { id: 'synthetic-cj', customerKey: 'SYNTHETIC', customerType: 'privato',
  nominativo: 'Cliente sintetico', openedAt: july, triggerSaleId: 'sale-a', triggerBisuiteId: 101 };
const sim = (id, sale, iccid, date = july, over = {}) => ({
  id: `sim-${id}`, driver: 'mobile', categoria: 'TIED CF', tipologia: 'VOCE EASYPAY',
  descrizione: 'Nuova attivazione voce', bisuiteArticleId: id, bisuiteSaleId: sale,
  iccid, cjTriggerMobile: sale === 'sale-a' && id === 1, state: 'inserito',
  economicState: null, dataInserimento: date, dataAttivazione: null, ...over,
});
const phone = (id, sale, iccid, date = july, over = {}) => ({
  id: `phone-${id}`, driver: 'telefono', categoria: 'TELEFONIA', tipologia: 'SMARTPHONE',
  bisuiteArticleId: id, bisuiteSaleId: sale, iccid, cjTriggerMobile: false, state: 'inserito',
  economicState: null, dataInserimento: date, dataAttivazione: null, ...over,
});
const rows = items => cjJourneyReportRows(journey, items);

test('an operator-scoped detail keeps the original opening and labels the later pair as extra', () => {
  const items = [sim(10, 'sale-b', B, august), phone(11, 'sale-b', B, august)];
  const model = computeTimeline(journey, items);
  const validity = computeItemValidity(model, journey);
  assert.equal(model.t0ItemId, undefined);
  assert.equal(validity.get('phone-11').kind, 'coppia_extra');
  assert.equal(validity.get('sim-10').kind, 'non_pista');
});
const result = items => buildGettoneJourneys(rows(items))[0];
const pair = (iccid = B, sale = 'sale-b', id = 10, date = august) =>
  [sim(id, sale, iccid, date), phone(id + 1, sale, iccid, date)];

test('ICCID detail renders both full identifiers for initial and extra pairs without changing revenue', () => {
  const items = [sim(1, 'sale-a', A), phone(2, 'sale-a', A), ...pair()];
  const report = rows(items);
  const links = cjPhoneIccidLinks(report, july, journey.triggerBisuiteId);
  for (const [id, iccid] of [['phone-2', A], ['phone-11', B]]) {
    const link = links.get(id);
    assert.equal(link.status, 'abbinata');
    assert.equal(link.mobiles.length, 1);
    const html = renderToStaticMarkup(React.createElement(SmartphoneIccidLink, { link, itemId: id }));
    assert.match(html, /ICCID smartphone/);
    assert.match(html, /SIM abbinata/);
    assert.equal(html.split(iccid).length - 1, 2);
  }
  assert.equal(result(items).fatturato, 40);
});

test('later CB phone shows the referenced initial ICCID without claiming a valid CJ pairing', () => {
  const items = [sim(1, 'sale-a', A), phone(20, 'cb-sale', A, august)];
  const link = cjPhoneIccidLinks(rows(items), july).get('phone-20');
  assert.equal(link.status, 'corrispondenza');
  assert.equal(link.mobiles[0].iccid, A);
  const html = renderToStaticMarkup(React.createElement(SmartphoneIccidLink, { link, itemId: 'phone-20' }));
  assert.match(html, /non abbinamento CJ valido/);
  assert.equal(result(items).fatturato, 0);
});

test('ICCID links remain scoped to visible items and report missing or ambiguous matches', () => {
  const missing = rows([phone(2, 'sale-a', A)]);
  assert.equal(cjPhoneIccidLinks(missing, july).get('phone-2').status, 'non_verificabile');
  const invalid = rows([phone(2, 'sale-a', null)]);
  assert.equal(cjPhoneIccidLinks(invalid, july).get('phone-2').phoneIccid, null);
  const ambiguous = rows([sim(1, 'sale-a', A), ...pair(B), sim(12, 'sale-b', B, august)]);
  const link = cjPhoneIccidLinks(ambiguous, july).get('phone-11');
  assert.equal(link.status, 'ambigua');
  assert.equal(link.mobiles.length, 2);
});

test('ICCID is textual, normalized without rounding or losing leading zeros; conflicting labels fail closed', () => {
  const value = '00123456789012345678';
  assert.equal(normalizeCjIccid(` ${value.slice(0, 5)} ${value.slice(5)} `), value);
  assert.equal(normalizeCjIccid(Number(value)), null);
  assert.equal(normalizeCjIccid('8.9e19'), null);
  assert.equal(normalizeCjIccid('0'), null);
  assert.equal(parseVenditaInfo({ venditaInfo1: `ICCID SIM ALLEGATA: ${A}` }).iccid, A);
  assert.equal(parseVenditaInfo({ venditaInfo2: `ICCID SIM ALLEGATA: ${B}` }).iccid, B);
  assert.equal(parseVenditaInfo({ venditaInfo1: `ICCID: ${A}`, venditaInfo2: `ICCID: ${B}` }).iccid, undefined);
  assert.equal(parseVenditaInfo({ venditaInfo1: `ICCID: ${A}`, venditaInfo2: 'ICCID: invalid' }).iccid, undefined);
});

test('initial smartphone needs TELEFONIA + SMARTPHONE + opening SIM ICCID; history is retained', () => {
  const initial = sim(1, 'sale-a', A);
  for (const [over, kind] of [
    [{}, 'iniziale'], [{ iccid: B }, 'sim_non_abbinata'], [{ iccid: null }, 'iccid_mancante'],
    [{ tipologia: 'TABLET' }, 'non_smartphone'], [{ categoria: 'ACCESSORI' }, 'non_smartphone'],
  ]) {
    const items = [initial, phone(2, 'sale-a', A, july, over)];
    const g = result(items);
    const p = cjPhoneEligibility(rows(items), 2026 * 12 + 6).get('phone-2');
    assert.equal(p.kind, kind);
    assert.equal(g.pisteAttive, kind === 'iniziale' ? 1 : 0);
    assert.equal(g.extraStimato, 0);
    const validity = computeItemValidity(computeTimeline(journey, items), journey);
    assert.equal(validity.get('phone-2').counts, kind === 'iniziale');
    assert.equal(contractsBody(items, false, journey).length, 2);
    assert.match(contractsBody(items, false, journey)[1][14], kind === 'iniziale' ? /SIM iniziale/ : /non|Nessuna|ICCID/i);
  }
});

test('a later pair with a DIFFERENT ICCID adds precisely 20 €, no extra track/client/opening or potential reduction', () => {
  const items = [sim(1, 'sale-a', A), phone(2, 'sale-a', A), ...pair()];
  const g = result(items);
  assert.equal(g.gettoneBase, 20);
  assert.equal(g.extraStimato, 20);
  assert.equal(g.fatturato, 40);
  assert.equal(g.pisteAttive, 1);
  assert.equal(g.potenzialePieno, 100);
  // Actual cross-sell saturation (not the separate scenario-target selector).
  const detail = gettoneDetailByKey([g], () => 'store').get('store')[0];
  assert.equal(detail.saturazionePct, 20);
  const totals = gettoneTotals([g], 100);
  assert.equal(totals.clienti, 1); assert.equal(totals.potenziale, 100);
  assert.equal(totals.ramiSimAperti, 2);
  const grouped = aggregateGettone([g], () => ({ key: 'store', label: 'Store' }), 100)[0];
  assert.equal(grouped.ramiSimAperti, 2);
  assert.equal(grouped.gettoneBase, 20); assert.equal(grouped.extraStimato, 20); assert.equal(grouped.potenziale, 100);
  const v = computeItemValidity(computeTimeline(journey, items), journey);
  assert.equal(v.get('phone-11').kind, 'coppia_extra'); assert.equal(v.get('phone-11').counts, false);
  const summary = summarizeDrivers(rows(items), 2026 * 12 + 6);
  assert.equal(summary.find(s => s.driver === 'telefono').count, 1);
  const exported = new Map(journeyGettoneRows(journey, items));
  assert.equal(exported.get('Totale stimato'), g.fatturato);
  assert.equal(exported.get('Extra coppie SIM–smartphone'), 20);
  assert.equal(exported.get('Rami SIM aperti'), 2);
  assert.equal(exported.get('Rami iniziali'), 1);
  assert.equal(exported.get('Rami extra premio'), 1);
  const filters = { typeFilter: 'tutti', pdvFilter: [], addettoFilter: 'tutti', stateFilter: 'tutti', search: '' };
  const diagnostic = reconcileCjMobile([], rows(items), [g], filters, '', '');
  assert.equal(diagnostic.confirmed[0].extra, 20);
  assert.equal(diagnostic.confirmed[0].includingPresumed, g.fatturatoMaturato);
});

test('multiple SIMs on opening receipt: only selected trigger phone counts, no same-receipt extra', () => {
  const items = [sim(1, 'sale-a', A), sim(3, 'sale-a', B), phone(2, 'sale-a', A), phone(4, 'sale-a', B)];
  for (const order of [items, [...items].reverse()]) {
    const g = result(order);
    assert.equal(g.gettoneBase, 20); assert.equal(g.extraStimato, 0);
    assert.equal(computeTimeline(journey, order).t0ItemId, 'sim-1');
  }
});

test('CB smartphones on a SIM from before CJ never inflate July gettone or open extra branches', () => {
  const june = '2026-06-09T00:00:00.000Z';
  const oldMobile = sim(40, 'old-sale', C, june);
  const oldPhone = phone(41, 'old-sale', C, june, { descrizione: 'Smartphone cliente CB' });
  const cbPhone = phone(42, 'cb-sale', C, july, { descrizione: 'Smartphone CB su SIM precedente' });
  const items = [oldMobile, oldPhone, sim(1, 'sale-a', A), cbPhone, ...pair()];
  for (const order of [items, [...items].reverse()]) {
    const g = result(order);
    assert.equal(g.gettoneBase, 0);
    assert.equal(g.extraStimato, 20);
    assert.equal(g.fatturato, 20);
    assert.equal(g.extraCoppie, 1);
    assert.equal(gettoneTotals([g], 100).ramiSimAperti, 2);
    assert.equal(gettoneTotals([g], 100).clienti, 1);
  }
});

test('branch count excludes SIM-only sales, duplicate pairs, invalid or out-of-window pairs', () => {
  const initial = sim(1, 'sale-a', A);
  const good = pair();
  const duplicatePhone = { ...good[1], id: 'duplicate-phone' };
  const cancelled = pair(C, 'cancelled-sale', 30);
  cancelled[0].economicState = 'annullato';
  const items = [initial, sim(5, 'sim-only', C, august), ...good, duplicatePhone, ...cancelled];
  const g = result(items);
  assert.equal(g.extraCoppie, 1);
  assert.equal(gettoneTotals([g], 100).ramiSimAperti, 2);
  assert.equal(gettoneTotals([], 100).ramiSimAperti, 0);
  const late = result([initial, ...pair(B, 'late-sale', 50, '2027-02-01T00:00:00.000Z')]);
  assert.equal(gettoneTotals([late], 100).ramiSimAperti, 1);
  const second = { ...late, journeyId: 'second-client' };
  const totals = gettoneTotals([g, second], 100);
  assert.equal(totals.clienti, 2);
  assert.equal(totals.ramiSimAperti, 3);
});

test('SIM alone, phone alone, mismatched ICCID and ambiguous mobile contracts cannot generate extra', () => {
  const initial = sim(1, 'sale-a', A);
  const [mobile, device] = pair();
  for (const later of [
    [mobile], [device], [mobile, { ...device, iccid: C }],
    [mobile, sim(12, 'sale-b', B, august), device],
    [mobile, { ...device, iccid: null }],
  ]) assert.equal(result([initial, ...later]).extraStimato, 0);
});

test('duplicates are deduplicated per activation association, multiple distinct pairs count once each', () => {
  const items = [sim(1, 'sale-a', A), ...pair(B), phone(13, 'sale-b', B, august),
    ...pair(C, 'sale-c', 20, '2026-09-09T00:00:00.000Z')];
  assert.equal(result(items).extraStimato, 40);
  const duplicateContract = items.map(it => it.id === 'sim-10' ? { ...it, codiceContratto: 'SYNTHETIC-CONTRACT' } : it);
  duplicateContract.push(sim(14, 'sale-b', B, august, { codiceContratto: 'SYNTHETIC-CONTRACT' }));
  assert.equal(result(duplicateContract).extraStimato, 40);
  assert.equal(result([...items].reverse()).extraStimato, 40);
});

test('both members must be active and dated T0–T6, including annulled/KO/reversed and missing dates', () => {
  const initial = sim(1, 'sale-a', A);
  for (const target of [0, 1]) for (const over of [
    { state: 'ko' }, { economicState: 'annullato' }, { economicState: 'stornato' },
    { state: 'annullato' }, { dataInserimento: null },
    { dataInserimento: '2027-02-01T00:00:00.000Z' },
    { dataInserimento: '2026-06-01T00:00:00.000Z' },
  ]) {
    const later = pair(); later[target] = { ...later[target], ...over };
    assert.equal(result([initial, ...later]).extraStimato, 0, JSON.stringify({ target, over }));
  }
  assert.equal(result([initial, ...pair(B, 'sale-b', 10, '2027-01-31T00:00:00.000Z')]).extraStimato, 20);
});

test('estimated, explicit, presumed and manually confirmed amounts remain distinct for both members', () => {
  const items = [sim(1, 'sale-a', A), phone(2, 'sale-a', A), ...pair()];
  let g = result(items);
  assert.equal(g.gettoneBasePresunto, 20);
  assert.equal(g.extraMaturato, 0); assert.equal(g.extraStimato, 20);
  items[2].economicState = 'pagato';
  g = result(items);
  assert.equal(g.extraMaturato, 20); assert.equal(g.extraEsplicito, 0); assert.equal(g.extraPresunto, 20);
  items[3].economicState = 'riaccreditato';
  g = result(items);
  assert.equal(g.extraEsplicito, 20); assert.equal(g.extraPresunto, 0); assert.equal(g.extraConfermato, 0);
  items[3].gettoneConfirmed = true;
  assert.equal(result(items).extraConfermato, 0);
  items[2].gettoneConfirmed = true;
  assert.equal(result(items).extraConfermato, 20);
});

test('operator-filtered rows never reinterpret a later SIM as initial or infer linkage from another addetto', () => {
  const full = rows([sim(1, 'sale-a', A), ...pair()]);
  const laterOnly = full.slice(1);
  const g = buildGettoneJourneys(laterOnly)[0];
  assert.equal(g.gettoneBase, 0); assert.equal(g.extraStimato, 20);
  assert.equal(buildGettoneJourneys([laterOnly[0]])[0].extraStimato, 0);
});

test('same-day later receipt is ordered by CMS ID, and repeating the same ICCID on another receipt is not a new SIM', () => {
  const initial = sim(1, 'sale-a', A, july, { bisuiteId: 101 });
  const sameDay = pair(B, 'sale-b', 10, july).map(it => ({ ...it, bisuiteId: 102 }));
  assert.equal(result([initial, ...sameDay]).extraStimato, 20);
  assert.equal(buildGettoneJourneys(rows([initial, ...sameDay]).slice(1))[0].extraStimato, 20);
  assert.equal(result([initial, ...pair(B), ...pair(B, 'sale-c', 20, '2026-09-09T00:00:00.000Z')]).extraStimato, 20);
});

test('a smartphone on a later receipt with the initial ICCID is neither an initial track nor a new SIM pair', () => {
  const laterPhone = phone(20, 'sale-later', A, august);
  for (const mobiles of [[sim(1, 'sale-a', A)], [sim(1, 'sale-a', A), sim(19, 'sale-later', A, august)]]) {
    const items = [...mobiles, laterPhone], g = result(items);
    assert.equal(g.gettoneBase, 0); assert.equal(g.extraStimato, 0);
    assert.equal(computeItemValidity(computeTimeline(journey, items), journey).get('phone-20').counts, false);
    assert.equal(cjPhoneEligibility(rows(items), 2026 * 12 + 6).get('phone-20').kind, 'sim_non_abbinata');
    assert.equal(new Map(journeyGettoneRows(journey, items)).get('Totale stimato'), 0);
  }
});

test('monthly cohorts use the same base/extra stock and do not add a sixth pista; explicit versus presumed remains separate', () => {
  const items = [sim(1, 'sale-a', A), phone(2, 'sale-a', A), ...pair()];
  items[2].economicState = 'pagato';
  const report = rows(items).map(r => ({
    ...r, economicHistory: r.driver === 'telefono'
      ? [{ month: r.insertedAt.slice(0, 7), state: 'pagato', source: 'presunto' }]
      : r.economicState === 'pagato' ? [{ month: '2026-08', state: 'pagato', source: 'drms' }] : [],
    historyIncomplete: false,
  }));
  const model = buildCjCohortModel(report);
  const g = result(items);
  assert.equal(model.customers[0].generated, g.fatturato);
  assert.equal(model.customers[0].extraGenerated, g.extraStimato);
  assert.equal(model.customers[0].confirmed, g.fatturatoMaturato);
  assert.equal(model.events.filter(e => e.newPista).length, 1);
  assert.equal(model.events.filter(e => e.extraGenerated).length, 1);
  assert.equal(model.events.filter(e => e.kind === 'riconoscimento' && e.extraConfirmed && e.source !== 'presunto').length, 0);
});

test('the five original tiers stay unchanged; extra at full saturation cannot make residual potential negative', () => {
  const fixedTracks = ['fisso', 'energia', 'assicurazioni', 'protetti'].map((driver, i) => ({
    ...phone(50 + i, 'sale-a', null), driver,
  }));
  for (let n = 0; n <= 4; n++) {
    const g = result([sim(1, 'sale-a', A), phone(2, 'sale-a', A), ...fixedTracks.slice(0, n), ...pair()]);
    assert.equal(g.gettoneBase, [20, 30, 40, 100, 120][n]);
    assert.equal(g.extraStimato, 20); assert.equal(g.pisteAttive, 1 + n);
    assert.equal(g.potenzialePieno, 120 - g.gettoneBase);
  }
});
