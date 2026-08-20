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

// Temi accettati dal server (Task #453). "prisma-light" è la variante
// editoriale chiara "Prisma Light": si comporta come un tema chiaro ma
// attiva la composizione dedicata della Dashboard Gara Reale via
// html[data-skin="prisma-light"]. Tenere allineato con
// client/src/hooks/useTheme.tsx e il pre-paint di client/index.html.
export const THEME_IDS = ["light", "dark", "system", "prisma-light"] as const;
export type ThemeId = (typeof THEME_IDS)[number];
