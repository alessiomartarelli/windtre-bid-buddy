import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
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
export type DashboardStyle = "standard" | "prisma-light";
export type SalesStyle = "standard" | "midnight-violet";

const STORAGE_KEY = "mystoredesk-theme";
const ACCENT_STORAGE_KEY = "mystoredesk-accent";
const DASHBOARD_STYLE_STORAGE_KEY = "mystoredesk-dashboard-style";
const SALES_STYLE_STORAGE_KEY = "mystoredesk-sales-style";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
  accent: AccentChoice;
  setAccent: (accent: AccentChoice) => void;
  dashboardStyle: DashboardStyle;
  setDashboardStyle: (style: DashboardStyle) => void;
  salesStyle: SalesStyle;
  setSalesStyle: (style: SalesStyle) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
    // Compatibilità con la preview iniziale di Task #453: la vecchia chiave
    // non deve rendere "prisma-light" un tema globale.
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

export function getStoredDashboardStyle(): DashboardStyle {
  if (typeof window === "undefined") return "standard";
  try {
    const stored = localStorage.getItem(DASHBOARD_STYLE_STORAGE_KEY);
    if (stored === "prisma-light" || stored === "standard") return stored;
    // Migrazione locale dalla preview iniziale.
    if (localStorage.getItem(STORAGE_KEY) === "prisma-light") return "prisma-light";
  } catch {
    // storage non disponibile: layout standard
  }
  return "standard";
}

export function hasStoredDashboardStyle(): boolean {
  try {
    return localStorage.getItem(DASHBOARD_STYLE_STORAGE_KEY) != null
      || localStorage.getItem(STORAGE_KEY) === "prisma-light";
  } catch {
    return false;
  }
}

export function getStoredSalesStyle(): SalesStyle {
  if (typeof window === "undefined") return "standard";
  try {
    const stored = localStorage.getItem(SALES_STYLE_STORAGE_KEY);
    if (stored === "midnight-violet" || stored === "standard") return stored;
  } catch {
    // storage non disponibile: composizione standard
  }
  return "standard";
}

export function hasStoredSalesStyle(): boolean {
  try { return localStorage.getItem(SALES_STYLE_STORAGE_KEY) != null; } catch { return false; }
}

function applyEffectiveTheme(
  theme: Theme,
  dashboardStyle: DashboardStyle,
  salesStyle: SalesStyle,
  location: string,
): "light" | "dark" {
  const isPrismaDashboard =
    dashboardStyle === "prisma-light" && location === "/dashboard-gara-reale";
  const isMidnightSales =
    salesStyle === "midnight-violet" && location === "/vendite-bisuite";
  const isDark = isMidnightSales
    || (!isPrismaDashboard && (
      theme === "dark" || (theme === "system" && systemPrefersDark())
    ));

  if (isPrismaDashboard) {
    document.documentElement.setAttribute("data-skin", "prisma-light");
  } else if (isMidnightSales) {
    document.documentElement.setAttribute("data-skin", "midnight-violet");
  } else {
    document.documentElement.removeAttribute("data-skin");
  }
  document.documentElement.classList.toggle("dark", isDark);
  return isDark ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const initialDashboardStyle = getStoredDashboardStyle();
  const initialSalesStyle = getStoredSalesStyle();
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme());
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() =>
    typeof window === "undefined"
      ? "light"
      : applyEffectiveTheme(
        getStoredTheme(),
        initialDashboardStyle,
        initialSalesStyle,
        location,
      ),
  );
  const [accent, setAccentState] = useState<AccentChoice>(() => getStoredAccent());
  const [dashboardStyle, setDashboardStyleState] = useState<DashboardStyle>(
    () => initialDashboardStyle,
  );
  const [salesStyle, setSalesStyleState] = useState<SalesStyle>(
    () => initialSalesStyle,
  );

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

  const setDashboardStyle = useCallback((next: DashboardStyle) => {
    setDashboardStyleState(next);
    try {
      localStorage.setItem(DASHBOARD_STYLE_STORAGE_KEY, next);
      // Completa la migrazione dalla preview iniziale.
      if (localStorage.getItem(STORAGE_KEY) === "prisma-light") {
        localStorage.setItem(STORAGE_KEY, "light");
      }
    } catch {
      // La scelta resta applicata per la sessione.
    }
    persistUiPrefs({ dashboardStyle: next });
  }, []);

  const setSalesStyle = useCallback((next: SalesStyle) => {
    setSalesStyleState(next);
    try {
      localStorage.setItem(SALES_STYLE_STORAGE_KEY, next);
    } catch {
      // La scelta resta applicata per la sessione.
    }
    persistUiPrefs({ salesStyle: next });
  }, []);

  // Applica/riapplica la palette quando cambia accent o light/dark (i valori
  // del primario differiscono tra i due temi).
  useEffect(() => {
    applyAccentVars(accent, resolvedTheme === "dark");
  }, [accent, resolvedTheme]);

  // Applica il tema effettivo da una sola fonte di verità. Le composizioni
  // pagina-specifiche hanno precedenza sul tema base senza sovrascriverlo.
  useEffect(() => {
    setResolvedTheme(applyEffectiveTheme(
      theme,
      dashboardStyle,
      salesStyle,
      location,
    ));
  }, [theme, dashboardStyle, salesStyle, location]);

  // In modalità "system" segui le variazioni della preferenza OS in tempo reale.
  useEffect(() => {
    if (theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolvedTheme(applyEffectiveTheme(
      "system",
      dashboardStyle,
      salesStyle,
      location,
    ));
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [theme, dashboardStyle, salesStyle, location]);

  // Sincronizza la scelta tra più schede aperte.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setThemeState(getStoredTheme());
      } else if (e.key === DASHBOARD_STYLE_STORAGE_KEY) {
        setDashboardStyleState(getStoredDashboardStyle());
      } else if (e.key === SALES_STYLE_STORAGE_KEY) {
        setSalesStyleState(getStoredSalesStyle());
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
      dashboardStyle,
      setDashboardStyle,
      salesStyle,
      setSalesStyle,
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
