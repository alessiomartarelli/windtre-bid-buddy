import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { type AccentChoice, DEFAULT_ACCENT, applyAccentVars, accentEquals, ACCENT_PRESETS, hexToHsl } from "@/lib/appearance";
import { apiUrl } from "@/lib/basePath";
import { prefsMirrorBelongsToActiveSession } from "@/lib/uiPrefsStorage";

// Persistenza server fire-and-forget: ogni cambio tema/palette viene
// specchiato su /api/auth/ui-prefs. Se l'utente non è autenticato (401) o la
// rete fallisce, la scelta resta comunque applicata localmente.
function persistUiPrefs(patch: Record<string, unknown>): void {
  try {
    void fetch(apiUrl("/api/auth/ui-prefs"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(patch),
    }).catch(() => {});
  } catch {
    // ambiente senza fetch: solo locale
  }
}

export type Theme = "light" | "dark" | "system";
// Task #461 — schema visivo GLOBALE (skin) dell'intera app. "standard"
// segue il tema base; "prisma-light" forza la pelle chiara editoriale;
// "midnight-violet" forza la pelle scura viola. Vale su tutte le pagine,
// menu laterale e overlay inclusi.
export type Scheme = "standard" | "prisma-light" | "midnight-violet";

const STORAGE_KEY = "mystoredesk-theme";
const ACCENT_STORAGE_KEY = "mystoredesk-accent";
const SCHEME_STORAGE_KEY = "mystoredesk-scheme";
// Chiavi legacy (Task #453/#458) da cui migrare la scelta esistente.
const LEGACY_DASHBOARD_STYLE_KEY = "mystoredesk-dashboard-style";
const LEGACY_SALES_STYLE_KEY = "mystoredesk-sales-style";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
  accent: AccentChoice;
  setAccent: (accent: AccentChoice) => void;
  scheme: Scheme;
  setScheme: (scheme: Scheme) => void;
  resetAppearance: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function getStoredTheme(): Theme {
  if (typeof window === "undefined" || !prefsMirrorBelongsToActiveSession()) return "system";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
    // Compatibilità con la preview iniziale di Task #453: la vecchia chiave
    // non deve alterare il tema base.
    if (stored === "prisma-light") return "light";
  } catch {
    // localStorage non disponibile (SSR / privacy): default a "system".
  }
  return "system";
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function getStoredAccent(): AccentChoice {
  if (typeof window === "undefined" || !prefsMirrorBelongsToActiveSession()) return DEFAULT_ACCENT;
  try {
    const raw = localStorage.getItem(ACCENT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AccentChoice;
      if (parsed?.type === "preset" && ACCENT_PRESETS.some(p => p.id === parsed.id)) return parsed;
      if (parsed?.type === "custom" && hexToHsl(parsed.hex)) return parsed;
    }
  } catch {
    // storage non disponibile o corrotto: default
  }
  return DEFAULT_ACCENT;
}

export function hasStoredAccent(): boolean {
  if (!prefsMirrorBelongsToActiveSession()) return false;
  try { return localStorage.getItem(ACCENT_STORAGE_KEY) != null; } catch { return false; }
}

export function getStoredScheme(): Scheme {
  if (typeof window === "undefined" || !prefsMirrorBelongsToActiveSession()) return "standard";
  try {
    const stored = localStorage.getItem(SCHEME_STORAGE_KEY);
    if (stored === "prisma-light" || stored === "midnight-violet" || stored === "standard") {
      return stored;
    }
    // Migrazione dalle chiavi legacy per-pagina (Task #453/#458): la scelta
    // esistente diventa lo schema globale.
    if (localStorage.getItem(LEGACY_DASHBOARD_STYLE_KEY) === "prisma-light") return "prisma-light";
    if (localStorage.getItem(LEGACY_SALES_STYLE_KEY) === "midnight-violet") return "midnight-violet";
    if (localStorage.getItem(STORAGE_KEY) === "prisma-light") return "prisma-light";
  } catch {
    // storage non disponibile: schema standard
  }
  return "standard";
}

export function hasStoredScheme(): boolean {
  if (!prefsMirrorBelongsToActiveSession()) return false;
  try {
    return localStorage.getItem(SCHEME_STORAGE_KEY) != null
      || localStorage.getItem(LEGACY_DASHBOARD_STYLE_KEY) != null
      || localStorage.getItem(LEGACY_SALES_STYLE_KEY) != null
      || localStorage.getItem(STORAGE_KEY) === "prisma-light";
  } catch {
    return false;
  }
}

// Unica fonte di verità del tema effettivo (deve restare allineata al
// pre-paint di client/index.html). Gli schemi hanno precedenza deterministica
// sul tema base: Prisma Light è sempre chiaro, Midnight Violet sempre scuro,
// "standard" segue chiaro/scuro/sistema.
function applyEffectiveTheme(theme: Theme, scheme: Scheme): "light" | "dark" {
  const isDark = scheme === "midnight-violet"
    || (scheme !== "prisma-light" && (
      theme === "dark" || (theme === "system" && systemPrefersDark())
    ));

  if (scheme === "standard") {
    document.documentElement.removeAttribute("data-skin");
  } else {
    document.documentElement.setAttribute("data-skin", scheme);
  }
  document.documentElement.classList.toggle("dark", isDark);
  return isDark ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const initialScheme = getStoredScheme();
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme());
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() =>
    typeof window === "undefined"
      ? "light"
      : applyEffectiveTheme(getStoredTheme(), initialScheme),
  );
  const [accent, setAccentState] = useState<AccentChoice>(() => getStoredAccent());
  const [scheme, setSchemeState] = useState<Scheme>(() => initialScheme);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignora: se non possiamo persistere, il tema resta comunque applicato.
    }
    persistUiPrefs({ theme: next });
  }, []);

  const setAccent = useCallback((next: AccentChoice) => {
    setAccentState(prev => (accentEquals(prev, next) ? prev : next));
    try {
      localStorage.setItem(ACCENT_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignora: la palette resta comunque applicata per la sessione.
    }
    persistUiPrefs({ accent: next });
  }, []);

  const setScheme = useCallback((next: Scheme) => {
    setSchemeState(next);
    try {
      localStorage.setItem(SCHEME_STORAGE_KEY, next);
      // Completa la migrazione dalle chiavi legacy per-pagina.
      localStorage.removeItem(LEGACY_DASHBOARD_STYLE_KEY);
      localStorage.removeItem(LEGACY_SALES_STYLE_KEY);
      if (localStorage.getItem(STORAGE_KEY) === "prisma-light") {
        localStorage.setItem(STORAGE_KEY, "light");
      }
    } catch {
      // La scelta resta applicata per la sessione.
    }
    persistUiPrefs({ scheme: next });
  }, []);

  const resetAppearance = useCallback(() => {
    setThemeState("system");
    setAccentState(DEFAULT_ACCENT);
    setSchemeState("standard");
  }, []);

  // Applica/riapplica la palette quando cambia accent o light/dark (i valori
  // del primario differiscono tra i due temi).
  useEffect(() => {
    applyAccentVars(accent, resolvedTheme === "dark");
  }, [accent, resolvedTheme]);

  // Applica il tema effettivo da una sola fonte di verità: schema globale
  // indipendente dalla route.
  useEffect(() => {
    setResolvedTheme(applyEffectiveTheme(theme, scheme));
  }, [theme, scheme]);

  // In modalità "system" segui le variazioni della preferenza OS in tempo reale.
  useEffect(() => {
    if (theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolvedTheme(applyEffectiveTheme("system", scheme));
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [theme, scheme]);

  // Sincronizza la scelta tra più schede aperte.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setThemeState(getStoredTheme());
      } else if (
        e.key === SCHEME_STORAGE_KEY
        || e.key === LEGACY_DASHBOARD_STYLE_KEY
        || e.key === LEGACY_SALES_STYLE_KEY
      ) {
        setSchemeState(getStoredScheme());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <ThemeContext.Provider value={{
      theme,
      resolvedTheme,
      setTheme,
      accent,
      setAccent,
      scheme,
      setScheme,
      resetAppearance,
    }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme deve essere usato dentro un <ThemeProvider>");
  }
  return ctx;
}
