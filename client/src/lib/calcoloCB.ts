import {
  type CBEventType,
  CB_EVENTS_CONFIG,
  CAMBIO_OFFERTA_UNTIED_CLUSTERS,
  CAMBIO_OFFERTA_RIVINCOLI_CLUSTERS,
} from "@/types/partnership-cb-events";

export interface CBCalcItem {
  targetCategory: string;
  count: number;
}

export interface CBCalcResult {
  premioStimato: number;
  puntiTotali: number;
  sogliaRaggiunta: number;
  sogliaLabel: string;
}

const CB_EVENT_LOOKUP = new Map(
  CB_EVENTS_CONFIG.map((e) => [e.type, e])
);

export function clusterCBToLevel(clusterCB?: string): number {
  if (!clusterCB) return 0;
  const c = clusterCB.toLowerCase();
  if (c.includes("3")) return 3;
  if (c.includes("2")) return 2;
  if (c.includes("1") || c.includes("local")) return 1;
  return 0;
}

export function getCBGettoniForCategory(targetCategory: string, clusterLevel: number): number {
  if (targetCategory === "cambio_offerta_untied") {
    const entry = CAMBIO_OFFERTA_UNTIED_CLUSTERS[clusterLevel];
    return entry ? entry.gettoni : CAMBIO_OFFERTA_UNTIED_CLUSTERS[0].gettoni;
  }
  if (targetCategory === "cambio_offerta_rivincoli") {
    const entry = CAMBIO_OFFERTA_RIVINCOLI_CLUSTERS[clusterLevel];
    return entry ? entry.gettoni : CAMBIO_OFFERTA_RIVINCOLI_CLUSTERS[0].gettoni;
  }
  const eventConf = CB_EVENT_LOOKUP.get(targetCategory as CBEventType);
  return eventConf?.gettoni ?? 0;
}

export function calcoloCBPerPdv(
  items: CBCalcItem[],
  clusterCB?: string,
): CBCalcResult {
  if (items.length === 0) {
    return { premioStimato: 0, puntiTotali: 0, sogliaRaggiunta: 0, sogliaLabel: "N/A" };
  }

  const clusterLevel = clusterCBToLevel(clusterCB);
  let totaleGettoni = 0;
  let totalePezzi = 0;
  for (const item of items) {
    totaleGettoni += item.count * getCBGettoniForCategory(item.targetCategory, clusterLevel);
    totalePezzi += item.count;
  }
  return {
    premioStimato: totaleGettoni,
    puntiTotali: totalePezzi,
    sogliaRaggiunta: 0,
    sogliaLabel: "N/A",
  };
}
