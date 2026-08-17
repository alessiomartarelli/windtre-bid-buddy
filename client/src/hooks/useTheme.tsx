import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { type AccentChoice, DEFAULT_ACCENT, applyAccentVars, accentEquals, ACCENT_PRESETS, hexToHsl } from "@/lib/appearance";
import { apiUrl } from "@/lib/basePath";

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

const STORAGE_KEY = "mystoredesk-theme";
const ACCENT_STORAGE_KEY = "mystoredesk-accent";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
  accent: AccentChoice;
  setAccent: (accent: AccentChoice) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
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
  if (typeof window === "undefined") return DEFAULT_ACCENT;
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
  try { return localStorage.getItem(ACCENT_STORAGE_KEY) != null; } catch { return false; }
}

function applyTheme(theme: Theme): "light" | "dark" {
  const isDark = theme === "dark" || (theme === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", isDark);
  return isDark ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme());
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() =>
    typeof window === "undefined" ? "light" : applyTheme(getStoredTheme()),
  );
  const [accent, setAccentState] = useState<AccentChoice>(() => getStoredAccent());

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignora: se non possiamo persistere, il tema resta comunque applicato.
    }
    setResolvedTheme(applyTheme(next));
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

  // Applica/riapplica la palette quando cambia accent o light/dark (i valori
  // del primario differiscono tra i due temi).
  useEffect(() => {
    applyAccentVars(accent, resolvedTheme === "dark");
  }, [accent, resolvedTheme]);

  // Riapplica quando cambia il tema scelto (es. sync da altra tab).
  useEffect(() => {
    setResolvedTheme(applyTheme(theme));
  }, [theme]);

  // In modalità "system" segui le variazioni della preferenza OS in tempo reale.
  useEffect(() => {
    if (theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolvedTheme(applyTheme("system"));
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [theme]);

  // Sincronizza la scelta tra più schede aperte.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setThemeState(getStoredTheme());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, accent, setAccent }}>
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
