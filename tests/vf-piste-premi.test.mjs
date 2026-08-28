import { test } from 'node:test';
import assert from 'node:assert/strict';

// Test suite Obiettivi/soglie/premi piste Vodafone/Fastweb (Task #528).
//
// Logica PURA (shared/vfPisteCalc.ts), caricata via loader tsx: nessun
// server, nessun DB. Copre:
//   - risoluzione RS effettiva del perimetro dashboard (PDV selezionato,
//     filtro RS, org mono-RS senza selettore, aggregato multi-RS);
//   - precedenza override RS vs config globale, incluso blocco `rimosso`
//     (fail-closed: niente premi anche se esiste config globale);
//   - config assente o con target tutti a 0 = solo conteggio pezzi;
//   - calcolo soglia raggiunta / premio flat / prossimo target.

const { resolveVfEffectiveRsKey, resolveVfPistaConf, calcVfPistaResult } =
  await import('../shared/vfPisteCalc.ts');
const { normalizeRsName } = await import('../shared/ragioneSociale.ts');

const catalogMulti = [
  { codicePos: 'POS1', ragioneSociale: 'Alfa Srl' },
  { codicePos: 'POS2', ragioneSociale: 'Alfa Srl' },
  { codicePos: 'POS3', ragioneSociale: 'Beta Spa' },
];
const catalogMono = [
  { codicePos: 'POS1', ragioneSociale: 'Alfa Srl' },
  { codicePos: 'POS2', ragioneSociale: 'Alfa Srl' },
];
const alfaKey = normalizeRsName('Alfa Srl');
const betaKey = normalizeRsName('Beta Spa');

test('RS effettiva: PDV selezionato risolve la RS del PDV (anche con rsFilter=all)', () => {
  assert.equal(
    resolveVfEffectiveRsKey({ pdvFilter: 'POS3', rsFilter: 'all', catalog: catalogMulti }),
    betaKey,
  );
});

test('RS effettiva: filtro RS selezionato senza PDV', () => {
  assert.equal(
    resolveVfEffectiveRsKey({ pdvFilter: 'all', rsFilter: alfaKey, catalog: catalogMulti }),
    alfaKey,
  );
});

test('RS effettiva: org mono-RS senza selettore usa la sua unica RS', () => {
  assert.equal(
    resolveVfEffectiveRsKey({ pdvFilter: 'all', rsFilter: 'all', catalog: catalogMono }),
    alfaKey,
  );
});

test('RS effettiva: aggregato multi-RS => null (vale la config globale)', () => {
  assert.equal(
    resolveVfEffectiveRsKey({ pdvFilter: 'all', rsFilter: 'all', catalog: catalogMulti }),
    null,
  );
});

const globalConf = { luce: { targetS1: 5, targetS2: 10, targetS3: 20, premioS1: 100, premioS2: 200, premioS3: 400 } };
const perRS = [
  {
    ragioneSociale: 'Alfa Srl',
    perPista: { luce: { targetS1: 2, targetS2: 4, targetS3: 8, premioS1: 50, premioS2: 100, premioS3: 150 } },
  },
  { ragioneSociale: 'Beta Spa', rimosso: true, perPista: {} },
];

test('override RS applicato quando la RS effettiva ha un blocco', () => {
  const conf = resolveVfPistaConf({ pista: 'luce', global: globalConf, perRS, effectiveRsKey: alfaKey });
  assert.equal(conf?.targetS1, 2);
});

test('RS senza blocco eredita la config globale', () => {
  const conf = resolveVfPistaConf({ pista: 'luce', global: globalConf, perRS: [], effectiveRsKey: alfaKey });
  assert.equal(conf?.targetS1, 5);
});

test('blocco RS rimosso disattiva soglie/premi anche con config globale presente', () => {
  const conf = resolveVfPistaConf({ pista: 'luce', global: globalConf, perRS, effectiveRsKey: betaKey });
  assert.equal(conf, null);
});

test('config con target tutti a 0 equivale ad assente (solo pezzi)', () => {
  const conf = resolveVfPistaConf({
    pista: 'gas',
    global: { gas: { targetS1: 0, targetS2: 0, targetS3: 0, premioS1: 100 } },
    perRS: [],
    effectiveRsKey: null,
  });
  assert.equal(conf, null);
});

test('pista senza config resta a solo conteggio', () => {
  assert.equal(resolveVfPistaConf({ pista: 'vas', global: globalConf, perRS: [], effectiveRsKey: null }), null);
});

test('calcolo: nessuna soglia raggiunta, prossimo target = S1', () => {
  const r = calcVfPistaResult(1, globalConf.luce);
  assert.deepEqual(r, { soglia: null, premio: 0, nextTarget: 5 });
});

test('calcolo: soglia intermedia raggiunta, premio flat non cumulativo', () => {
  const r = calcVfPistaResult(12, globalConf.luce);
  assert.deepEqual(r, { soglia: 'S2', premio: 200, nextTarget: 20 });
});

test('calcolo: soglia massima raggiunta, nessun prossimo target', () => {
  const r = calcVfPistaResult(25, globalConf.luce);
  assert.deepEqual(r, { soglia: 'S3', premio: 400, nextTarget: null });
});

test('calcolo: livello con target 0 viene saltato', () => {
  const conf = { targetS1: 0, targetS2: 10, targetS3: 0, premioS2: 300 };
  const r = calcVfPistaResult(10, conf);
  assert.deepEqual(r, { soglia: 'S2', premio: 300, nextTarget: null });
});
