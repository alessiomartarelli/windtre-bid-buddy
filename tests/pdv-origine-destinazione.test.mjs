import { test } from 'node:test';
import assert from 'node:assert/strict';

// Suite PURA "Vista PDV Origine/Destinazione" (Task #462).
//
// Copre la risoluzione condivisa dei due PDV (shared/pdvView.ts) e la sua
// propagazione ai due layer server usati da Vendite BiSuite e Dashboard Gara:
//   - aggregateMappedSales (server/bisuiteMappedSales.ts): attribuzione per
//     PDV origine (default, invariato) o destinazione, con bucket esplicito
//     SENZA_DESTINAZIONE per le vendite prive di destinazione;
//   - selectInGaraSales/isSaleInGara (server/bisuiteGaraFilter.ts): in vista
//     Destinazione il calendario applicato è quello del PDV di destinazione.
//
// Nessun DB e nessun server: funzioni pure su vendite sintetiche.

const {
  extractPdvOrigine,
  extractPdvDestinazione,
  resolveSalePdvForView,
  resolveSaleRagioneSocialeForView,
  normalizePdvView,
  SENZA_DESTINAZIONE_POS,
  SENZA_DESTINAZIONE_LABEL,
} = await import('../shared/pdvView.ts');
const { aggregateMappedSales } = await import('../server/bisuiteMappedSales.ts');
const { selectInGaraSales } = await import('../server/bisuiteGaraFilter.ts');
const {
  getDefaultMappingRules,
  mergeWithDefaultRules,
} = await import('../shared/bisuiteMapping.ts');

const RULES = mergeWithDefaultRules(getDefaultMappingRules());

// Vendita sintetica: 1 articolo canvass SIM (mobile). `attDest` opzionale.
function mkSale({ pos, nome, dest, data = '2026-07-10T10:00:00.000Z', totale = '10' }) {
  return {
    codicePos: pos,
    nomeNegozio: nome,
    ragioneSociale: 'RS TEST',
    dataVendita: data,
    totale,
    rawData: {
      attivita: { codiceOperatoreWind: pos, nominativo: nome },
      ...(dest ? { attivitaDestinazione: dest } : {}),
      articoli: [
        {
          categoria: { nome: 'TIED' },
          tipologia: { nome: 'TIED' },
          descrizione: 'SIM VOCE TIED',
          dettaglio: { canone: '9.99' },
        },
      ],
      cliente: { clienteTipo: 'PRIVATO' },
    },
  };
}

test('extract: origine da attivita (mai da attivitaDestinazione)', () => {
  const raw = {
    attivitaDestinazione: { codiceOperatoreWind: 'DST1', nominativo: 'Negozio Dest' },
  };
  assert.equal(extractPdvOrigine(raw), null, 'la destinazione NON è fallback dell\'origine');
  assert.deepEqual(extractPdvDestinazione(raw), { codicePos: 'DST1', nomeNegozio: 'Negozio Dest' });

  // Fallback compatibile: addetto.attivita[0]
  const raw2 = { addetto: { attivita: [{ codiceOperatoreWind: ' ORG1 ', nominativo: ' Negozio Org ' }] } };
  assert.deepEqual(extractPdvOrigine(raw2), { codicePos: 'ORG1', nomeNegozio: 'Negozio Org' });
  assert.equal(extractPdvDestinazione(raw2), null, 'l\'origine NON è fallback della destinazione');
});

test('resolveSalePdvForView: destinazione assente => bucket esplicito', () => {
  const sale = mkSale({ pos: 'ORG1', nome: 'Org Uno' });
  const r = resolveSalePdvForView(sale, 'destinazione');
  assert.equal(r.codicePos, SENZA_DESTINAZIONE_POS);
  assert.equal(r.nomeNegozio, SENZA_DESTINAZIONE_LABEL);
  assert.equal(r.senzaDestinazione, true);
  const o = resolveSalePdvForView(sale, 'origine');
  assert.deepEqual(o, { codicePos: 'ORG1', nomeNegozio: 'Org Uno', senzaDestinazione: false });
});

test('resolveSaleRagioneSocialeForView: la destinazione usa la RS del PDV effettivo', () => {
  const sale = mkSale({
    pos: 'ORG1',
    nome: 'Org Uno',
    dest: { codiceOperatoreWind: 'DST1', nominativo: 'Dest Uno' },
  });
  const directory = {
    DST1: { nomeNegozio: 'Dest Uno', ragioneSociale: 'RS DESTINAZIONE' },
  };
  assert.equal(resolveSaleRagioneSocialeForView(sale, 'origine', directory), 'RS TEST');
  assert.equal(resolveSaleRagioneSocialeForView(sale, 'destinazione', directory), 'RS DESTINAZIONE');
  assert.equal(
    resolveSaleRagioneSocialeForView(mkSale({ pos: 'ORG2', nome: 'Org Due' }), 'destinazione', directory),
    '',
    'senza destinazione non eredita la RS origine',
  );
});

test('normalizePdvView: whitelist con default origine', () => {
  assert.equal(normalizePdvView('destinazione'), 'destinazione');
  assert.equal(normalizePdvView('origine'), 'origine');
  assert.equal(normalizePdvView('altro'), 'origine');
  assert.equal(normalizePdvView(undefined), 'origine');
});

test('aggregateMappedSales: vista origine invariata (con e senza opts)', () => {
  const sales = [
    mkSale({ pos: 'ORG1', nome: 'Org Uno', dest: { codiceOperatoreWind: 'DST1', nominativo: 'Dest Uno' } }),
    mkSale({ pos: 'ORG2', nome: 'Org Due' }),
  ];
  const legacy = aggregateMappedSales(sales, RULES);
  const explicitOrigine = aggregateMappedSales(sales, RULES, { pdvView: 'origine' });
  assert.deepEqual(
    JSON.parse(JSON.stringify(legacy)),
    JSON.parse(JSON.stringify(explicitOrigine)),
    'origine esplicita === default legacy',
  );
  assert.equal(legacy.pdvView, 'origine');
  assert.equal(legacy.salesSenzaDestinazione, 0);
  assert.deepEqual(Object.keys(legacy.byPdv).sort(), ['ORG1', 'ORG2']);
  assert.equal(legacy.byPdv['ORG1'].nomeNegozio, 'Org Uno');
});

test('aggregateMappedSales: vista destinazione riattribuisce e isola i senza-destinazione', () => {
  const sales = [
    // Trasferita: origine ORG1 -> destinazione DST1
    mkSale({ pos: 'ORG1', nome: 'Org Uno', dest: { codiceOperatoreWind: 'DST1', nominativo: 'Dest Uno' } }),
    // Non trasferita: nessuna destinazione
    mkSale({ pos: 'ORG2', nome: 'Org Due' }),
  ];
  const agg = aggregateMappedSales(sales, RULES, {
    pdvView: 'destinazione',
    pdvDirectory: {
      DST1: { nomeNegozio: 'Dest Uno', ragioneSociale: 'RS DESTINAZIONE' },
    },
  });
  assert.equal(agg.pdvView, 'destinazione');
  assert.equal(agg.salesSenzaDestinazione, 1);
  assert.deepEqual(Object.keys(agg.byPdv).sort(), ['DST1', SENZA_DESTINAZIONE_POS].sort());
  assert.equal(agg.byPdv['DST1'].nomeNegozio, 'Dest Uno');
  assert.equal(agg.byPdv['DST1'].ragioneSociale, 'RS DESTINAZIONE');
  // La vendita senza destinazione NON è attribuita a ORG2 né a DST1.
  assert.equal(agg.byPdv[SENZA_DESTINAZIONE_POS].nomeNegozio, SENZA_DESTINAZIONE_LABEL);
  assert.equal(agg.byPdv[SENZA_DESTINAZIONE_POS].ragioneSociale, '');
  assert.equal(agg.byPdv[SENZA_DESTINAZIONE_POS].totalArticoli, 1);
  // Totali complessivi identici tra le due viste (cambia solo l'attribuzione).
  const org = aggregateMappedSales(sales, RULES);
  assert.equal(agg.totalArticoli, org.totalArticoli);
  assert.equal(agg.totalImporto, org.totalImporto);
  assert.equal(agg.totalMapped, org.totalMapped);
});

test('selectInGaraSales: in vista destinazione vale il calendario del PDV di destinazione', () => {
  // Calendario: DST1 chiuso il 10/07 (venerdì), ORG1 aperto tutti i giorni.
  const garaCfg = {
    config: {
      pdvList: [
        { codicePos: 'ORG1', calendar: { weeklySchedule: { workingDays: [0, 1, 2, 3, 4, 5, 6] } } },
        {
          codicePos: 'DST1',
          calendar: {
            weeklySchedule: { workingDays: [0, 1, 2, 3, 4, 5, 6] },
            specialDays: [{ date: '2026-07-10', isOpen: false }],
          },
        },
      ],
    },
  };
  const transferred = mkSale({
    pos: 'ORG1', nome: 'Org Uno',
    dest: { codiceOperatoreWind: 'DST1', nominativo: 'Dest Uno' },
    data: '2026-07-10T10:00:00.000Z',
  });

  // Vista origine: conta il calendario di ORG1 (aperto) => in gara.
  const org = selectInGaraSales([transferred], true, garaCfg);
  assert.equal(org.sales.length, 1, 'origine: vendita in gara (calendario ORG1)');

  // Vista destinazione: conta il calendario di DST1 (chiuso il 10/07) => esclusa.
  const dst = selectInGaraSales([transferred], true, garaCfg, 'destinazione');
  assert.equal(dst.sales.length, 0, 'destinazione: esclusa dal calendario DST1');
  assert.equal(dst.salesExcludedOutOfGara, 1);

  // Vendita senza destinazione: nessun calendario per il bucket => fallback in gara.
  const noDest = mkSale({ pos: 'ORG1', nome: 'Org Uno', data: '2026-07-10T10:00:00.000Z' });
  const dst2 = selectInGaraSales([noDest], true, garaCfg, 'destinazione');
  assert.equal(dst2.sales.length, 1, 'senza destinazione: fallback in gara come PDV non configurato');
});
