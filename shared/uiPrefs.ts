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
