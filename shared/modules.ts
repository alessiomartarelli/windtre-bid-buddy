// Canonical list of toggleable modules per organization.
// `enabledModules` on an organization is a Record<ModuleKey, boolean>.
// When a module is missing from the record it defaults to TRUE (retro-compat).
// `super_admin` always bypasses these flags.

export type ModuleGroup = "pagine" | "prodotti";

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
  { key: "drms_commissioning", label: "DRMS Commissioning", group: "pagine", description: "Dashboard estratto conto provvigionale" },
  { key: "gara_dashboard", label: "Dashboard Gara", group: "pagine", description: "Dashboard gara reale" },
  { key: "gara_configurazione", label: "Configurazione Gara", group: "pagine" },
  { key: "vendite_bisuite", label: "Vendite BiSuite", group: "pagine" },
  { key: "mappatura_bisuite", label: "Mappatura BiSuite", group: "pagine", superOnly: true },
  { key: "simulatore", label: "Simulatore Preventivi", group: "pagine" },
  { key: "tabelle_calcolo", label: "Tabelle Calcolo", group: "pagine" },

  // === Prodotti del wizard simulatore ===
  { key: "prod_mobile", label: "Mobile", group: "prodotti" },
  { key: "prod_fisso", label: "Fisso", group: "prodotti" },
  { key: "prod_partnership_reward", label: "Partnership Reward", group: "prodotti" },
  { key: "prod_energia", label: "Energia", group: "prodotti" },
  { key: "prod_assicurazioni", label: "Assicurazioni", group: "prodotti" },
  { key: "prod_protecta", label: "Protecta", group: "prodotti" },
  { key: "prod_extra_gara_iva", label: "Extra Gara P.IVA", group: "prodotti" },
];

export type ModuleKey = (typeof MODULES)[number]["key"];

export const MODULE_KEYS: string[] = MODULES.map((m) => m.key);

// Default = tutti abilitati (true). Usato sia in DB che lato client come fallback.
export function defaultEnabledModules(): Record<string, boolean> {
  return Object.fromEntries(MODULES.map((m) => [m.key, true]));
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
