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

// Task #453 — Prisma Light è una composizione della sola Dashboard Gara
// Reale, non un quarto tema globale. La preferenza resta separata dal tema
// base, così le altre pagine continuano a rispettare chiaro/scuro/sistema.
export const DASHBOARD_STYLE_IDS = ["standard", "prisma-light"] as const;
export type DashboardStyleId = (typeof DASHBOARD_STYLE_IDS)[number];
