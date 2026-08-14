import { test } from 'node:test';
import assert from 'node:assert/strict';

// Test suite "Pezzi IVA per pista canvass" (Task #377).
//
// Verifica la regola condivisa `isPezzoIva` (shared/bisuiteClassification.ts):
//   - MOBILE: solo categoria TIED IVA (TIED CF / UNTIED = no);
//   - FISSO: ADSL/FIBRA/FWA IVA (la variante CF = no);
//   - ENERGIA: descrizione contenente BUSINESS (coerente con
//     energiaClienteFromDescrizione in shared/venditeReport.ts);
//   - PROTETTI: descrizione BUSINESS;
//   - ASSICURAZIONI: solo ASSICURAZIONI BUSINESS PRO;
//   - CB: mai; pista P.IVA (listino VF): sempre.
// Più la coerenza col classificatore: classificando una vendita BiSuite grezza,
// i pezzi IVA contati sugli articoli classificati tornano con le attese.
//
// Logica pura: nessun dev server né DB, moduli TS caricati via loader tsx.

const { isPezzoIva, classifySaleArticles } = await import('../shared/bisuiteClassification.ts');
const { energiaClienteFromDescrizione } = await import('../shared/venditeReport.ts');

test('mobile: TIED IVA è pezzo IVA, TIED CF/UNTIED no', () => {
  assert.equal(isPezzoIva({ pista: 'mobile', categoriaNome: 'TIED IVA', descrizione: 'PROFESSIONAL WORLD' }), true);
  assert.equal(isPezzoIva({ pista: 'mobile', categoriaNome: 'tied iva ', descrizione: '' }), true);
  assert.equal(isPezzoIva({ pista: 'mobile', categoriaNome: 'TIED CF', descrizione: 'DI PIU FULL 5G' }), false);
  assert.equal(isPezzoIva({ pista: 'mobile', categoriaNome: 'UNTIED', descrizione: '' }), false);
});

test('fisso: ADSL/FIBRA/FWA IVA sì, variante CF no', () => {
  assert.equal(isPezzoIva({ pista: 'fisso', categoriaNome: 'ADSL/FIBRA/FWA IVA', descrizione: 'SUPER FIBRA PRO' }), true);
  assert.equal(isPezzoIva({ pista: 'fisso', categoriaNome: 'ADSL/FIBRA/FWA CF', descrizione: 'SUPER FIBRA' }), false);
  assert.equal(isPezzoIva({ pista: 'fisso', categoriaNome: 'FISSO VOCE', descrizione: 'FISSO VOCE' }), false);
  // Match anche via descrizione quando la categoria non è la variante IVA.
  assert.equal(isPezzoIva({ pista: 'fisso', categoriaNome: 'ALTRO', descrizione: 'ADSL/FIBRA/FWA IVA PROMO' }), true);
});

test('energia: business dalla descrizione, coerente con venditeReport', () => {
  const business = 'ENERGIA W3 LUCE MICROBUSINESS';
  const privato = 'ENERGIA W3 LUCE CASA';
  assert.equal(isPezzoIva({ pista: 'energia', categoriaNome: 'ENERGIA W3', descrizione: business }), true);
  assert.equal(isPezzoIva({ pista: 'energia', categoriaNome: 'ENERGIA W3', descrizione: privato }), false);
  // Parità con la regola già usata nel report vendite.
  assert.equal(energiaClienteFromDescrizione(business), 'business');
  assert.equal(energiaClienteFromDescrizione(privato), 'privato');
});

test('protetti: descrizione BUSINESS', () => {
  assert.equal(isPezzoIva({ pista: 'protecta', categoriaNome: 'ALLARMI', descrizione: 'PROTEZIONE24 BUSINESS' }), true);
  assert.equal(isPezzoIva({ pista: 'protecta', categoriaNome: 'ALLARMI', descrizione: 'PROTEZIONE24 CASA' }), false);
});

test('assicurazioni: solo BUSINESS PRO', () => {
  assert.equal(isPezzoIva({ pista: 'assicurazioni', categoriaNome: 'ASSICURAZIONI BUSINESS PRO', descrizione: 'POLIZZA PRO' }), true);
  assert.equal(isPezzoIva({ pista: 'assicurazioni', categoriaNome: 'ASSICURAZIONI', descrizione: 'RC AUTO' }), false);
  assert.equal(isPezzoIva({ pista: 'assicurazioni', categoriaNome: 'WINDTRE SECURITY PRO GA', descrizione: '' }), false);
});

test('cb mai IVA; pista P.IVA sempre; senza pista mai', () => {
  assert.equal(isPezzoIva({ pista: 'cb', categoriaNome: 'MIA TIED', descrizione: 'BUSINESS' }), false);
  assert.equal(isPezzoIva({ pista: 'iva', categoriaNome: 'QUALSIASI', descrizione: '' }), true);
  assert.equal(isPezzoIva({ categoriaNome: 'TIED IVA', descrizione: '' }), false);
});

test('coerenza col classificatore: pezzi IVA su vendita BiSuite grezza', () => {
  const rawData = {
    articoli: [
      { categoria: { nome: 'TIED IVA' }, tipologia: { nome: 'VOCE IVA' }, descrizione: 'PROFESSIONAL WORLD', dettaglio: { prezzo: '10' } },
      { categoria: { nome: 'TIED CF' }, tipologia: { nome: 'VOCE CF' }, descrizione: 'DI PIU FULL', dettaglio: { prezzo: '10' } },
      { categoria: { nome: 'ADSL/FIBRA/FWA IVA' }, tipologia: { nome: '' }, descrizione: 'SUPER FIBRA PRO', dettaglio: { prezzo: '0' } },
      { categoria: { nome: 'ENERGIA W3' }, tipologia: { nome: '' }, descrizione: 'LUCE MICROBUSINESS', dettaglio: { prezzo: '0' } },
      { categoria: { nome: 'ASSICURAZIONI BUSINESS PRO' }, tipologia: { nome: '' }, descrizione: 'POLIZZA PRO', dettaglio: { prezzo: '5' } },
      { categoria: { nome: 'ASSICURAZIONI' }, tipologia: { nome: '' }, descrizione: 'RC AUTO', dettaglio: { prezzo: '5' } },
      { categoria: { nome: 'RIVINCOLO' }, tipologia: { nome: '' }, descrizione: 'BUSINESS RIVINCOLO', dettaglio: { prezzo: '0' } },
    ],
  };
  const sc = classifySaleArticles(rawData);
  const ivaByPista = {};
  for (const art of sc.articles) {
    if (art.pista && isPezzoIva(art)) ivaByPista[art.pista] = (ivaByPista[art.pista] || 0) + 1;
  }
  assert.deepEqual(ivaByPista, { mobile: 1, fisso: 1, energia: 1, assicurazioni: 1 });
  // I pezzi pista totali restano invariati (regole classificazione intatte).
  assert.equal(sc.countByPista.mobile, 2);
  assert.equal(sc.countByPista.cb, 1);
});
