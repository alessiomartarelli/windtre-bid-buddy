import { parseVenditaInfo } from "./customerJourney";

export const CJ_CB_REFERENCE_CATEGORIES = ["MIA TIED", "MIA UNTIED", "RIVINCOLO"] as const;

export interface CjCbSimReference {
  id: string;
  categoria: string;
  descrizione: string;
  iccid: string | null;
  data: string | null;
  pdv: string | null;
}

export function cjCbSimReference(
  id: string, article: { categoria?: string | null; descrizione?: string | null; dettaglio?: unknown },
  data: string | null, pdv: string | null,
): CjCbSimReference | null {
  const categoria = article.categoria?.trim().toUpperCase() ?? "";
  if (!CJ_CB_REFERENCE_CATEGORIES.some(c => c === categoria)) return null;
  return { id, categoria, descrizione: article.descrizione || categoria,
    iccid: parseVenditaInfo(article.dettaglio).iccid ?? null, data, pdv };
}
