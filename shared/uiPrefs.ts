// Preferenze UI condivise client/server (Task #407).
// Gli id dei preset palette accettati dal server DEVONO combaciare con
// client/src/lib/appearance.ts (e con la tabella nel pre-paint script di
// client/index.html).
export const ACCENT_PRESET_IDS = [
  "indigo",
  "blue",
  "teal",
  "emerald",
  "violet",
  "fuchsia",
  "rose",
  "amber",
  "slate",
  "w3",
] as const;

export type AccentPresetId = (typeof ACCENT_PRESET_IDS)[number];

export const THEME_IDS = ["light", "dark", "system"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

// Task #461 — schema visivo GLOBALE dell'app (skin). "standard" segue il
// tema base chiaro/scuro/sistema; gli altri applicano la loro pelle a tutte
// le pagine (shell inclusa). Prisma Light forza il chiaro, Midnight Violet
// il dark. Nuovi schemi futuri vanno aggiunti qui + appearance client +
// pre-paint in client/index.html.
export const SCHEME_IDS = ["standard", "prisma-light", "midnight-violet"] as const;
export type SchemeId = (typeof SCHEME_IDS)[number];

// Chiavi legacy (Task #453/#458): Prisma/Midnight erano composizioni per
// singola pagina. Restano accettate dal PATCH per compatibilità con client
// vecchi e per migrare le preferenze già salvate in profiles.ui_prefs.
export const DASHBOARD_STYLE_IDS = ["standard", "prisma-light"] as const;
export type DashboardStyleId = (typeof DASHBOARD_STYLE_IDS)[number];

export const SALES_STYLE_IDS = ["standard", "midnight-violet"] as const;
export type SalesStyleId = (typeof SALES_STYLE_IDS)[number];

/** Risolve lo schema effettivo da prefs nuove o legacy. */
export function resolveSchemeFromPrefs(prefs: {
  theme?: string | null;
  scheme?: string | null;
  dashboardStyle?: string | null;
  salesStyle?: string | null;
} | null | undefined): SchemeId | null {
  if (!prefs) return null;
  if (prefs.scheme && (SCHEME_IDS as readonly string[]).includes(prefs.scheme)) {
    return prefs.scheme as SchemeId;
  }
  if (prefs.dashboardStyle === "prisma-light") return "prisma-light";
  if (prefs.salesStyle === "midnight-violet") return "midnight-violet";
  // Primissima preview Prisma: il valore era salvato impropriamente nel
  // campo theme. Va ancora migrato per non perdere la scelta di quegli utenti.
  if (prefs.theme === "prisma-light") return "prisma-light";
  if (prefs.dashboardStyle === "standard" || prefs.salesStyle === "standard") return "standard";
  return null;
}
