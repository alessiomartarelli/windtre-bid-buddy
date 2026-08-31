import assert from 'node:assert/strict';
import test from 'node:test';

const {
  broadGaraConfigResetBlocks,
  isBroadGaraConfigReset,
} = await import('../shared/garaConfigSafety.ts');

const full = {
  energiaRSConfig: { configPerRS: [{ pdvInGara: 12, pistaSoglia_S1: 111, pistaSoglia_S2: 222, premioS1: 250 }] },
  assicurazioniRSConfig: { configPerRS: [{ pdvInGara: 12, targetS1: 180, targetS2: 240, premioS1: 500 }] },
  protectaRSConfig: { configPerRS: [{ targetExtra: 26, targetDecurtazione: 26, premioExtra: 350 }] },
  decurtazioneRSConfig: { configPerRS: [{ importo: 6000 }, { importo: 500 }] },
  pistaMobileRSConfig: { sogliePerRS: [{ soglia1: 100, soglia2: 200, soglia3: 300 }] },
};

test('blocca l’azzeramento contemporaneo di più sezioni gara', () => {
  const reset = {
    ...full,
    energiaRSConfig: { configPerRS: [{ pdvInGara: 0, pistaSoglia_S1: 0, pistaSoglia_S2: 0, premioS1: 250 }] },
    assicurazioniRSConfig: { configPerRS: [{ pdvInGara: 0, targetS1: 0, targetS2: 0, premioS1: 500 }] },
    protectaRSConfig: { configPerRS: [{ targetExtra: 0, targetDecurtazione: 0, premioExtra: 350 }] },
    decurtazioneRSConfig: { configPerRS: [{ importo: 0 }, { importo: 0 }] },
  };
  assert.equal(isBroadGaraConfigReset(full, reset), true);
  assert.deepEqual(
    broadGaraConfigResetBlocks(full, reset),
    ['energiaRSConfig', 'assicurazioniRSConfig', 'protectaRSConfig', 'decurtazioneRSConfig'],
  );
});

test('una modifica normale o una singola sezione azzerata non è un reset massivo', () => {
  assert.equal(isBroadGaraConfigReset(full, {
    ...full,
    energiaRSConfig: { configPerRS: [{ pdvInGara: 10, pistaSoglia_S1: 100, pistaSoglia_S2: 200, premioS1: 250 }] },
  }), false);
  assert.equal(isBroadGaraConfigReset(full, {
    ...full,
    decurtazioneRSConfig: { configPerRS: [{ importo: 0 }, { importo: 0 }] },
  }), false);
});