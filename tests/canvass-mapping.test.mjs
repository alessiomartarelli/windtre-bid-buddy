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
  validateCanvassColumns,
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

test('validateCanvassColumns: ok con le colonne attese (Task #305)', () => {
  const listinoRows = [
    { CODICE: 'CANABCDE1111', 'NOME ETICHETTA': 'X', PISTA: 'PISTA MOBILE', CATEGORIA: 'MOBILE', TIPOLOGIA: 'RIC', CANONE: '9,99' },
  ];
  const stepRows = [
    { ID: '1', 'Pista Associata': 'PA', 'Pista FORM': 'PISTA MOBILE', Domanda: 'D1', Ordine: '1', ATTIVO: 'S', Brand: 'vodafone' },
  ];
  const v = validateCanvassColumns(listinoRows, stepRows);
  assert.equal(v.ok, true);
  assert.deepEqual(v.missingListino, []);
  assert.deepEqual(v.missingStep, []);
});

test('validateCanvassColumns: rileva colonne sbagliate/mancanti (Task #305)', () => {
  // File sbagliato per il listino (es. un export vendite qualsiasi).
  const wrongListino = [{ Cliente: 'Mario', Importo: 10 }];
  const wrongSteps = [{ Question: 'D1', Track: 'X' }];
  const v = validateCanvassColumns(wrongListino, wrongSteps);
  assert.equal(v.ok, false);
  assert.ok(v.missingListino.includes('CODICE'));
  assert.ok(v.missingListino.includes('PISTA'));
  assert.ok(v.missingStep.includes('Domanda'));
  assert.ok(v.missingStep.includes('Pista FORM'));
});

test('validateCanvassColumns: fogli vuoti = tutte le colonne mancanti (Task #305)', () => {
  const v = validateCanvassColumns([], []);
  assert.equal(v.ok, false);
  assert.equal(v.missingListino.length, 6);
  assert.equal(v.missingStep.length, 2);
});
