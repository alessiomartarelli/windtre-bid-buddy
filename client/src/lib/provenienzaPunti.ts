import { FISSO_CATEGORIE_DEFAULT } from "./calcoloPistaFisso";
import { ENERGIA_BASE_PAY } from "../types/energia";
import { ASSICURAZIONI_POINTS } from "../types/assicurazioni";
import { CB_EVENTS_CONFIG, PARTNERSHIP_DEFAULTS } from "../types/partnership-cb-events";
import { createEmptyProtectaAttivato } from "../types/protecta";
import { PUNTI_EXTRA_GARA } from "./calcoloExtraGaraIva";

export interface PistaComponentPointsContext {
  mobile?: Record<string, number>;
  partnership?: Record<string, number>;
  assicurazioni?: Record<string, number>;
  extraGara?: Record<string, number>;
}

const FISSO_POINTS: Record<string, number> = Object.fromEntries(
  FISSO_CATEGORIE_DEFAULT.map((category) => [category.type, category.puntiPerPezzo]),
);
const PARTNERSHIP_CATEGORIES = new Set(CB_EVENTS_CONFIG.map((category) => category.type as string));
const PROTECTA_CATEGORIES = new Set(Object.keys(createEmptyProtectaAttivato()));
const EXTRA_GARA_POINTS_KEY: Record<string, keyof typeof PUNTI_EXTRA_GARA> = {
  worldStaff: "worldStaff",
  fullPlus: "fullPlusData60_100",
  flexSpecial: "flexSpecialData10",
  fissoPIva: "fissoPIva",
  fritzBox: "fritzBox",
  luceGas: "luceGas",
  protezionePro: "protezionePro",
  negozioProtetti: "negozioProtetti",
};

/**
 * Restituisce il contributo punti additivo di una singola componente.
 * Le categorie valide che valgono zero restituiscono 0 esplicitamente,
 * così il dettaglio può mostrare anche "0,00 pt" senza nascondere dati.
 */
export function calcolaPuntiComponentePista(
  pista: string,
  category: string,
  pezzi: number,
  context: PistaComponentPointsContext = {},
): number {
  if (!Number.isFinite(pezzi) || pezzi <= 0) return 0;

  if (pista === "mobile") {
    return pezzi * (context.mobile?.[category] ?? 0);
  }
  if (pista === "fisso") {
    return pezzi * (FISSO_POINTS[category] ?? 0);
  }
  if (pista === "energia") {
    return Object.prototype.hasOwnProperty.call(ENERGIA_BASE_PAY, category) ? pezzi : 0;
  }
  if (pista === "partnership") {
    if (!PARTNERSHIP_CATEGORIES.has(category)) return 0;
    const points = context.partnership?.[category]
      ?? PARTNERSHIP_DEFAULTS[category]?.puntiPartnership
      ?? 1;
    return pezzi * points;
  }
  if (pista === "cb") {
    return category === "coupon_caring" ? 0 : pezzi;
  }
  if (pista === "assicurazioni") {
    const points = context.assicurazioni?.[category]
      ?? (ASSICURAZIONI_POINTS as Record<string, number>)[category]
      ?? 0;
    return pezzi * points;
  }
  if (pista === "protecta") {
    return PROTECTA_CATEGORIES.has(category) ? pezzi : 0;
  }
  if (pista === "extra_gara_iva") {
    const pointsKey = EXTRA_GARA_POINTS_KEY[category];
    if (!pointsKey) return 0;
    return pezzi * (
      context.extraGara?.[pointsKey]
      ?? PUNTI_EXTRA_GARA[pointsKey]
    );
  }
  return 0;
}