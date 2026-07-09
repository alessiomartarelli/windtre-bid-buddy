// Canonical list of toggleable modules per organization.
// `enabledModules` on an organization is a Record<ModuleKey, boolean>.
// When a module is missing from the record it defaults to TRUE (retro-compat).
// `super_admin` always bypasses these flags.

export type ModuleGroup = "pagine";

export interface ModuleDef {
  key: string;
  label: string;
  group: ModuleGroup;
  description?: string;
  superOnly?: boolean; // visibile/abilitabile solo per super_admin (non si toggla per le org)
}

export const MODULES: ModuleDef[] = [
  // === Pagine ===
  { key: "amministrazione", label: "Amministrazione", group: "pagine", description: "Prima Nota IVA, BiSuite admin" },
  { key: "controllo_gestione", label: "Controllo di Gestione", group: "pagine", description: "Spese mensili, anagrafiche per Ragione Sociale, KPI" },
  { key: "drms_commissioning", label: "DRMS Commissioning", group: "pagine", description: "Dashboard estratto conto provvigionale" },
  { key: "gara_dashboard", label: "Dashboard Gara", group: "pagine", description: "Dashboard gara reale" },
  { key: "gara_configurazione", label: "Configurazione Gara", group: "pagine" },
  { key: "incentivazione_interna", label: "Incentivazione Interna", group: "pagine", description: "Gare addetto: valenze + Accessori/Servizi live, sblocco gara" },
  { key: "vendite_bisuite", label: "Vendite BiSuite", group: "pagine" },
  { key: "customer_journey", label: "Customer Journey", group: "pagine", description: "Cross-sell strutturato sui clienti da nuova attivazione mobile" },
  { key: "mappatura_bisuite", label: "Mappatura BiSuite", group: "pagine", superOnly: true },
  { key: "simulatore", label: "Simulatore Preventivi", group: "pagine" },
  { key: "tabelle_calcolo", label: "Tabelle Calcolo", group: "pagine" },
];

export type ModuleKey = (typeof MODULES)[number]["key"];

export const MODULE_KEYS: string[] = MODULES.map((m) => m.key);

// Default = tutti abilitati (true). Usato sia in DB che lato client come fallback.
export function defaultEnabledModules(): Record<string, boolean> {
  return Object.fromEntries(MODULES.map((m) => [m.key, true]));
}

// === Brand gating (Task #279) ===
// Moduli legati agli incentivi/dati WindTre: visibili solo se l'org ha il
// brand WindTre associato. Fallback sicuro: org SENZA alcun brand associato
// => nessun filtro (comportamento attuale).
export const WINDTRE_GATED_MODULES: string[] = [
  "simulatore",
  "tabelle_calcolo",
  "gara_dashboard",
  "gara_configurazione",
  "drms_commissioning",
  "incentivazione_interna",
  "vendite_bisuite",
  "customer_journey",
];

// Riconosce il brand WindTre in modo tollerante: "WindTre", "Wind Tre",
// "WIND3", "W3", "WindTre Business", ecc.
export function isWindtreBrandName(name: string): boolean {
  const norm = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return norm.includes("windtre") || norm.includes("wind3") || norm === "w3" || norm.startsWith("w3");
}

// True se il modulo è consentito dai brand associati all'org.
// - modulo non brand-gated => sempre true
// - org senza brand associati (array vuoto/null) => true (fallback: nessun filtro)
// - org con almeno un brand => i moduli WindTre richiedono il brand WindTre
export function isModuleAllowedForBrands(
  brandNames: string[] | null | undefined,
  key: string,
): boolean {
  if (!WINDTRE_GATED_MODULES.includes(key)) return true;
  if (!brandNames || brandNames.length === 0) return true;
  return brandNames.some(isWindtreBrandName);
}

// Restituisce true se il modulo è abilitato per la org.
// Se la chiave non è presente nel record => true (retro-compat / nuova chiave).
export function isModuleEnabled(
  enabledModules: Record<string, boolean> | null | undefined,
  key: string,
): boolean {
  if (!enabledModules) return true;
  if (!(key in enabledModules)) return true;
  return enabledModules[key] !== false;
}
