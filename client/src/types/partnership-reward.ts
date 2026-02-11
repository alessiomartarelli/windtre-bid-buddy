export interface PartnershipRewardConfig {
  target100: number;
  target80: number;
  premio100: number;
  premio80: number;
}

export interface PartnershipRewardPosConfig {
  posCode: string;
  config: PartnershipRewardConfig;
}

// Valori di default per target 100% basati su cluster e posizione
export const getDefaultTarget100 = (
  tipoPosizione: "centro_commerciale" | "strada" | "altro",
  clusterCB: string
): number => {
  const cluster = clusterCB.toLowerCase();
  
  if (tipoPosizione === "strada" || tipoPosizione === "altro") {
    if (cluster.includes("1")) return 270;
    if (cluster.includes("2")) return 300;
    if (cluster.includes("3")) return 330;
  } else if (tipoPosizione === "centro_commerciale") {
    if (cluster.includes("1")) return 320;
    if (cluster.includes("2")) return 350;
    if (cluster.includes("3")) return 380;
  }
  
  // Default fallback
  return 300;
};

export const calculateTarget80 = (target100: number): number => {
  return Math.round(target100 * 0.8);
};

export const calculatePremio80 = (premio100: number): number => {
  return Math.round(premio100 * 0.8);
};
