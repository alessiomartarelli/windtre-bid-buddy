type JsonRecord = Record<string, unknown>;

export const GARA_CONFIG_PROTECTED_BLOCKS = [
  "pistaMobileRSConfig",
  "pistaFissoRSConfig",
  "partnershipRewardRSConfig",
  "energiaRSConfig",
  "assicurazioniRSConfig",
  "protectaRSConfig",
  "decurtazioneRSConfig",
] as const;

function countPositiveNumbers(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? 1 : 0;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countPositiveNumbers(item), 0);
  if (value && typeof value === "object") {
    return Object.values(value as JsonRecord).reduce<number>(
      (sum, item) => sum + countPositiveNumbers(item),
      0,
    );
  }
  return 0;
}

/**
 * Individua il pattern tipico di un form non idratato che sta per sostituire
 * una configurazione completa: almeno due blocchi indipendenti perdono metà
 * o più dei valori positivi in un unico PUT.
 */
export function broadGaraConfigResetBlocks(
  current: unknown,
  incoming: unknown,
): string[] {
  if (!current || typeof current !== "object" || !incoming || typeof incoming !== "object") {
    return [];
  }
  const before = current as JsonRecord;
  const after = incoming as JsonRecord;
  return GARA_CONFIG_PROTECTED_BLOCKS.filter((key) => {
    const previousCount = countPositiveNumbers(before[key]);
    if (previousCount < 2) return false;
    const incomingCount = countPositiveNumbers(after[key]);
    return incomingCount * 2 <= previousCount;
  });
}

export function isBroadGaraConfigReset(current: unknown, incoming: unknown): boolean {
  return broadGaraConfigResetBlocks(current, incoming).length >= 2;
}