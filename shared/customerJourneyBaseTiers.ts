import { CJ_GETTONE_TABLE, type CjGettoneJourney } from "./customerJourney";

/** Clients in each base tier divided by eligible active SIMs in the same cohort. */
export function getCjBaseTierDistribution(
  journeys: ReadonlyArray<Pick<CjGettoneJourney, "pisteAttive" | "simAttive">>,
) {
  const totalSim = journeys.reduce((sum, journey) => sum + journey.simAttive, 0);
  const counts = CJ_GETTONE_TABLE.map(() => 0);
  for (const journey of journeys) {
    if (counts[journey.pisteAttive] !== undefined) counts[journey.pisteAttive]++;
  }
  return {
    totalSim,
    tiers: CJ_GETTONE_TABLE.map((tariffa, piste) => ({
      piste,
      tariffa,
      clienti: counts[piste],
      percentualeSim: totalSim > 0 ? counts[piste] / totalSim * 100 : 0,
    })),
  };
}
