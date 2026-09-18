import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const {
  classifySaleArticles,
  isAssicurazioneImpiantoOk,
} = await import('../shared/bisuiteClassification.ts');
const { aggregateDailyReport } = await import('../shared/venditeReport.ts');
const { aggregateMappedSales } = await import('../server/bisuiteMappedSales.ts');
const { getDefaultMappingRules, mergeWithDefaultRules } = await import('../shared/bisuiteMapping.ts');

function articolo(descrizione) {
  return {
    categoria: { nome: 'ASSICURAZIONI' },
    tipologia: { nome: 'ASSICURAZIONI LUCE E GAS' },
    descrizione,
    dettaglio: { prezzo: '12.50', scontrino: 1 },
  };
}

test('Impianto OK è riconosciuto solo dalla combinazione BiSuite reale', () => {
  assert.equal(isAssicurazioneImpiantoOk('ASSICURAZIONI', 'ASSICURAZIONI LUCE E GAS', 'IMPIANTO OK LUCE'), true);
  assert.equal(isAssicurazioneImpiantoOk('ASSICURAZIONI', 'ASSICURAZIONI LUCE E GAS', 'IMPIANTO OK GAS'), true);
  assert.equal(isAssicurazioneImpiantoOk('ASSICURAZIONI', 'ALTRO', 'IMPIANTO OK LUCE'), false);
  assert.equal(isAssicurazioneImpiantoOk('ALLARME', 'IMPIANTO ALLARME', 'LEAD GENERATION'), false);
});

test('Vendite e Telegram contano Impianto OK a parte, non nelle Assicurazioni', () => {
  const rawData = { articoli: [articolo('IMPIANTO OK LUCE'), articolo('CASA OK')] };
  const classified = classifySaleArticles(rawData);
  assert.equal(classified.impiantoOk.pezzi, 1);
  assert.equal(classified.countByPista.assicurazioni, 1);
  assert.equal(classified.articles[0].impiantoOk, true);
  assert.equal(classified.articles[0].pista, undefined);

  const report = aggregateDailyReport([{
    stato: 'FINALIZZATA IN CASSA',
    totale: '25.00',
    codicePos: 'P1',
    nomeNegozio: 'Negozio',
    rawData,
  }]);
  assert.equal(report.impiantoOk.pezzi, 1);
  assert.equal(report.impiantoOk.importo, 12.5);
  assert.deepEqual(report.impiantoOk.byCategoria.map((x) => x.categoria), ['IMPIANTO OK LUCE']);
  assert.equal(report.countByPista.assicurazioni, 1);
  assert.equal(report.assicurazioniDettaglio.length, 1);
});

test('Dashboard riceve Impianto OK come gettone separato e senza punti Assicurazioni', () => {
  const rawData = { cliente: { clienteTipo: 'PRIVATO' }, articoli: [articolo('IMPIANTO OK GAS')] };
  const mapped = aggregateMappedSales([{
    bisuiteId: 1,
    dataVendita: '2026-09-18',
    totale: '12.50',
    codicePos: 'P1',
    nomeNegozio: 'Negozio',
    ragioneSociale: 'RS',
    rawData,
  }], mergeWithDefaultRules(getDefaultMappingRules()));

  assert.equal(mapped.pdvList[0].items.length, 1);
  assert.deepEqual(
    mapped.pdvList[0].items[0],
    {
      pista: 'assicurazioni',
      targetCategory: 'impianto_ok',
      targetLabel: 'Impianto OK',
      pezzi: 1,
      canone: 0,
      ruleType: 'base',
    },
  );

  const dashboard = fs.readFileSync(new URL('../client/src/pages/DashboardGaraReale.tsx', import.meta.url), 'utf8');
  assert.match(dashboard, /isGettoneExtraItem\(pista, cat\.targetCategory\)/);
  assert.match(dashboard, /card-impianto-ok/);
});
