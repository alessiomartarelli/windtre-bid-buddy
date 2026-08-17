// Sistema temi runtime (Task #407): palette brand personalizzabile per utente.
// I token colore sono CSS variables in index.css; qui vengono sovrascritti a
// runtime in base alla palette scelta (preset o colore libero). I colori
// SEMANTICI (warning, destructive, ● live, categorie) NON dipendono dal brand
// e non vengono toccati (vedi memoria rebrand-color-semantics).

export type AccentChoice =
  | { type: "preset"; id: string }
  | { type: "custom"; hex: string };

export interface UiPrefs {
  theme?: "light" | "dark" | "system";
  accent?: AccentChoice;
}

interface Hsl { h: number; s: number; l: number }

export interface AccentPreset {
  id: string;
  label: string;
  /** Colore rappresentativo per lo swatch nelle impostazioni */
  swatch: string;
  light: Hsl; // --primary in tema chiaro
  dark: Hsl;  // --primary in tema scuro (più luminoso)
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: "indigo",  label: "Indaco (default)", swatch: "#6366f1", light: { h: 243, s: 75, l: 59 }, dark: { h: 239, s: 84, l: 67 } },
  { id: "blue",    label: "Blu oceano",       swatch: "#2563eb", light: { h: 221, s: 83, l: 53 }, dark: { h: 217, s: 91, l: 65 } },
  { id: "teal",    label: "Verde acqua",      swatch: "#0d9488", light: { h: 175, s: 84, l: 32 }, dark: { h: 172, s: 66, l: 50 } },
  { id: "emerald", label: "Smeraldo",         swatch: "#059669", light: { h: 161, s: 94, l: 30 }, dark: { h: 158, s: 64, l: 52 } },
  { id: "violet",  label: "Viola",            swatch: "#7c3aed", light: { h: 262, s: 83, l: 58 }, dark: { h: 258, s: 90, l: 66 } },
  { id: "fuchsia", label: "Fucsia",           swatch: "#c026d3", light: { h: 293, s: 69, l: 49 }, dark: { h: 292, s: 84, l: 61 } },
  { id: "rose",    label: "Rosa",             swatch: "#e11d48", light: { h: 347, s: 77, l: 50 }, dark: { h: 351, s: 89, l: 64 } },
  { id: "amber",   label: "Ambra",            swatch: "#d97706", light: { h: 32, s: 95, l: 44 },  dark: { h: 38, s: 92, l: 50 } },
  { id: "slate",   label: "Grigio ardesia",   swatch: "#475569", light: { h: 215, s: 19, l: 35 }, dark: { h: 215, s: 20, l: 65 } },
];

export const DEFAULT_ACCENT: AccentChoice = { type: "preset", id: "indigo" };

export function hexToHsl(hex: string): Hsl | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslStr(c: Hsl): string { return `${c.h} ${c.s}% ${c.l}%`; }

function resolvePrimary(accent: AccentChoice, isDark: boolean): Hsl {
  if (accent.type === "preset") {
    const p = ACCENT_PRESETS.find(p => p.id === accent.id) ?? ACCENT_PRESETS[0];
    return isDark ? p.dark : p.light;
  }
  const base = hexToHsl(accent.hex) ?? ACCENT_PRESETS[0].light;
  if (!isDark) return base;
  // In dark il primario va schiarito per contrasto su sfondi scuri.
  return { ...base, l: Math.min(base.l + 10, 72) };
}

const OVERRIDE_KEYS = [
  "--primary", "--ring", "--brand-indigo", "--accent", "--accent-foreground",
  "--chart-brand-soft", "--chart-brand-strong",
] as const;

/** Variante chiara per serie secondarie dei grafici (es. "cassa"). */
export function chartSoft(primary: Hsl): Hsl {
  return { h: primary.h, s: Math.max(primary.s - 25, 30), l: Math.min(primary.l + 28, 84) };
}

/** Variante scura per evidenziare la selezione nei grafici. */
export function chartStrong(primary: Hsl): Hsl {
  return { h: primary.h, s: primary.s, l: Math.max(primary.l - 25, 18) };
}

/**
 * Applica la palette scelta come override dei token CSS. Con il preset di
 * default rimuove gli override lasciando i valori di index.css (incluso il
 * flip automatico light/dark).
 */
export function applyAccentVars(accent: AccentChoice, isDark: boolean): void {
  const root = document.documentElement;
  const isDefault = accent.type === "preset" && accent.id === "indigo";
  if (isDefault) {
    for (const k of OVERRIDE_KEYS) root.style.removeProperty(k);
    return;
  }
  const primary = resolvePrimary(accent, isDark);
  root.style.setProperty("--primary", hslStr(primary));
  root.style.setProperty("--ring", hslStr(primary));
  root.style.setProperty("--brand-indigo", hslStr(primary));
  root.style.setProperty("--chart-brand-soft", hslStr(chartSoft(primary)));
  root.style.setProperty("--chart-brand-strong", hslStr(chartStrong(primary)));
  if (isDark) {
    // In dark l'accent resta la superficie neutra di index.css.
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-foreground");
  } else {
    root.style.setProperty("--accent", `${primary.h} 100% 97%`);
    root.style.setProperty("--accent-foreground", `${primary.h} 58% 38%`);
  }
}

export function accentEquals(a: AccentChoice | undefined, b: AccentChoice | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.type !== b.type) return false;
  if (a.type === "preset" && b.type === "preset") return a.id === b.id;
  if (a.type === "custom" && b.type === "custom") return a.hex.toLowerCase() === b.hex.toLowerCase();
  return false;
}
