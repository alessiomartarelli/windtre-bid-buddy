import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  getDefaultMappingRules,
  mapBiSuiteArticle,
  mergeWithDefaultRules,
} = await import('../shared/bisuiteMapping.ts');
const {
  ASSICURAZIONI_POINTS,
  ASSICURAZIONI_PREMIUMS,
  createEmptyAssicurazioniAttivato,
} = await import('../client/src/types/assicurazioni.ts');
const {
  calcoloAssicurazioniPerPos,
  creaAttivatoAssicurazioniDaMappato,
} = await import('../client/src/lib/calcoloAssicurazioni.ts');
const {
  calcolaPremioAssicurazioniPerRS,
} = await import('../client/src/lib/calcoloAssicurazioniRS.ts');
const {
  aggregateMappedSales,
} = await import('../server/bisuiteMappedSales.ts');

const RULES = mergeWithDefaultRules(getDefaultMappingRules());

function articoloPagamentoAnnuale(categoria, risposta) {
  return {
    categoria: { nome: categoria },
    tipologia: {
      nome: categoria === 'ASSICURAZIONI' ? 'ASSICURAZIONI CASA' : 'ASSICURAZIONI BUSINESS PRO',
    },
    descrizione: categoria === 'ASSICURAZIONI' ? 'START' : 'PROTEZIONE PRO',
    dettaglio: {
      domandeRisposte: [
        { domandaTesto: 'PAGAMENTO ANNUALE', risposta },
      ],
    },
  };
}

function pagamentoAnnualeMappato(categoria, risposta) {
  return mapBiSuiteArticle(articoloPagamentoAnnuale(categoria, risposta), '', RULES)
    .filter((item) => item.pista === 'assicurazioni' && item.targetCategory === 'pagamentoAnnuale');
}

const CONFIG_DEFAULT = {
  pdvInGara: 1,
  targetNoMalus: 0,
  targetS1: 0.5,
  targetS2: 0.5,
};

test('mapping BiSuite: PAGAMENTO ANNUALE SI/NO per entrambe le categorie assicurative', () => {
  for (const categoria of ['ASSICURAZIONI', 'ASSICURAZIONI BUSINESS PRO']) {
    const si = pagamentoAnnualeMappato(categoria, 'SI');
    assert.equal(si.length, 1, `${categoria}: SI produce una sola voce pagamentoAnnuale`);
    assert.equal(si[0].ruleType, 'additional', `${categoria}: la voce resta additional`);

    const no = pagamentoAnnualeMappato(categoria, 'NO');
    assert.deepEqual(no, [], `${categoria}: NO non produce pagamentoAnnuale`);
  }
});

test('Dashboard Gara: l’addon Pagamento Annuale entra nei punti e nelle soglie S1/S2', () => {
  const paymentRules = RULES.filter((rule) => rule.targetCategory === 'pagamentoAnnuale');
  const mapped = aggregateMappedSales([{
    codicePos: 'POS-1',
    nomeNegozio: 'Negozio 1',
    ragioneSociale: 'RS Test',
    rawData: {
      cliente: { clienteTipo: 'PRIVATO' },
      articoli: [articoloPagamentoAnnuale('ASSICURAZIONI', 'SI')],
    },
  }], paymentRules);
  const mappedPdv = mapped.pdvList[0];
  const paymentAddon = mappedPdv.addons.find((addon) => addon.targetCategory === 'pagamentoAnnuale');
  assert.equal(paymentAddon?.occorrenze, 1, 'il mapping runtime espone Pagamento Annuale come addon');

  const attivato = creaAttivatoAssicurazioniDaMappato(mappedPdv.items, mappedPdv.addons);
  assert.ok(attivato, 'la voce additional della Dashboard deve diventare attivato assicurazioni');
  assert.equal(attivato.pagamentoAnnuale, 1);

  const [result] = calcoloAssicurazioniPerPos(
    [{ codicePos: 'POS-1', nome: 'Negozio 1' }],
    CONFIG_DEFAULT,
    [{ pdvId: 'POS-1', nome: 'Negozio 1', codicePos: 'POS-1', inGara: true }],
    { 'POS-1': attivato },
  );

  assert.equal(ASSICURAZIONI_POINTS.pagamentoAnnuale, 0.5);
  assert.equal(ASSICURAZIONI_PREMIUMS.pagamentoAnnuale, 0);
  assert.equal(result.puntiTotali, 0.5, 'un pezzo vale 0,5 punti');
  assert.equal(result.bonusSoglia1, 500, 'il mezzo punto raggiunge S1');
  assert.equal(result.bonusSoglia2, 750, 'il mezzo punto raggiunge S2');
  assert.equal(result.premioBase, 0, 'Pagamento Annuale non genera gettone');
  assert.deepEqual(result.dettaglioProdotti, [{
    prodotto: 'Pagamento Annuale',
    pezzi: 1,
    punti: 0.5,
    premio: 0,
  }]);
});

test('Dashboard Gara: l’override tabelle_calcolo sostituisce i punti ma non il gettone zero', () => {
  const attivato = createEmptyAssicurazioniAttivato();
  attivato.pagamentoAnnuale = 1;

  const [result] = calcoloAssicurazioniPerPos(
    [{ codicePos: 'POS-OVERRIDE', nome: 'Negozio Override' }],
    { ...CONFIG_DEFAULT, targetS1: 1.25, targetS2: 1.25 },
    [{ pdvId: 'POS-OVERRIDE', nome: 'Negozio Override', codicePos: 'POS-OVERRIDE', inGara: true }],
    { 'POS-OVERRIDE': attivato },
    { pagamentoAnnuale: 1.25 },
  );

  assert.equal(result.puntiTotali, 1.25);
  assert.equal(result.bonusSoglia1, 500);
  assert.equal(result.bonusSoglia2, 750);
  assert.equal(result.premioBase, 0);
});

test('Simulatore RS: Pagamento Annuale usa punti default/override e soglie moltiplicate per PDV', () => {
  const attivato = createEmptyAssicurazioniAttivato();
  attivato.pagamentoAnnuale = 2;

  const defaultResult = calcolaPremioAssicurazioniPerRS(
    attivato,
    { ...CONFIG_DEFAULT, targetS1: 0.5, targetS2: 0.5 },
    2,
  );
  assert.equal(defaultResult.puntiBase, 1, '2 pezzi × 0,5 punti');
  assert.equal(defaultResult.bonusSoglia1, 1000, 'S1: 500 € × 2 PDV');
  assert.equal(defaultResult.bonusSoglia2, 1500, 'S2: 750 € × 2 PDV');
  assert.equal(defaultResult.gettoniBase, 0);
  assert.equal(defaultResult.premioTotale, 2500);

  const overrideResult = calcolaPremioAssicurazioniPerRS(
    attivato,
    { ...CONFIG_DEFAULT, targetS1: 1.25, targetS2: 1.25 },
    2,
    { pagamentoAnnuale: 1.25 },
  );
  assert.equal(overrideResult.puntiBase, 2.5, 'override: 2 pezzi × 1,25 punti');
  assert.equal(overrideResult.bonusSoglia1, 1000);
  assert.equal(overrideResult.bonusSoglia2, 1500);
  assert.equal(overrideResult.gettoniBase, 0, 'l’override punti non altera il premio prodotto');
  assert.equal(overrideResult.premioTotale, 2500);
});