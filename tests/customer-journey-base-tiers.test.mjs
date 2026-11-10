import test from "node:test";
import assert from "node:assert/strict";
import { getCjBaseTierDistribution } from "../shared/customerJourneyBaseTiers.ts";

test("percentuali per tutti gli scaglioni 0–5 sul totale SIM della coorte", () => {
  const result = getCjBaseTierDistribution(
    Array.from({ length: 6 }, (_, pisteAttive) => ({ pisteAttive, simAttive: 1 })),
  );
  assert.equal(result.totalSim, 6);
  assert.deepEqual(result.tiers.map(t => t.tariffa), [0, 20, 30, 40, 100, 120]);
  for (const tier of result.tiers) {
    assert.equal(tier.clienti, 1);
    assert.ok(Math.abs(tier.percentualeSim - 100 / 6) < 1e-10);
  }
});

test("più SIM dello stesso cliente aumentano solo il denominatore", () => {
  const result = getCjBaseTierDistribution([
    { pisteAttive: 1, simAttive: 3 },
    { pisteAttive: 1, simAttive: 1 },
    { pisteAttive: 2, simAttive: 1 },
  ]);
  assert.equal(result.totalSim, 5);
  assert.equal(result.tiers[1].clienti, 2);
  assert.equal(result.tiers[1].percentualeSim, 40);
  assert.equal(result.tiers[2].percentualeSim, 20);
});

test("la coorte filtrata è l'unica fonte per numeratore e denominatore", () => {
  const selected = [{ pisteAttive: 3, simAttive: 2 }];
  const result = getCjBaseTierDistribution(selected);
  assert.equal(result.totalSim, 2);
  assert.equal(result.tiers[3].percentualeSim, 50);
  assert.equal(result.tiers[0].percentualeSim, 0);
  assert.deepEqual(selected, [{ pisteAttive: 3, simAttive: 2 }]);
});

test("coorte vuota o denominatore zero restituiscono zero, non NaN", () => {
  for (const journeys of [[], [{ pisteAttive: 1, simAttive: 0 }]]) {
    const result = getCjBaseTierDistribution(journeys);
    assert.equal(result.totalSim, 0);
    assert.ok(result.tiers.every(tier => tier.percentualeSim === 0));
  }
});
