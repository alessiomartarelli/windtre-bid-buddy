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
import { AUTH_PROFILE_EVENT } from "@/hooks/useAuth";
import { useTheme, hasStoredAccent, type Theme } from "@/hooks/useTheme";
import { ACCENT_PRESETS, DEFAULT_ACCENT, hexToHsl, type AccentChoice } from "@/lib/appearance";

const PREFS_USER_KEY = "mystoredesk-prefs-user";

function hasStoredTheme(): boolean {
  try { return localStorage.getItem("mystoredesk-theme") != null; } catch { return false; }
}

function storedPrefsUser(): string | null {
  try { return localStorage.getItem(PREFS_USER_KEY); } catch { return null; }
}

function rememberPrefsUser(id: string): void {
  try { localStorage.setItem(PREFS_USER_KEY, id); } catch { /* solo sessione */ }
}

function validAccent(a: any): AccentChoice | null {
  if (a?.type === "preset" && ACCENT_PRESETS.some(p => p.id === a.id)) return a;
  if (a?.type === "custom" && typeof a.hex === "string" && hexToHsl(a.hex)) return a;
  return null;
}

export function UiPrefsSync() {
  const { setTheme, setAccent } = useTheme();
  const appliedFor = useRef<string | null>(null);

  useEffect(() => {
    const onProfile = (e: Event) => {
      const data = (e as CustomEvent).detail as
        | { id?: string; uiPrefs?: { theme?: string; accent?: any } | null }
        | undefined;
      if (!data?.id || appliedFor.current === data.id) return;
      appliedFor.current = data.id;

      const prefs = data.uiPrefs ?? {};
      const sameUser = storedPrefsUser() === data.id;
      const theme = prefs.theme && ["light", "dark", "system", "prisma-light"].includes(prefs.theme)
        ? (prefs.theme as Theme) : null;
      const accent = validAccent(prefs.accent);

      if (sameUser) {
        // Stesso utente del mirror locale: la cache è già sua (e può essere
        // più recente del server). Applica dal server solo ciò che localmente
        // non è mai stato scelto.
        if (theme && !hasStoredTheme()) setTheme(theme);
        if (accent && !hasStoredAccent()) setAccent(accent);
      } else {
        // Utente diverso (o primo utilizzo): le sue preferenze server vincono
        // sempre; in assenza si torna ai default, senza ereditare l'aspetto
        // dell'account precedente.
        setTheme(theme ?? "system");
        setAccent(accent ?? DEFAULT_ACCENT);
      }
      rememberPrefsUser(data.id);
    };
    window.addEventListener(AUTH_PROFILE_EVENT, onProfile);
    return () => window.removeEventListener(AUTH_PROFILE_EVENT, onProfile);
  }, [setTheme, setAccent]);

  return null;
}
