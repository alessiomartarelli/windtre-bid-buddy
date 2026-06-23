import type { CjDriver, CjItemState } from "./schema";

// === Customer Journey driver classification (Task #158) ===
// Mappa categoria BiSuite → driver CJ. Rispecchia la classificazione canvass
// di `client/src/lib/bisuiteClassification.ts` (CATEGORY_MAP), limitata ai
// driver della customer journey. Tenuta in shared perché serve sia al motore
// di reconcile lato server sia alla UI. 'telefono' NON è una pista canvass:
// è la categoria dispositivi TELEFONIA.
//
// IMPORTANTE: CB / MIA / rivincoli sono esclusi per design (non sono nuove
// attivazioni e non fanno parte dei driver della journey).

export const CJ_DRIVER_LABELS: Record<CjDriver, string> = {
  mobile: "Mobile",
  fisso: "Fisso",
  energia: "Energia",
  assicurazioni: "Assicurazioni",
  telefono: "Smartphone",
  protetti: "Windtre Protetti",
};

export const CJ_DRIVER_ORDER: CjDriver[] = [
  "mobile", "fisso", "energia", "assicurazioni", "telefono", "protetti",
];

export const CJ_ITEM_STATE_LABELS: Record<CjItemState, string> = {
  inserito: "Inserito",
  in_lavorazione: "In lavorazione",
  attivato: "Attivato",
  ko: "KO",
  pagato: "Pagato",
  stornato: "Stornato",
  riaccreditato: "Riaccreditato",
};

// Un driver è "attivato" se ha almeno un item in uno di questi stati (cioè
// non KO e non stornato). Centralizzato qui per essere riusato sia dal
// dettaglio journey sia dal riepilogo per-scheda nella lista.
export const CJ_ACTIVE_STATES = new Set<CjItemState>([
  "inserito", "in_lavorazione", "attivato", "pagato", "riaccreditato",
]);

export interface CjDriverSummary {
  driver: CjDriver;
  activated: boolean;
  count: number;
}

/**
 * Riepilogo per-driver (attivato sì/no + conteggio item) per un insieme di
 * item di una journey. L'energia distingue gas/luce a livello di item ma per
 * il riepilogo conta come singolo driver. L'ordine segue `CJ_DRIVER_ORDER`.
 */
export function summarizeDrivers(
  items: { driver: CjDriver; state: CjItemState }[],
): CjDriverSummary[] {
  return CJ_DRIVER_ORDER.map((driver) => {
    const driverItems = items.filter((it) => it.driver === driver);
    const activated = driverItems.some((it) => CJ_ACTIVE_STATES.has(it.state));
    return { driver, activated, count: driverItems.length };
  });
}

const MOBILE_CATEGORIES = new Set([
  "UNTIED", "TIED CF", "TIED IVA", "ALTRE GA", "ADD-ON GA", "VERY MOBILE",
]);
const FISSO_CATEGORIES = new Set([
  "ADSL/FIBRA/FWA CF", "ADSL/FIBRA/FWA IVA", "FISSO VOCE", "ADD-ON FISSI",
]);
const ENERGIA_CATEGORIES = new Set(["ENERGIA W3", "ACEA ENERGIA"]);
const ASSICURAZIONI_CATEGORIES = new Set([
  "ASSICURAZIONI", "ASSICURAZIONI BUSINESS PRO", "WINDTRE SECURITY PRO GA",
]);
const PROTETTI_CATEGORIES = new Set(["ALLARMI"]);
const TELEFONO_CATEGORIES = new Set(["TELEFONIA"]);

function normCat(categoria: string | null | undefined): string {
  return (categoria || "").toUpperCase().trim();
}

/** Restituisce il driver CJ per una categoria, o null se non è un driver. */
export function driverFromCategory(categoria: string | null | undefined): CjDriver | null {
  const k = normCat(categoria);
  if (MOBILE_CATEGORIES.has(k)) return "mobile";
  if (FISSO_CATEGORIES.has(k)) return "fisso";
  if (ENERGIA_CATEGORIES.has(k)) return "energia";
  if (ASSICURAZIONI_CATEGORIES.has(k)) return "assicurazioni";
  if (PROTETTI_CATEGORIES.has(k)) return "protetti";
  if (TELEFONO_CATEGORIES.has(k)) return "telefono";
  return null;
}

/**
 * true se la categoria è una **nuova attivazione di pista mobile** che fa
 * scattare la customer journey. Esclude per costruzione CB/MIA/rivincoli.
 */
export function isMobileActivationCategory(categoria: string | null | undefined): boolean {
  return MOBILE_CATEGORIES.has(normCat(categoria));
}

/** Sotto-tipo energia dalla tipologia: 'gas' | 'luce' | null. */
export function energiaSubtype(tipologia: string | null | undefined): "gas" | "luce" | null {
  const t = (tipologia || "").toUpperCase();
  if (t.includes("GAS")) return "gas";
  if (t.includes("LUCE")) return "luce";
  return null;
}

/**
 * Estrae i campi codificati nelle stringhe free-text `venditaInfoN` del
 * `dettaglio` BiSuite (es. "CODICE CONTRATTO: 168...", "POD/PDR: 005...",
 * "IMEI/SERIALE DISPOSITIVO ASSOCIATO: 0"). I valori vuoti o "0" sono
 * scartati. Il discriminante POD vs PDR (luce vs gas) lo applica il chiamante
 * in base a `energiaSubtype(tipologia)`.
 */
export function parseVenditaInfo(dettaglio: any): {
  codiceContratto?: string;
  podPdr?: string;
  imei?: string;
} {
  const out: { codiceContratto?: string; podPdr?: string; imei?: string } = {};
  if (!dettaglio || typeof dettaglio !== "object") return out;
  const fields = [
    dettaglio.venditaInfo1, dettaglio.venditaInfo2, dettaglio.venditaInfo3,
    dettaglio.venditaInfo4, dettaglio.venditaInfo5,
  ];
  for (const f of fields) {
    if (typeof f !== "string") continue;
    const idx = f.indexOf(":");
    if (idx < 0) continue;
    const label = f.slice(0, idx).toUpperCase().trim();
    const value = f.slice(idx + 1).trim();
    if (!value || value === "0") continue;
    if (label.includes("CODICE CONTRATTO")) out.codiceContratto = value;
    else if (label.includes("POD") || label.includes("PDR")) out.podPdr = value;
    else if (label.includes("IMEI")) out.imei = value;
  }
  return out;
}

// Prefissi email "generici" (caselle di reparto/servizio) che NON sono il nome
// dell'azienda: in questi casi non proponiamo alcun suggerimento di ragione
// sociale.
const GENERIC_EMAIL_LOCAL_PARTS = new Set([
  "info", "amministrazione", "amm", "ammin", "contabilita", "segreteria",
  "direzione", "commerciale", "ufficio", "ordini", "acquisti", "vendite",
  "mail", "posta", "pec", "noreply", "no-reply", "supporto", "assistenza",
  "marketing", "hr", "staff", "admin", "contact", "contatti", "azienda",
]);

/**
 * Suggerimento (best-effort) della ragione sociale del cliente business a
 * partire dalla sua email. BiSuite NON fornisce la ragione sociale del cliente
 * in un campo strutturato: l'unico indizio è la parte locale dell'email (es.
 * `BLUESHARKSRL@modaroma.it` ⇒ "BLUESHARKSRL"). Il valore è solo un punto di
 * partenza modificabile dall'operatore: non sappiamo dove vadano gli spazi.
 * Restituisce null se l'email manca, è una casella generica di reparto, o non
 * contiene lettere.
 */
export function suggestRagioneSocialeFromEmail(
  email: string | null | undefined,
): string | null {
  if (!email) return null;
  const at = String(email).indexOf("@");
  if (at <= 0) return null;
  const local = String(email).slice(0, at).trim();
  if (!local) return null;
  // scarta separatori comuni e numeri di coda (es. "info2", "amministrazione.2")
  const base = local.replace(/[._-]?\d+$/, "").replace(/[._-]+/g, " ").trim();
  const key = base.replace(/\s+/g, "").toLowerCase();
  if (!key || GENERIC_EMAIL_LOCAL_PARTS.has(key)) return null;
  if (!/[a-zA-Z]/.test(base)) return null;
  return base.toUpperCase();
}
