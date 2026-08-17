import {
  classifyCategory,
  isCouponCaring,
  isPezzoIva,
  type PistaCanvass,
} from './bisuiteClassification';

// Task #398 — colonne extra della Tabella PDV × Pista (Pezzi) di Vendite
// BiSuite, stesse regole della vista Pezzi della Dashboard Gara (Task #392):
//  - IVA: pezzi P.IVA (business) sulle piste canvass, via `isPezzoIva`;
//  - CB: SOLO cambi piano (MIA TIED/UNTIED non Coupon Caring + RIVINCOLO).
//    Come nella dashboard il conteggio è per CATEGORIA BiSuite di origine
//    (`classifyCategory`), NON per pista post-regole: regole KPI custom o
//    listino canvass VF possono rimappare la pista, e i "twin" partnership
//    delle regole di mapping non devono raddoppiare il conteggio;
//  - Telefoni: articoli categoria TELEFONIA;
//  - € Accessori / € Servizi: importi al NETTO IVA (÷1.22), come nel resto
//    della dashboard e nel report Telegram. Servizi = SPEDIZIONE, ASSISTENZA
//    e GARANTEASY (stesse categorie della dashboard); Accessori = ACCESSORI.
// Logica pura in shared/ (import relativi) per compatibilità coi test tsx.

export const IVA_RATE = 1.22;
export const nettoIva = (v: number): number => v / IVA_RATE;

const ACCESSORI_EURO_CATS = new Set(['ACCESSORI']);
const SERVIZI_EURO_CATS = new Set(['SPEDIZIONE', 'ASSISTENZA', 'GARANTEASY']);

export interface PezziExtraCounters {
  /** Pezzi P.IVA (business) sulle piste canvass. */
  iva: number;
  /** Cambi piano CB (solo MIA TIED/UNTIED no Coupon Caring + RIVINCOLO). */
  cb: number;
  /** Telefoni venduti (categoria TELEFONIA). */
  telefoni: number;
  /** Fatturato Accessori, netto IVA. */
  accEuro: number;
  /** Fatturato Servizi (SPEDIZIONE/ASSISTENZA/GARANTEASY), netto IVA. */
  srvEuro: number;
}

export const emptyPezziExtra = (): PezziExtraCounters => ({
  iva: 0,
  cb: 0,
  telefoni: 0,
  accEuro: 0,
  srvEuro: 0,
});

/** Forma minima di articolo classificato per i contatori extra. */
export interface PezziExtraArticle {
  /** Pista canvass classificata (già senza Coupon Caring). NON usata per
   * IVA/CB (che sono per categoria di origine, come nella dashboard). */
  pista?: PistaCanvass;
  categoriaNome: string;
  /** Tipologia BiSuite: serve per riconoscere il Coupon Caring quando il
   * flag `couponCaring` non è già presente. */
  tipologiaNome?: string;
  /** Flag Coupon Caring già calcolato da `classifySaleArticles`. */
  couponCaring?: boolean;
  descrizione?: string;
  /** Importo imponibile BiSuite (`dettaglio.importoImponibile`), se noto. */
  importoImponibile?: number;
  /** Prezzo articolo: fallback quando l'imponibile non è disponibile. */
  prezzo?: number;
}

/**
 * Accumula i contatori extra per un articolo. Stesse regole della vista
 * Pezzi della dashboard: importo = imponibile se presente, altrimenti
 * prezzo; il netto IVA è applicato per-articolo (la divisione è lineare,
 * quindi equivale a scorporare il totale).
 */
export function accumulaPezziExtra(counters: PezziExtraCounters, art: PezziExtraArticle): void {
  const cat = (art.categoriaNome || '').toUpperCase().trim();
  // IVA e CB per CATEGORIA BiSuite di origine (come server/bisuiteMappedSales):
  // le regole KPI custom / listino VF possono rimappare la pista finale, ma
  // "cambio piano" e "pezzo IVA" restano proprietà della categoria sorgente.
  const coupon = art.couponCaring ?? isCouponCaring(cat, art.tipologiaNome || '');
  const srcPista = coupon ? undefined : classifyCategory(cat)?.pista;
  if (srcPista) {
    if (isPezzoIva({ pista: srcPista, categoriaNome: cat, descrizione: art.descrizione })) {
      counters.iva += 1;
    }
    if (srcPista === 'cb') counters.cb += 1;
  }
  if (cat === 'TELEFONIA') counters.telefoni += 1;
  const importo = (art.importoImponibile ?? 0) || (art.prezzo ?? 0);
  if (ACCESSORI_EURO_CATS.has(cat)) counters.accEuro += nettoIva(importo);
  else if (SERVIZI_EURO_CATS.has(cat)) counters.srvEuro += nettoIva(importo);
}

export function sommaPezziExtra(target: PezziExtraCounters, add: PezziExtraCounters): void {
  target.iva += add.iva;
  target.cb += add.cb;
  target.telefoni += add.telefoni;
  target.accEuro += add.accEuro;
  target.srvEuro += add.srvEuro;
}
