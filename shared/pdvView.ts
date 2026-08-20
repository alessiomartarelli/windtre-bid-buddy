// Vista PDV Origine/Destinazione (Task #462).
//
// Le vendite BiSuite sono sempre memorizzate con il PDV di ORIGINE
// (`codicePos`/`nomeNegozio`, estratti da `rawData.attivita` con fallback
// `addetto.attivita[0]`). Il PDV di DESTINAZIONE (vendita trasferita a un
// altro negozio) è disponibile SOLO nei dati grezzi (`rawData.attivitaDestinazione`)
// e viene risolto qui a lettura, senza mai riscrivere i campi legacy.
//
// Regole:
//  - la destinazione NON è mai usata come fallback dell'origine (e viceversa
//    l'origine non è usata come fallback silenzioso della destinazione);
//  - in vista Destinazione, le vendite prive di destinazione finiscono in un
//    bucket esplicito `SENZA_DESTINAZIONE_POS` (mai attribuite a un altro PDV);
//  - tutti i moduli fuori da Vendite BiSuite e Dashboard Gara continuano a
//    usare esclusivamente i campi legacy (origine).
//
// Modulo puro (solo import relativi): usato da server, client e test tsx.

export type PdvView = "origine" | "destinazione";

export const PDV_VIEWS: readonly PdvView[] = ["origine", "destinazione"] as const;

export function normalizePdvView(raw: unknown): PdvView {
  return raw === "destinazione" ? "destinazione" : "origine";
}

/** Codice sentinella del bucket esplicito per le vendite senza destinazione. */
export const SENZA_DESTINAZIONE_POS = "SENZA_DESTINAZIONE";
export const SENZA_DESTINAZIONE_LABEL = "Senza PDV destinazione";

export type PdvRef = { codicePos: string; nomeNegozio: string };

type AttivitaLike = { codiceOperatoreWind?: unknown; nominativo?: unknown } | null | undefined;

const norm = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function refFromAttivita(att: AttivitaLike): PdvRef | null {
  if (!att || typeof att !== "object" || Array.isArray(att)) return null;
  const codicePos = norm((att as any).codiceOperatoreWind);
  const nomeNegozio = norm((att as any).nominativo);
  if (!codicePos && !nomeNegozio) return null;
  return { codicePos, nomeNegozio };
}

/**
 * PDV di ORIGINE dai dati grezzi: `attivita` diretta, con l'attuale fallback
 * compatibile su `addetto.attivita[0]`. MAI `attivitaDestinazione`.
 */
export function extractPdvOrigine(raw: any): PdvRef | null {
  if (!raw || typeof raw !== "object") return null;
  const direct = refFromAttivita(raw.attivita);
  if (direct) return direct;
  const attAddetto = raw.addetto?.attivita;
  if (Array.isArray(attAddetto) && attAddetto.length > 0) {
    return refFromAttivita(attAddetto[0]);
  }
  return null;
}

/**
 * PDV di DESTINAZIONE dai dati grezzi: SOLO `attivitaDestinazione`.
 * Ritorna null se assente/vuota — mai fallback sull'origine.
 */
export function extractPdvDestinazione(raw: any): PdvRef | null {
  if (!raw || typeof raw !== "object") return null;
  return refFromAttivita(raw.attivitaDestinazione);
}

export type SaleForPdvView = {
  codicePos?: string | null;
  nomeNegozio?: string | null;
  rawData?: unknown;
};

export type ResolvedPdvView = PdvRef & {
  /** true sse la vista è Destinazione e la vendita non ha destinazione. */
  senzaDestinazione: boolean;
};

/**
 * Risolve il PDV con cui mostrare/aggregare una vendita nella vista scelta.
 * - 'origine': campi legacy memorizzati (comportamento invariato);
 * - 'destinazione': `attivitaDestinazione` dal raw, altrimenti bucket
 *   esplicito SENZA_DESTINAZIONE (mai un negozio errato).
 */
export function resolveSalePdvForView(sale: SaleForPdvView, view: PdvView): ResolvedPdvView {
  if (view === "destinazione") {
    const dest = extractPdvDestinazione(sale.rawData);
    if (dest) {
      return {
        codicePos: dest.codicePos || dest.nomeNegozio,
        nomeNegozio: dest.nomeNegozio || dest.codicePos,
        senzaDestinazione: false,
      };
    }
    return {
      codicePos: SENZA_DESTINAZIONE_POS,
      nomeNegozio: SENZA_DESTINAZIONE_LABEL,
      senzaDestinazione: true,
    };
  }
  return {
    codicePos: norm(sale.codicePos),
    nomeNegozio: norm(sale.nomeNegozio),
    senzaDestinazione: false,
  };
}
