import { test } from 'node:test';
import assert from 'node:assert/strict';

// Test suite Mapping canvass Vodafone/Fastweb (Task #301).
//
// È logica PURA: nessun server, nessun DB. I moduli TS in `shared/` vengono
// caricati via loader `tsx`. Copre:
//   - parsing/forma del catalogo baked (shared/canvassCatalog.ts);
//   - estrazione offerId e derivazione brand dalla pista;
//   - costruzione indici + esclusione delle coppie categoria|tipologia ambigue;
//   - categorizzazione articolo: match per codice esatto, per offerId
//     (suffisso edizione diverso), per categoria/tipologia, e codice non mappato;
//   - aggregazione vendite (pezzi/canone per pista + elenco non mappati);
//   - raggruppamento step di vendita per pista.

const {
  normalizeCodice,
  extractOfferId,
  deriveBrandFromPista,
  buildCanvassIndex,
  categorizeCanvassArticle,
  aggregateCanvassSales,
  groupStepsByPista,
  buildCanvassReferenceFromRows,
  validateCanvassHeaders,
  CANVASS_LISTINO_COLUMNS,
  CANVASS_STEP_COLUMNS,
} = await import('../shared/canvassMapping.ts');
const { CANVASS_CATALOG } = await import('../shared/canvassCatalog.ts');

test('catalogo baked ha la forma attesa', () => {
  assert.equal(CANVASS_CATALOG.periodo, 'LUGLIO 2026');
  assert.equal(CANVASS_CATALOG.offers.length, 306);
  assert.equal(CANVASS_CATALOG.steps.length, 76);
  const o = CANVASS_CATALOG.offers[0];
  for (const k of ['codice', 'offerId', 'nomeEtichetta', 'pista', 'categoria', 'tipologia', 'canone', 'brand']) {
    assert.ok(k in o, `manca campo ${k}`);
  }
});

test('normalizeCodice: uppercase + niente spazi', () => {
  assert.equal(normalizeCodice(' can ohewd 2208 '), 'CANOHEWD2208');
  assert.equal(normalizeCodice(null), '');
});

test('extractOfferId: 5 char centrali di CAN·····dddd', () => {
  assert.equal(extractOfferId('CANOHEWD2208'), 'OHEWD');
  assert.equal(extractOfferId('canohewd2208'), 'OHEWD');
  assert.equal(extractOfferId('OHEWD'), null);
  assert.equal(extractOfferId('CANOHEWDXXXX'), null); // suffisso non numerico
});

test('deriveBrandFromPista', () => {
  assert.equal(deriveBrandFromPista('PISTA MOBILE'), 'vodafone');
  assert.equal(deriveBrandFromPista('ENERGIA VODAFONE'), 'vodafone');
  assert.equal(deriveBrandFromPista('VERISURE'), 'vodafone');
  assert.equal(deriveBrandFromPista('PISTA MOBILE FASTWEB'), 'fastweb');
  assert.equal(deriveBrandFromPista('ENERGIA FASTWEB'), 'fastweb');
});

test('buildCanvassIndex indicizza per codice e offerId; esclude catTip ambigue', () => {
  const index = buildCanvassIndex(CANVASS_CATALOG.offers);
  assert.equal(index.offersCount, 306);
  assert.equal(index.byCodice.size, 306);
  assert.equal(index.byOfferId.size, 306);
  // "FASTWEB ENERGIA|LUCE FASTWEB" appare in ENERGIA FASTWEB e ENERGIA VODAFONE
  // => ambigua => NON in byCatTip.
  assert.equal(index.byCatTip.has('FASTWEB ENERGIA|||LUCE FASTWEB'), false);
  // Una coppia non ambigua c'è.
  assert.equal(index.byCatTip.has('OFFERTE VOCE|||OFFERTE VOCE WALLET PAY'), true);
});

test('categorizeCanvassArticle: match per codice esatto', () => {
  const index = buildCanvassIndex(CANVASS_CATALOG.offers);
  const m = categorizeCanvassArticle({ codice: 'CANOHEWD2208' }, index);
  assert.ok(m);
  assert.equal(m.matchType, 'codice');
  assert.equal(m.pista, 'PISTA MOBILE');
  assert.equal(m.categoria, 'OFFERTE VOCE');
  assert.equal(m.canone, 8.99);
  assert.equal(m.brand, 'vodafone');
});

test('categorizeCanvassArticle: fallback per offerId (edizione diversa)', () => {
  const index = buildCanvassIndex(CANVASS_CATALOG.offers);
  // Stesso offerId "OHEWD" ma suffisso edizione differente ("9999").
  const m = categorizeCanvassArticle({ codice: 'CANOHEWD9999' }, index);
  assert.ok(m);
  assert.equal(m.matchType, 'offerId');
  assert.equal(m.pista, 'PISTA MOBILE');
  assert.equal(m.categoria, 'OFFERTE VOCE');
});

test('categorizeCanvassArticle: fallback per categoria/tipologia', () => {
  const index = buildCanvassIndex(CANVASS_CATALOG.offers);
  const m = categorizeCanvassArticle(
    {
      codice: 'ZZZZZZZZZZZZ',
      categoria: { nome: 'OFFERTE VOCE' },
      tipologia: { nome: 'OFFERTE VOCE WALLET PAY' },
    },
    index,
  );
  assert.ok(m);
  assert.equal(m.matchType, 'catTip');
  assert.equal(m.pista, 'PISTA MOBILE');
});

test('categorizeCanvassArticle: codice non mappato => null', () => {
  const index = buildCanvassIndex(CANVASS_CATALOG.offers);
  assert.equal(categorizeCanvassArticle({ codice: 'CANZZZZZ0000' }, index), null);
  assert.equal(
    categorizeCanvassArticle(
      { codice: 'CANZZZZZ0000', categoria: { nome: 'BOH' }, tipologia: { nome: 'BOH' } },
      index,
    ),
    null,
  );
});

test('aggregateCanvassSales: pezzi/canone per pista + non mappati', () => {
  const index = buildCanvassIndex(CANVASS_CATALOG.offers);
  const sales = [
    { rawData: { articoli: [{ codice: 'CANOHEWD2208' }, { codice: 'CANOHEWD2208' }] } },
    { rawData: { articoli: [{ codice: 'CANNONESISTE00', categoria: { nome: 'X' }, tipologia: { nome: 'Y' }, descrizione: 'ignota' }] } },
  ];
  const agg = aggregateCanvassSales(sales, index);
  assert.equal(agg.totalArticoli, 3);
  assert.equal(agg.totalMapped, 2);
  assert.equal(agg.totalUnmapped, 1);
  assert.equal(agg.matchCounts.codice, 2);
  const voce = agg.byPista['PISTA MOBILE']['OFFERTE VOCE']['OFFERTE VOCE WALLET PAY'];
  assert.equal(voce.pezzi, 2);
  assert.ok(Math.abs(voce.canone - 17.98) < 1e-9);
  assert.equal(agg.unmapped.length, 1);
  assert.equal(agg.unmapped[0].pezzi, 1);
});

test('aggregateCanvassSales: raggruppa i non mappati per codice', () => {
  const index = buildCanvassIndex(CANVASS_CATALOG.offers);
  const sales = [
    { rawData: { articoli: [{ codice: 'CANZZZZZ0000' }, { codice: 'CANZZZZZ0000' }] } },
  ];
  const agg = aggregateCanvassSales(sales, index);
  assert.equal(agg.unmapped.length, 1);
  assert.equal(agg.unmapped[0].codice, 'CANZZZZZ0000');
  assert.equal(agg.unmapped[0].pezzi, 2);
});

test('groupStepsByPista: raggruppa per pista FORM e ordina per ordine', () => {
  const groups = groupStepsByPista(CANVASS_CATALOG.steps);
  assert.ok(groups.length > 0);
  for (const g of groups) {
    for (let i = 1; i < g.steps.length; i++) {
      assert.ok((g.steps[i - 1].ordine ?? 0) <= (g.steps[i].ordine ?? 0));
    }
  }
  const mobile = groups.find((g) => g.pista === 'PISTA MOBILE');
  assert.ok(mobile);
  assert.ok(mobile.steps.length > 0);
});

test('buildCanvassReferenceFromRows: costruisce reference da righe Excel grezze', () => {
  const listinoRows = [
    { CODICE: ' can ohewd 2208 ', 'NOME ETICHETTA': 'Offerta A', PISTA: 'PISTA MOBILE', CATEGORIA: 'MOBILE', TIPOLOGIA: 'RIC', CANONE: '9,99' },
    { CODICE: 'CANABCDE1111', 'NOME ETICHETTA': 'Offerta FW', PISTA: 'FASTWEB CASA', CATEGORIA: 'FISSO', TIPOLOGIA: 'FTTH', CANONE: 24.9 },
    { CODICE: '', 'NOME ETICHETTA': 'da scartare', PISTA: 'X', CATEGORIA: '', TIPOLOGIA: '', CANONE: '' },
  ];
  const stepRows = [
    { ID: '5', 'Pista Associata': 'PA', 'Pista FORM': 'PISTA MOBILE', Domanda: 'Domanda 1', Ordine: '2', ATTIVO: 'S', Brand: 'vodafone' },
    { ID: '', 'Pista Associata': '', 'Pista FORM': '', Domanda: '', Ordine: '', ATTIVO: 'N', Brand: '' },
  ];
  const ref = buildCanvassReferenceFromRows(listinoRows, stepRows, '  AGOSTO 2026  ');
  assert.equal(ref.periodo, 'AGOSTO 2026');
  assert.equal(ref.offers.length, 2);
  const [a, b] = ref.offers;
  assert.equal(a.codice, 'CANOHEWD2208');
  assert.equal(a.offerId, 'OHEWD');
  assert.equal(a.canone, 9.99);
  assert.equal(a.brand, 'vodafone');
  assert.equal(b.brand, 'fastweb');
  assert.equal(b.canone, 24.9);
  assert.equal(ref.steps.length, 1);
  assert.equal(ref.steps[0].externalId, 5);
  assert.equal(ref.steps[0].ordine, 2);
  assert.equal(ref.steps[0].attivo, true);
});

test('buildCanvassReferenceFromRows: nessuna offerta se manca CODICE', () => {
  const ref = buildCanvassReferenceFromRows(
    [{ CODICE: '', PISTA: 'X' }],
    [],
    'SETTEMBRE 2026',
  );
  assert.equal(ref.offers.length, 0);
  assert.equal(ref.steps.length, 0);
});

test('validateCanvassHeaders: listino valido', () => {
  const rows = [
    { CODICE: 'CANOHEWD2208', PISTA: 'PISTA MOBILE', 'NOME ETICHETTA': 'A', CATEGORIA: 'MOBILE', TIPOLOGIA: 'RIC', CANONE: '9,99' },
  ];
  const res = validateCanvassHeaders(rows, CANVASS_LISTINO_COLUMNS);
  assert.equal(res.valid, true);
  assert.equal(res.empty, false);
  assert.deepEqual(res.missing, []);
});

test('validateCanvassHeaders: step valido', () => {
  const rows = [
    { ID: '5', 'Pista Associata': 'PA', 'Pista FORM': 'PISTA MOBILE', Domanda: 'D1', Ordine: '2', ATTIVO: 'S', Brand: 'vodafone' },
  ];
  const res = validateCanvassHeaders(rows, CANVASS_STEP_COLUMNS);
  assert.equal(res.valid, true);
  assert.deepEqual(res.missing, []);
});

test('validateCanvassHeaders: elenca le colonne mancanti (intestazioni rinominate)', () => {
  const rows = [
    { CODICE: 'CANOHEWD2208', PISTA: 'PISTA MOBILE', ETICHETTA: 'A', CATEGORIA: 'MOBILE', TIPO: 'RIC', PREZZO: '9,99' },
  ];
  const res = validateCanvassHeaders(rows, CANVASS_LISTINO_COLUMNS);
  assert.equal(res.valid, false);
  assert.equal(res.empty, false);
  assert.deepEqual(res.missing, ['NOME ETICHETTA', 'TIPOLOGIA', 'CANONE']);
});

test('validateCanvassHeaders: foglio vuoto => empty + tutte mancanti', () => {
  const res = validateCanvassHeaders([], CANVASS_LISTINO_COLUMNS);
  assert.equal(res.valid, false);
  assert.equal(res.empty, true);
  assert.deepEqual(res.missing, [...CANVASS_LISTINO_COLUMNS]);
  const resNull = validateCanvassHeaders(null, CANVASS_STEP_COLUMNS);
  assert.equal(resNull.empty, true);
  assert.deepEqual(resNull.missing, [...CANVASS_STEP_COLUMNS]);
});

test('validateCanvassHeaders: tollera spazi nelle intestazioni', () => {
  const rows = [
    { ' CODICE ': 'X', ' PISTA': 'Y', 'NOME ETICHETTA ': 'A', CATEGORIA: 'C', TIPOLOGIA: 'T', ' CANONE ': '1' },
  ];
  const res = validateCanvassHeaders(rows, CANVASS_LISTINO_COLUMNS);
  assert.equal(res.valid, true);
  assert.deepEqual(res.missing, []);
});

// === Task #317: classificazione brand-aware in Vendite BiSuite ===

const {
  classifyArticle,
  classifySaleArticles,
  countVfUpsellingVolumes,
  pistaFromCanvassListino,
  PISTA_CANVASS_LABELS,
  PISTA_CANVASS_COLORS,
} = await import('../shared/bisuiteClassification.ts');

test('pistaFromCanvassListino: piste del listino VF → PistaCanvass', () => {
  assert.equal(pistaFromCanvassListino('PISTA IVA'), 'iva');
  assert.equal(pistaFromCanvassListino('PISTA MOBILE'), 'mobile');
  assert.equal(pistaFromCanvassListino('PISTA MOBILE FASTWEB'), 'mobile');
  assert.equal(pistaFromCanvassListino('PISTA FISSO'), 'fisso');
  assert.equal(pistaFromCanvassListino('PISTA FISSO FASTWEB'), 'fisso');
  assert.equal(pistaFromCanvassListino('PISTA CB'), 'cb');
  assert.equal(pistaFromCanvassListino('ENERGIA FASTWEB'), 'energia');
  assert.equal(pistaFromCanvassListino('ENERGIA VODAFONE'), 'energia');
  assert.equal(pistaFromCanvassListino('VERISURE'), 'protecta');
  assert.equal(pistaFromCanvassListino('QUALCOSA DI NUOVO'), undefined);
});

test('pista "iva" ha label e colore per la UI', () => {
  assert.equal(PISTA_CANVASS_LABELS.iva, 'P.IVA');
  assert.ok(PISTA_CANVASS_COLORS.iva);
});

test('classifyArticle con indice VF: articolo del listino → canvass con pista dal listino', () => {
  const index = buildCanvassIndex(CANVASS_CATALOG.offers);
  // Codice esatto del listino (pista mobile).
  const m = classifyArticle({ codice: 'CANOHEWD2208' }, index);
  assert.deepEqual(m, { type: 'canvass', pista: 'mobile' });
  // Un'offerta PISTA IVA del catalogo baked.
  // Task #527 — le offerte PISTA IVA risolvono nella sottopista fine
  // (IVA VOCE → iva_mobile).
  const ivaVoceOffer = CANVASS_CATALOG.offers.find((o) => o.pista === 'PISTA IVA' && o.categoria.toUpperCase().includes('IVA VOCE'));
  assert.ok(ivaVoceOffer);
  const mIva = classifyArticle({ codice: ivaVoceOffer.codice }, index);
  assert.deepEqual(mIva, { type: 'canvass', pista: 'iva_mobile' });
  // Match per categoria/tipologia non ambigua, codice sconosciuto.
  const mCat = classifyArticle(
    { codice: 'ZZZ', categoria: { nome: 'OFFERTE VOCE' }, tipologia: { nome: 'OFFERTE VOCE WALLET PAY' } },
    index,
  );
  assert.deepEqual(mCat, { type: 'canvass', pista: 'mobile' });
});

test('classifyArticle senza indice (org WindTre): comportamento invariato', () => {
  // Articolo VF non presente nella mappa WindTre → null (poi default prodotti).
  assert.equal(classifyArticle({ codice: 'CANOHEWD2208', categoria: { nome: 'OFFERTE VOCE' } }), null);
  // Categorie WindTre classificate come prima.
  assert.deepEqual(classifyArticle({ categoria: { nome: 'UNTIED' } }), { type: 'canvass', pista: 'mobile' });
  assert.deepEqual(classifyArticle({ categoria: { nome: 'RICARICHE' } }), { type: 'prodotti' });
});

test('classifyArticle con indice: prodotti veri restano prodotti, categorie WindTre intatte', () => {
  const index = buildCanvassIndex(CANVASS_CATALOG.offers);
  assert.deepEqual(classifyArticle({ codice: 'RIC5', categoria: { nome: 'RICARICHE' } }, index), { type: 'prodotti' });
  assert.deepEqual(classifyArticle({ categoria: { nome: 'ACCESSORI' } }, index), { type: 'prodotti' });
  assert.deepEqual(classifyArticle({ categoria: { nome: 'UNTIED' } }, index), { type: 'canvass', pista: 'mobile' });
});

test('classifySaleArticles con indice VF: card Canvass e countByPista coerenti', () => {
  const index = buildCanvassIndex(CANVASS_CATALOG.offers);
  // Task #527 — offerta IVA VOCE: conta nella sottopista fine iva_mobile.
  const ivaOffer = CANVASS_CATALOG.offers.find((o) => o.pista === 'PISTA IVA' && o.categoria.toUpperCase().includes('IVA VOCE'));
  const rawData = {
    articoli: [
      { codice: 'CANOHEWD2208', categoria: { nome: 'OFFERTE VOCE' }, tipologia: { nome: 'X' }, descrizione: 'Offerta mobile', dettaglio: { prezzo: '10.00', scontrino: 1 } },
      { codice: ivaOffer.codice, categoria: { nome: ivaOffer.categoria }, tipologia: { nome: ivaOffer.tipologia }, descrizione: 'Offerta IVA', dettaglio: { prezzo: '20.00', scontrino: 1 } },
      { codice: 'RICX', categoria: { nome: 'RICARICHE' }, tipologia: { nome: 'RICARICA' }, descrizione: 'Ricarica', dettaglio: { prezzo: '5.00', scontrino: 1 } },
    ],
  };
  const sc = classifySaleArticles(rawData, index);
  assert.equal(sc.countByType.canvass, 2);
  assert.equal(sc.countByType.prodotti, 1);
  assert.equal(sc.countByPista.mobile, 1);
  assert.equal(sc.countByPista.iva_mobile, 1);
  assert.equal(sc.hasCanvass, true);
  // Stessa vendita senza indice: tutto ciò che non è in CATEGORY_MAP → prodotti.
  const scNoIdx = classifySaleArticles(rawData);
  assert.equal(scNoIdx.countByType.canvass, 0);
  assert.equal(scNoIdx.countByType.prodotti, 3);
});

test('Upselling VF: tutte e sole le famiglie di domande ammesse contano con risposta positiva', () => {
  const allowedQuestions = [
    'RETE SICURA 2.0',
    'RETE SICURA 2.0 CB',
    'RETE SICURA FAMILY',
    'RETE SICURA FAMILY CB',
    'FASTWEB PROTECT',
    'VODAFONE CLUB GA',
    'VODAFONE CLUB CB',
    'FASTWEB UP PLUS',
    'ONE NUMBER',
    'KASKO SMARTPHONE FACILE GA',
    'KASKO SMARTPHONE FACILE CB',
    'VODAFONE CLUB ABBINATE ALLA VENDITA DI UN TNP',
    'VODAFONE CLUB PLUS GA',
    'VODAFONE CLUB PLUS CB',
    'TRADE IN DIGITALE',
    'forward trade in',
    'EXTENDER',
    'SUPER WI-FI EXTENDER 6 GA',
    'SUPER WI-FI EXTENDER 6 CB',
    'VODAFONE SEVEN BOOSTER WI-FI 7 GA',
    'VODAFONE SEVEN BOOSTER WI-FI 7 CB',
    'FASTWEB SEVEN BOOSTER',
    'trade in',
    'trade in cb',
  ];
  for (const domanda of allowedQuestions) {
    const article = { dettaglio: { domandeRisposte: [{ domanda, risposta: 'SI' }] } };
    assert.equal(countVfUpsellingVolumes(article), 1, `domanda ammessa non conteggiata: ${domanda}`);
  }

  const excludedQuestions = [
    'smartphone easy cb',
    'MOP + RIC',
    'GIGA FAMILY IN CB',
    'TNP FASCIA ALTA IN CB',
    'ADD ON CHIAMATE (OPZIONI FLAT)',
    'ASSICURAZIONE QUIXA',
  ];
  for (const domanda of excludedQuestions) {
    const article = { dettaglio: { domandeRisposte: [{ domanda, risposta: 'SI' }] } };
    assert.equal(countVfUpsellingVolumes(article), 0, `domanda fuori allowlist conteggiata: ${domanda}`);
  }
  assert.equal(
    countVfUpsellingVolumes({ dettaglio: { domandeRisposte: [{ domanda: 'RETE SICURA 2.0', risposta: 'NO' }] } }),
    0,
  );
});

test('Upselling VF: offerte MM4M, change order, booster e servizi ammessi sono fail-closed', () => {
  const allowedOffers = [
    'RETE SICURA 2.0 CB',
    'RETE SICURA FAMILY CB',
    'FASTWEB PROTECT',
    'VODAFONE CLUB',
    'FASTWEB UP PLUS',
    'ONE NUMBER GA / CB',
    'VODAFONE MOBILE START SPECIAL',
    'VODAFONE MOBILE PRO SPECIAL',
    'VODAFONE MOBILE POWER SPECIAL',
    'VODAFONE MOBILE ULTRA SPECIAL',
    'VODAFONE MOBILE ULTRA PLUS',
    'CHANGE ORDER FASTWEB IN UPGRADE (MOBILE START)',
    'CHANGE ORDER FASTWEB IN UPGRADE (MOBILE PRO)',
    'CHANGE ORDER FASTWEB IN UPGRADE (POWER)',
    'CHANGE ORDER FASTWEB IN UPGRADE (ULTRA)',
    'KASKO GA',
    'VODAFONE CLUB PLUS GA',
    'VODAFONE CLUB PLUS',
    'TRADE IN DIGITALE',
    'SUPER WIFI EXTENDER IN CB',
    'VODAFONE SEVEN BOOSTER WI-FI 7 CB',
    'FASTWEB SEVEN BOOSTER',
    'TRADE IN',
  ];
  for (const nomeEtichetta of allowedOffers) {
    assert.equal(
      countVfUpsellingVolumes({}, { pista: 'PISTA CB', categoria: 'X', tipologia: 'Y', nomeEtichetta }),
      1,
      `offerta ammessa non conteggiata: ${nomeEtichetta}`,
    );
  }
  for (const nomeEtichetta of ['SMART TV cb O CONSOLE cb', 'ADD ON CHIAMATE CB', 'GIGA FAMILY IN CB', 'VODAFONE CARE']) {
    assert.equal(
      countVfUpsellingVolumes({}, { pista: 'PISTA CB', categoria: 'X', tipologia: 'Y', nomeEtichetta }),
      0,
      `offerta fuori allowlist conteggiata: ${nomeEtichetta}`,
    );
  }
});

test('Upselling VF: più voci sulla stessa offerta contano separatamente, i duplicati no', () => {
  const article = {
    dettaglio: {
      domandeRisposte: [
        { domanda: 'KASKO SMARTPHONE FACILE CB', risposta: 'SI' },
        { domanda: 'trade in cb', risposta: 'SI' },
        { domanda: 'forward trade in', risposta: 'SI' },
        { domanda: 'KASKO SMARTPHONE FACILE CB', risposta: 'SI' },
      ],
    },
  };
  assert.equal(countVfUpsellingVolumes(article), 3);
  assert.equal(
    countVfUpsellingVolumes(
      { dettaglio: { domandeRisposte: [{ domanda: 'trade in cb', risposta: 'SI' }] } },
      { pista: 'PISTA CB', categoria: 'X', tipologia: 'Y', nomeEtichetta: 'TRADE IN' },
    ),
    1,
  );
});

test('Upselling VF: vendita base conserva la propria pista e aggiunge i volumi Upselling', () => {
  const index = buildCanvassIndex(CANVASS_CATALOG.offers);
  const sc = classifySaleArticles({
    articoli: [{
      codice: 'CANOHEWD2208',
      categoria: { nome: 'OFFERTE VOCE' },
      tipologia: { nome: 'OFFERTE VOCE WALLET PAY' },
      dettaglio: {
        prezzo: 10,
        domandeRisposte: [
          { domanda: 'RETE SICURA 2.0', risposta: 'SI' },
          { domanda: 'VODAFONE CLUB GA', risposta: 'SI' },
        ],
      },
    }],
  }, index);
  assert.deepEqual(sc.countByPista, { mobile: 1, cb: 2 });
});

test('Upselling VF: una regola KPI cb troppo ampia non aggira la allowlist', () => {
  const index = buildCanvassIndex(CANVASS_CATALOG.offers);
  const rules = [{ id: 'cb-all', target: 'cb', conditions: { categoria: 'OFFERTE VOCE' }, enabled: true }];
  const excluded = classifySaleArticles({
    articoli: [{
      codice: 'CANOHEWD2208',
      categoria: { nome: 'OFFERTE VOCE' },
      dettaglio: { domandeRisposte: [{ domanda: 'GIGA FAMILY IN CB', risposta: 'SI' }] },
    }],
  }, index, rules);
  assert.equal(excluded.countByPista.cb, undefined);

  const allowed = classifySaleArticles({
    articoli: [{
      codice: 'CANOHEWD2208',
      categoria: { nome: 'OFFERTE VOCE' },
      dettaglio: { domandeRisposte: [{ domanda: 'RETE SICURA 2.0', risposta: 'SI' }] },
    }],
  }, index, rules);
  assert.equal(allowed.countByPista.cb, 1);
});

test('Upselling VF: una regola KPI escludi sopprime anche segnali ammessi', () => {
  const index = buildCanvassIndex(CANVASS_CATALOG.offers);
  const rules = [{ id: 'exclude', target: 'escludi', conditions: { categoria: 'OFFERTE VOCE' }, enabled: true }];
  const sc = classifySaleArticles({
    articoli: [{
      codice: 'CANOHEWD2208',
      categoria: { nome: 'OFFERTE VOCE' },
      dettaglio: { domandeRisposte: [{ domanda: 'RETE SICURA 2.0', risposta: 'SI' }] },
    }],
  }, index, rules);
  assert.deepEqual(sc.countByPista, {});
});

test('Upselling VF: i change order accettano solo le etichette esatte', () => {
  const match = (nomeEtichetta) => ({ pista: 'PISTA CB', categoria: 'X', tipologia: 'Y', nomeEtichetta });
  assert.equal(countVfUpsellingVolumes({}, match('CHANGE ORDER FASTWEB IN UPGRADE (MOBILE PRO)')), 1);
  assert.equal(countVfUpsellingVolumes({}, match('CHANGE ORDER FASTWEB IN UPGRADE (MOBILE PRO EXTRA)')), 0);
  assert.equal(countVfUpsellingVolumes({}, match('CHANGE ORDER FASTWEB IN UPGRADE (MOBILE START TEST)')), 0);
});

// === Regole KPI configurabili (canvassKpiRules) ===

const {
  matchesCanvassKpiRule,
  resolveCanvassKpiTarget,
  sanitizeCanvassKpiRules,
} = await import('../shared/canvassKpiRules.ts');
const { getPistaCanvassLabels, PISTA_CANVASS_LABELS_VF } =
  await import('../shared/bisuiteClassification.ts');

const artVerisure = {
  codice: 'XYZ',
  categoria: { nome: 'SICUREZZA' },
  tipologia: { nome: 'LEAD VERISURE' },
  descrizione: 'Appuntamento Verisure casa',
  dettaglio: { domandeRisposte: [{ domandaTesto: 'Interessato a Verisure?', risposta: 'SI' }] },
};

test('KPI rules: match contiene case-insensitive su tutte le condizioni compilate', () => {
  const rule = {
    id: 'r1',
    target: 'protecta',
    conditions: { categoria: 'sicurezza', descrizione: 'verisure' },
    enabled: true,
  };
  assert.equal(matchesCanvassKpiRule(artVerisure, rule), true);
  assert.equal(
    matchesCanvassKpiRule({ ...artVerisure, descrizione: 'altro' }, rule),
    false,
  );
});

test('KPI rules: domanda+risposta matchano su domandeRisposte', () => {
  const rule = {
    id: 'r2',
    target: 'protecta',
    conditions: { domanda: 'verisure', risposta: 'si' },
    enabled: true,
  };
  assert.equal(matchesCanvassKpiRule(artVerisure, rule), true);
  const ruleNo = { ...rule, conditions: { domanda: 'verisure', risposta: 'no' } };
  assert.equal(matchesCanvassKpiRule(artVerisure, ruleNo), false);
});

test('KPI rules: regola senza condizioni non matcha mai', () => {
  const rule = { id: 'r3', target: 'escludi', conditions: {}, enabled: true };
  assert.equal(matchesCanvassKpiRule(artVerisure, rule), false);
  assert.equal(resolveCanvassKpiTarget(artVerisure, [rule]), undefined);
});

test('KPI rules: prima regola abilitata che matcha vince; disabled saltate', () => {
  const rules = [
    { id: 'a', target: 'energia', conditions: { categoria: 'sicurezza' }, enabled: false },
    { id: 'b', target: 'protecta', conditions: { categoria: 'sicurezza' }, enabled: true },
    { id: 'c', target: 'escludi', conditions: { categoria: 'sicurezza' }, enabled: true },
  ];
  assert.equal(resolveCanvassKpiTarget(artVerisure, rules), 'protecta');
});

test('KPI rules: classifyArticle applica le regole solo con canvassIndex', () => {
  const index = buildCanvassIndex(CANVASS_CATALOG.offers);
  const rules = [
    { id: 'r', target: 'protecta', conditions: { descrizione: 'verisure' }, enabled: true },
  ];
  const cls = classifyArticle(artVerisure, index, rules);
  assert.deepEqual(cls, { type: 'canvass', pista: 'protecta' });
  // Senza canvassIndex (org non-VF) le regole NON si applicano.
  const clsNoIndex = classifyArticle(artVerisure, null, rules);
  assert.notEqual(clsNoIndex?.pista, 'protecta');
});

test('KPI rules: target escludi toglie la pista ma mantiene il tipo', () => {
  const index = buildCanvassIndex(CANVASS_CATALOG.offers);
  const rules = [
    { id: 'r', target: 'escludi', conditions: { descrizione: 'verisure' }, enabled: true },
  ];
  const cls = classifyArticle(artVerisure, index, rules);
  assert.equal(cls?.pista ?? undefined, undefined);
  // articolo che matcha il listino per codice, escluso dalla pista ma resta canvass
  const artListino = { codice: 'CANOHEWD2208', categoria: { nome: 'OFFERTE VOCE' }, descrizione: 'offerta verisure test' };
  const cls2 = classifyArticle(artListino, index, rules);
  assert.equal(cls2?.type, 'canvass');
  assert.equal(cls2?.pista, undefined);
});

test('KPI rules: regola che override la pista del listino', () => {
  const index = buildCanvassIndex(CANVASS_CATALOG.offers);
  const rules = [
    { id: 'r', target: 'energia', conditions: { categoria: 'OFFERTE VOCE' }, enabled: true },
  ];
  const cls = classifyArticle({ codice: 'CANOHEWD2208', categoria: { nome: 'OFFERTE VOCE' } }, index, rules);
  assert.deepEqual(cls, { type: 'canvass', pista: 'energia' });
});

test('KPI rules: condizione codice matcha contiene case-insensitive', () => {
  const rule = { id: 'rc', target: 'protecta', conditions: { codice: 'xyz' }, enabled: true };
  assert.equal(matchesCanvassKpiRule(artVerisure, rule), true);
  assert.equal(matchesCanvassKpiRule({ ...artVerisure, codice: 'ABC' }, rule), false);
  const index = buildCanvassIndex(CANVASS_CATALOG.offers);
  const rules = [{ id: 'rc2', target: 'escludi', conditions: { codice: 'CANOHEWD2208' }, enabled: true }];
  const cls = classifyArticle({ codice: 'CANOHEWD2208', categoria: { nome: 'OFFERTE VOCE' } }, index, rules);
  assert.equal(cls?.type, 'canvass');
  assert.equal(cls?.pista, undefined);
});

test('sanitizeCanvassKpiRules: scarta target invalidi e forme rotte', () => {
  const out = sanitizeCanvassKpiRules([
    { id: 'ok', target: 'protecta', conditions: { categoria: 'X' }, enabled: true },
    { id: 'bad', target: 'nope', conditions: {}, enabled: true },
    'stringa',
    null,
    { target: 'escludi', conditions: { categoria: 42 }, enabled: 'yes' },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, 'ok');
  assert.equal(out[1].target, 'escludi');
  assert.equal(out[1].conditions.categoria, undefined);
  assert.equal(out[1].enabled, true);
  assert.deepEqual(sanitizeCanvassKpiRules('junk'), []);
});

test('label piste VF: protecta → Verisure solo per org VF', () => {
  assert.equal(PISTA_CANVASS_LABELS_VF.protecta, 'Verisure');
  assert.equal(getPistaCanvassLabels(true).protecta, 'Verisure');
  assert.equal(getPistaCanvassLabels(false).protecta, 'Windtre Protetti');
  assert.equal(getPistaCanvassLabels(true).mobile, 'Mobile');
});

// ===========================================================================
// Task #527 — sottopiste Vodafone/Fastweb: Luce, Gas, IVA Mobile,
// IVA Wireline e VAS. Risoluzione FINE dal match listino
// (pista + categoria + tipologia), fail-closed, e conteggi aggregati
// senza doppi conteggi in aggregateMappedSales.
// ===========================================================================

// (classifyArticle è già importato sopra dalla stessa suite.)
const {
  pistaFromCanvassMatch,
  VF_COUNT_ONLY_PISTAS,
} = await import('../shared/bisuiteClassification.ts');
const { aggregateMappedSales } = await import('../server/bisuiteMappedSales.ts');

test('pistaFromCanvassMatch: IVA VOCE → iva_mobile', () => {
  assert.equal(pistaFromCanvassMatch({ pista: 'PISTA IVA', categoria: 'IVA VOCE', tipologia: 'RED START' }), 'iva_mobile');
});

test('pistaFromCanvassMatch: IVA RETE FISSA → iva_wireline', () => {
  assert.equal(pistaFromCanvassMatch({ pista: 'PISTA IVA', categoria: 'IVA RETE FISSA', tipologia: 'INTERNET UNLIMITED' }), 'iva_wireline');
});

test('pistaFromCanvassMatch: Soluzioni Digitali ed Easy Rent → vas', () => {
  assert.equal(pistaFromCanvassMatch({ pista: 'PISTA IVA', categoria: 'SOLUZIONI - M2M - EASY RENT', tipologia: 'SOLUZIONI DIGITALI' }), 'vas');
  assert.equal(pistaFromCanvassMatch({ pista: 'PISTA IVA', categoria: 'SOLUZIONI - M2M - EASY RENT', tipologia: 'EASY RENT' }), 'vas');
});

test('pistaFromCanvassMatch: Energia Fastweb Luce/Gas → luce/gas', () => {
  assert.equal(pistaFromCanvassMatch({ pista: 'ENERGIA FASTWEB', categoria: 'ENERGIA', tipologia: 'LUCE FASTWEB' }), 'luce');
  assert.equal(pistaFromCanvassMatch({ pista: 'ENERGIA FASTWEB', categoria: 'ENERGIA', tipologia: 'FASTWEB GAS' }), 'gas');
});

test('pistaFromCanvassMatch: combinazioni non riconosciute restano generiche (fail-closed)', () => {
  // IVA con categoria sconosciuta: NON attribuita a una sottopista.
  assert.equal(pistaFromCanvassMatch({ pista: 'PISTA IVA', categoria: 'ALTRO BUSINESS', tipologia: 'X' }), 'iva');
  // Energia senza tipologia luce/gas: pista energia generica.
  assert.equal(pistaFromCanvassMatch({ pista: 'ENERGIA FASTWEB', categoria: 'ENERGIA', tipologia: '' }), 'energia');
  // Piste non-IVA/energia: invariato.
  assert.equal(pistaFromCanvassMatch({ pista: 'PISTA MOBILE', categoria: 'CONSUMER', tipologia: 'FAMILY' }), 'mobile');
});

test('VF_COUNT_ONLY_PISTAS contiene esattamente le 5 sottopiste', () => {
  assert.deepEqual([...VF_COUNT_ONLY_PISTAS].sort(), ['gas', 'iva_mobile', 'iva_wireline', 'luce', 'vas'].sort());
});

// --- classifyArticle con indice sintetico --------------------------------

const vfOffers = [
  { codice: 'CANAAAAA1111', offerId: 'AAAAA', nomeEtichetta: 'IVA Voce Start', pista: 'PISTA IVA', categoria: 'IVA VOCE', tipologia: 'RED START', canone: 10, brand: 'vodafone' },
  { codice: 'CANBBBBB1111', offerId: 'BBBBB', nomeEtichetta: 'IVA Rete Fissa', pista: 'PISTA IVA', categoria: 'IVA RETE FISSA', tipologia: 'INTERNET', canone: 20, brand: 'vodafone' },
  { codice: 'CANCCCCC1111', offerId: 'CCCCC', nomeEtichetta: 'Soluzioni Digitali', pista: 'PISTA IVA', categoria: 'SOLUZIONI - M2M - EASY RENT', tipologia: 'SOLUZIONI DIGITALI', canone: 5, brand: 'vodafone' },
  { codice: 'CANDDDDD1111', offerId: 'DDDDD', nomeEtichetta: 'Luce Fastweb', pista: 'ENERGIA FASTWEB', categoria: 'ENERGIA', tipologia: 'LUCE FASTWEB', canone: 0, brand: 'fastweb' },
  { codice: 'CANEEEEE1111', offerId: 'EEEEE', nomeEtichetta: 'Gas Fastweb', pista: 'ENERGIA FASTWEB', categoria: 'ENERGIA', tipologia: 'FASTWEB GAS', canone: 0, brand: 'fastweb' },
];
const vfIndex = buildCanvassIndex(vfOffers);

const artOf = (codice, categoria = 'CANVASS', tipologia = '') => ({
  codice,
  categoria: { nome: categoria },
  tipologia: { nome: tipologia },
  descrizione: codice,
  dettaglio: { canone: '0' },
});

test('classifyArticle: match listino → sottopista fine', () => {
  assert.equal(classifyArticle(artOf('CANAAAAA1111'), vfIndex).pista, 'iva_mobile');
  assert.equal(classifyArticle(artOf('CANBBBBB1111'), vfIndex).pista, 'iva_wireline');
  assert.equal(classifyArticle(artOf('CANCCCCC1111'), vfIndex).pista, 'vas');
  assert.equal(classifyArticle(artOf('CANDDDDD1111'), vfIndex).pista, 'luce');
  assert.equal(classifyArticle(artOf('CANEEEEE1111'), vfIndex).pista, 'gas');
});

test('classifyArticle: regola KPI per-org vince sulla classificazione automatica', () => {
  const rules = [{ id: 'r1', enabled: true, conditions: { descrizione: 'CANAAAAA1111' }, target: 'vas' }];
  const cls = classifyArticle(artOf('CANAAAAA1111'), vfIndex, rules);
  assert.equal(cls.pista, 'vas');
});

// --- aggregateMappedSales: conteggi per pista canvass ----------------------

function saleWith(articoli, codicePos = 'POS1') {
  return {
    dataVendita: new Date('2026-08-10T10:00:00Z'),
    totale: '0',
    codicePos,
    nomeNegozio: 'Negozio 1',
    ragioneSociale: 'RS Test',
    rawData: { articoli, cliente: { clienteTipo: 'PRIVATO' } },
  };
}

test('aggregateMappedSales: totaliPistaCanvass solo con canvassIndex', () => {
  const sales = [saleWith([artOf('CANAAAAA1111'), artOf('CANDDDDD1111')])];
  const senza = aggregateMappedSales(sales, []);
  assert.equal(senza.totaliPistaCanvass, undefined);
  const con = aggregateMappedSales(sales, [], { canvassIndex: vfIndex });
  assert.deepEqual(con.totaliPistaCanvass, { iva_mobile: 1, luce: 1 });
});

test('aggregateMappedSales: le piste base non si duplicano', () => {
  const sales = [
    saleWith([artOf('CANDDDDD1111'), artOf('CANEEEEE1111'), artOf('CANEEEEE1111')]),
    saleWith([artOf('CANBBBBB1111'), artOf('CANCCCCC1111')], 'POS2'),
  ];
  const agg = aggregateMappedSales(sales, [], { canvassIndex: vfIndex });
  assert.deepEqual(agg.totaliPistaCanvass, { luce: 1, gas: 2, iva_wireline: 1, vas: 1 });
  const totale = Object.values(agg.totaliPistaCanvass).reduce((s, n) => s + n, 0);
  assert.equal(totale, 5); // = numero articoli canvass classificati
  // Per-PDV: i bucket rispettano il PDV di origine.
  const pos1 = agg.pdvList.find((p) => p.codicePos === 'POS1');
  const pos2 = agg.pdvList.find((p) => p.codicePos === 'POS2');
  assert.deepEqual(pos1.countByPistaCanvass, { luce: 1, gas: 2 });
  assert.deepEqual(pos2.countByPistaCanvass, { iva_wireline: 1, vas: 1 });
});

test('aggregateMappedSales: segnali Upselling su prodotti e regola escludi restano in parità', () => {
  const prodotto = {
    codice: 'ACC1',
    categoria: { nome: 'ACCESSORI' },
    tipologia: { nome: 'ACCESSORI' },
    descrizione: 'Accessorio',
    dettaglio: {
      prezzo: '10',
      domandeRisposte: [
        { domanda: 'KASKO SMARTPHONE FACILE CB', risposta: 'SI' },
        { domanda: 'trade in cb', risposta: 'SI' },
      ],
    },
  };
  const counted = aggregateMappedSales([saleWith([prodotto])], [], { canvassIndex: vfIndex });
  assert.deepEqual(counted.totaliPistaCanvass, { cb: 2 });

  const excluded = aggregateMappedSales([saleWith([prodotto])], [], {
    canvassIndex: vfIndex,
    canvassKpiRules: [{ id: 'exclude', target: 'escludi', conditions: { categoria: 'ACCESSORI' }, enabled: true }],
  });
  assert.deepEqual(excluded.totaliPistaCanvass, {});
});
