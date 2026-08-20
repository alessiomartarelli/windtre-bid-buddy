// Sync preferenze aspetto per-utente (Task #407).
//
// Regole:
// - La cache locale (localStorage) è solo un mirror per il pre-paint: la
//   sorgente di verità per-utente è profiles.ui_prefs sul server (ogni cambio
//   locale viene specchiato dal ThemeProvider via PATCH /api/auth/ui-prefs).
// - Un marker localStorage ricorda per QUALE utente è stata scritta la cache:
//   se si autentica un utente diverso nello stesso browser, le sue preferenze
//   server vengono applicate (o si torna ai default se non ne ha), senza
//   ereditare l'aspetto dell'utente precedente.
// - Ascolta l'evento globale AUTH_PROFILE_EVENT (emesso da useAuth su fetch,
//   login e signup), così il sync scatta anche al login "fresco" senza reload.
import { useEffect, useRef } from "react";
import { AUTH_CLEARED_EVENT, AUTH_PROFILE_EVENT } from "@/hooks/useAuth";
import {
  getStoredAccent,
  getStoredScheme,
  getStoredTheme,
  useTheme,
  hasStoredAccent,
  hasStoredScheme,
  type Scheme,
  type Theme,
} from "@/hooks/useTheme";
import { ACCENT_PRESETS, DEFAULT_ACCENT, hexToHsl, type AccentChoice } from "@/lib/appearance";
import { resolveSchemeFromPrefs } from "@shared/uiPrefs";
import {
  assignPrefsMirrorToUser,
  clearUiPrefsMirror,
  markAuthenticatedSessionUser,
  storedPrefsUser,
} from "@/lib/uiPrefsStorage";

function hasStoredTheme(): boolean {
  try { return localStorage.getItem("mystoredesk-theme") != null && getStoredTheme() !== "system"; } catch { return false; }
}

function validAccent(a: any): AccentChoice | null {
  if (a?.type === "preset" && ACCENT_PRESETS.some(p => p.id === a.id)) return a;
  if (a?.type === "custom" && typeof a.hex === "string" && hexToHsl(a.hex)) return a;
  return null;
}

export function UiPrefsSync() {
  const { setTheme, setAccent, setScheme, resetAppearance } = useTheme();
  const appliedFor = useRef<string | null>(null);

  useEffect(() => {
    const onProfile = (e: Event) => {
      const data = (e as CustomEvent).detail as
        | { id?: string; uiPrefs?: { theme?: string; accent?: any; scheme?: string; dashboardStyle?: string; salesStyle?: string } | null }
        | undefined;
      if (!data?.id || appliedFor.current === data.id) return;
      appliedFor.current = data.id;

      const prefs = data.uiPrefs ?? {};
      const sameUser = storedPrefsUser() === data.id;
      markAuthenticatedSessionUser(data.id);
      if (!sameUser) clearUiPrefsMirror();
      assignPrefsMirrorToUser(data.id);
      const theme = prefs.theme && ["light", "dark", "system"].includes(prefs.theme)
        ? (prefs.theme as Theme) : null;
      const accent = validAccent(prefs.accent);
      // Schema globale (Task #461), con fallback alle chiavi legacy
      // per-pagina salvate prima della migrazione.
      const scheme = resolveSchemeFromPrefs(prefs) as Scheme | null;

      // Il server è la fonte primaria. Un campo locale viene riusato soltanto
      // se appartiene allo stesso utente e il profilo server non lo contiene
      // (es. PATCH precedente fallita offline). setScheme rende inoltre
      // persistente la migrazione da dashboardStyle/salesStyle/theme legacy.
      setTheme(theme ?? (sameUser && hasStoredTheme() ? getStoredTheme() : "system"));
      setAccent(accent ?? (sameUser && hasStoredAccent() ? getStoredAccent() : DEFAULT_ACCENT));
      setScheme(scheme ?? (sameUser && hasStoredScheme() ? getStoredScheme() : "standard"));
    };
    const onAuthCleared = () => {
      appliedFor.current = null;
      resetAppearance();
    };
    window.addEventListener(AUTH_PROFILE_EVENT, onProfile);
    window.addEventListener(AUTH_CLEARED_EVENT, onAuthCleared);
    return () => {
      window.removeEventListener(AUTH_PROFILE_EVENT, onProfile);
      window.removeEventListener(AUTH_CLEARED_EVENT, onAuthCleared);
    };
  }, [setTheme, setAccent, setScheme, resetAppearance]);

  return null;
}
