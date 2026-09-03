// Task #398 — test della logica pura dei contatori extra della Tabella
// PDV × Pista (Pezzi) di Vendite BiSuite (shared/pdvPezziExtra.ts):
// IVA (isPezzoIva), CB (solo cambi piano: pista 'cb', quindi MIA TIED/UNTIED
// non Coupon Caring + RIVINCOLO), Telefoni (categoria TELEFONIA) e importi
// Accessori/Servizi netto IVA (÷1.22, imponibile con fallback prezzo).
// Verifica anche la coerenza con classifySaleArticles (pipeline reale della
// pagina Vendite BiSuite).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  accumulaPezziExtra,
  emptyPezziExtra,
  sommaPezziExtra,
  nettoIva,
  IVA_RATE,
} from '../shared/pdvPezziExtra.ts';
import { classifySaleArticles } from '../shared/bisuiteClassification.ts';
import { derivePdvDrilldownMetrics } from '../shared/pdvDrilldownMetrics.ts';

const approx = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} != ${b}`);

test('IVA: pezzi P.IVA per categoria di origine via isPezzoIva', () => {
  const c = emptyPezziExtra();
  accumulaPezziExtra(c, { pista: 'mobile', categoriaNome: 'TIED IVA' });
  accumulaPezziExtra(c, { pista: 'mobile', categoriaNome: 'TIED CF' });
  // La pista post-regole è ignorata: conta la categoria BiSuite di origine.
  accumulaPezziExtra(c, { pista: 'fisso', categoriaNome: 'TIED IVA' });
  accumulaPezziExtra(c, { pista: 'energia', categoriaNome: 'ENERGIA W3', descrizione: 'OFFERTA MICROBUSINESS LUCE' });
  accumulaPezziExtra(c, { pista: 'assicurazioni', categoriaNome: 'ASSICURAZIONI BUSINESS PRO' });
  accumulaPezziExtra(c, { pista: 'assicurazioni', categoriaNome: 'ASSICURAZIONI' });
  assert.equal(c.iva, 4);
});

test('drill-down: categorie per Mobile/Fisso/CB, tipologie Assicurazioni e Business solo Energia/Protetti', () => {
  const result = derivePdvDrilldownMetrics({
    articoli: [
      { categoria: { nome: 'TIED IVA' }, descrizione: 'Professional World' },
      { categoria: { nome: 'ADSL/FIBRA/FWA IVA' }, descrizione: 'FIBRA IVA' },
      { categoria: { nome: 'ENERGIA W3' }, descrizione: 'OFFERTA MICROBUSINESS' },
      { categoria: { nome: 'ALLARMI' }, descrizione: 'PROTECTA BUSINESS' },
      { categoria: { nome: 'ASSICURAZIONI BUSINESS PRO' }, tipologia: { nome: 'PROTEZIONE BUSINESS' }, descrizione: 'PRO' },
      { categoria: { nome: 'MIA TIED' }, descrizione: 'BUSINESS' },
      { categoria: { nome: 'ACCESSORI' }, descrizione: 'Cover' },
      { categoria: { nome: 'SPEDIZIONE' }, descrizione: 'Consegna' },
      { categoria: { nome: 'TELEFONIA' }, descrizione: 'Phone' },
    ],
  });
  assert.deepEqual(result.breakdowns, [
    { pista: 'mobile', label: 'TIED IVA', value: 1 },
    { pista: 'fisso', label: 'ADSL/FIBRA/FWA IVA', value: 1 },
    { pista: 'assicurazioni', label: 'PROTEZIONE BUSINESS', value: 1 },
    { pista: 'cb', label: 'MIA TIED', value: 1 },
  ]);
  assert.deepEqual(result.businessByPista, { energia: 1, protecta: 1 });
});

test('drill-down: telefoni separati tra finanziato/VAR e GA/CB', () => {
  const result = derivePdvDrilldownMetrics({
    articoli: [
      {
        categoria: { nome: 'TIED CF' },
        dettaglio: { domandeRisposte: [{ domanda: 'TELEFONO INCLUSO COMPASS', risposta: 'SI' }] },
      },
      {
        categoria: { nome: 'TIED IVA' },
        dettaglio: { domandeRisposte: [{ domanda: 'TELEFONO INCLUSO VAR', risposta: 'SI' }] },
      },
      {
        categoria: { nome: 'MIA TIED' },
        dettaglio: { domandeRisposte: [{ domanda: 'MIA TELEFONO FINANZIAMENTO', risposta: '0' }] },
      },
      {
        categoria: { nome: 'MIA UNTIED' },
        dettaglio: { domandeRisposte: [{ domanda: 'MIA TELEFONO VAR', risposta: '24' }] },
      },
    ],
  });
  assert.deepEqual(result.telefoni, {
    'telefono:finanziato-ga': 1,
    'telefono:finanziato-cb': 1,
    'telefono:var-ga': 1,
    'telefono:var-cb': 1,
  });
});

test('drill-down: domanda sul prodotto TELEFONIA eredita il solo canale della vendita', () => {
  const result = derivePdvDrilldownMetrics({
    articoli: [
      { categoria: { nome: 'TIED CF' } },
      {
        categoria: { nome: 'TELEFONIA' },
        dettaglio: { domandeRisposte: [{ domanda: 'TELEFONO INCLUSO FINDOMESTIC', risposta: 'SI' }] },
      },
    ],
  });
  assert.equal(result.telefoni['telefono:finanziato-ga'], 1);
  assert.equal(result.telefoni['telefono:finanziato-cb'], 0);
});

test('drill-down: domande standard nel Fisso W3 sono GA, domande MIA sono CB', () => {
  const result = derivePdvDrilldownMetrics({
    articoli: [
      {
        categoria: { nome: 'ADSL/FIBRA/FWA CF' },
        dettaglio: { domandeRisposte: [
          { domanda: 'TELEFONO INCLUSO COMPASS', risposta: 'SI' },
          { domanda: 'TELEFONO INCLUSO VAR', risposta: 'SI' },
        ] },
      },
      {
        categoria: { nome: 'MIA TIED' },
        dettaglio: { domandeRisposte: [
          { domanda: 'MIA TELEFONO FINANZIAMENTO', risposta: '12' },
          { domanda: 'MIA TELEFONO VAR', risposta: '0' },
        ] },
      },
    ],
  });
  assert.deepEqual(result.telefoni, {
    'telefono:finanziato-ga': 1,
    'telefono:finanziato-cb': 1,
    'telefono:var-ga': 1,
    'telefono:var-cb': 1,
  });
});

test('CB: conta solo le categorie cambio piano (MIA TIED/UNTIED + RIVINCOLO)', () => {
  const c = emptyPezziExtra();
  accumulaPezziExtra(c, { pista: 'cb', categoriaNome: 'MIA TIED' });
  accumulaPezziExtra(c, { pista: 'cb', categoriaNome: 'MIA UNTIED' });
  accumulaPezziExtra(c, { pista: 'cb', categoriaNome: 'RIVINCOLO' });
  // Coupon Caring: escluso via flag (arriva così da classifySaleArticles)...
  accumulaPezziExtra(c, { categoriaNome: 'MIA TIED', couponCaring: true });
  // ...o via tipologia quando il flag non è presente.
  accumulaPezziExtra(c, { categoriaNome: 'MIA UNTIED', tipologiaNome: 'COUPON CARING UNTIED' });
  assert.equal(c.cb, 3);
});

test('CB: per categoria di origine, non per pista post-regole (parità dashboard)', () => {
  const c = emptyPezziExtra();
  // Regola custom/listino VF che rimappa una categoria NON cambio-piano
  // sulla pista cb: NON deve contare come cambio piano.
  accumulaPezziExtra(c, { pista: 'cb', categoriaNome: 'TIED CF' });
  accumulaPezziExtra(c, { pista: 'cb', categoriaNome: 'ALTRI EVENTI CB' });
  assert.equal(c.cb, 0, 'categorie non cambio-piano rimappate su cb non contano');
  // Vero cambio piano rimappato su un'altra pista (o senza pista): conta.
  accumulaPezziExtra(c, { pista: 'mobile', categoriaNome: 'MIA TIED' });
  accumulaPezziExtra(c, { categoriaNome: 'RIVINCOLO' });
  assert.equal(c.cb, 2, 'MIA TIED/RIVINCOLO contano anche se la pista è rimappata');
});

test('Telefoni: categoria TELEFONIA', () => {
  const c = emptyPezziExtra();
  accumulaPezziExtra(c, { categoriaNome: 'TELEFONIA', prezzo: 199 });
  accumulaPezziExtra(c, { categoriaNome: 'telefonia ' });
  accumulaPezziExtra(c, { categoriaNome: 'SMART DEVICE' });
  assert.equal(c.telefoni, 2);
});

test('€ Accessori/Servizi: netto IVA, imponibile con fallback prezzo', () => {
  const c = emptyPezziExtra();
  accumulaPezziExtra(c, { categoriaNome: 'ACCESSORI', importoImponibile: 122 });
  accumulaPezziExtra(c, { categoriaNome: 'ACCESSORI', prezzo: 61 }); // fallback prezzo
  accumulaPezziExtra(c, { categoriaNome: 'SPEDIZIONE', importoImponibile: 12.2 });
  accumulaPezziExtra(c, { categoriaNome: 'ASSISTENZA', prezzo: 24.4 });
  accumulaPezziExtra(c, { categoriaNome: 'GARANTEASY', importoImponibile: 6.1 });
  // Categorie fuori perimetro: non contano.
  accumulaPezziExtra(c, { categoriaNome: 'RICARICHE', prezzo: 50 });
  approx(c.accEuro, nettoIva(122 + 61), 'accessori netto IVA');
  approx(c.srvEuro, nettoIva(12.2 + 24.4 + 6.1), 'servizi netto IVA');
  assert.equal(IVA_RATE, 1.22);
});

test('sommaPezziExtra: somma campo per campo', () => {
  const a = { iva: 1, cb: 2, telefoni: 3, accEuro: 10, srvEuro: 20 };
  const b = { iva: 4, cb: 5, telefoni: 6, accEuro: 1.5, srvEuro: 2.5 };
  sommaPezziExtra(a, b);
  assert.deepEqual(a, { iva: 5, cb: 7, telefoni: 9, accEuro: 11.5, srvEuro: 22.5 });
});

test('coerenza con classifySaleArticles (pipeline Vendite BiSuite)', () => {
  const rawData = {
    articoli: [
      { categoria: { nome: 'MIA TIED' }, tipologia: { nome: 'CAMBIO PIANO' }, descrizione: 'MIA 100', dettaglio: { prezzo: '0' } },
      { categoria: { nome: 'MIA TIED' }, tipologia: { nome: 'COUPON CARING TIED' }, descrizione: 'COUPON', dettaglio: { prezzo: '0' } },
      { categoria: { nome: 'RIVINCOLO' }, tipologia: { nome: 'RIVINCOLO' }, descrizione: 'RIV 24M', dettaglio: { prezzo: '0' } },
      { categoria: { nome: 'TIED IVA' }, tipologia: { nome: 'GA' }, descrizione: 'TIED BUSINESS', dettaglio: { prezzo: '10' } },
      { categoria: { nome: 'TELEFONIA' }, tipologia: { nome: 'SMARTPHONE' }, descrizione: 'PHONE X', dettaglio: { prezzo: '199', importoImponibile: '163.11' } },
      { categoria: { nome: 'ACCESSORI' }, tipologia: { nome: 'COVER' }, descrizione: 'COVER', dettaglio: { prezzo: '24.4', importoImponibile: '20' } },
      { categoria: { nome: 'SPEDIZIONE' }, tipologia: { nome: 'SPEDIZIONE' }, descrizione: 'SPEDIZIONE', dettaglio: { prezzo: '12.2' } },
    ],
  };
  const sc = classifySaleArticles(rawData);
  const c = emptyPezziExtra();
  for (const art of sc.articles) accumulaPezziExtra(c, art);
  assert.equal(c.cb, 2, 'CB = MIA TIED cambio piano + RIVINCOLO (coupon escluso)');
  assert.equal(c.iva, 1, 'IVA = TIED IVA');
  assert.equal(c.telefoni, 1, 'Telefoni = 1');
  // Accessori: usa importoImponibile (20) e non il prezzo lordo.
  approx(c.accEuro, nettoIva(20), 'accessori da imponibile');
  // Spedizione senza imponibile: fallback prezzo.
  approx(c.srvEuro, nettoIva(12.2), 'servizi fallback prezzo');
});
