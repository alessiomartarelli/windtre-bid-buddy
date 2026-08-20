export const UI_PREFS_USER_KEY = "mystoredesk-prefs-user";
export const AUTH_SESSION_USER_KEY = "mystoredesk-auth-session-user";
const AUTH_SESSION_VERSION_KEY = "mystoredesk-auth-session-version";

export const UI_PREFS_MIRROR_KEYS = [
  "mystoredesk-theme",
  "mystoredesk-accent",
  "mystoredesk-scheme",
  "mystoredesk-dashboard-style",
  "mystoredesk-sales-style",
] as const;

export function storedPrefsUser(): string | null {
  try {
    return localStorage.getItem(UI_PREFS_USER_KEY);
  } catch {
    return null;
  }
}

export function activeAuthSessionUser(): string | null {
  try {
    return sessionStorage.getItem(AUTH_SESSION_USER_KEY);
  } catch {
    return null;
  }
}

export function authSessionVersion(): string {
  try {
    return sessionStorage.getItem(AUTH_SESSION_VERSION_KEY) ?? "0";
  } catch {
    return "0";
  }
}

export function markAuthenticatedSessionUser(id: string, forceNewSession = false): void {
  try {
    const previous = sessionStorage.getItem(AUTH_SESSION_USER_KEY);
    if (forceNewSession || previous !== id) {
      const current = Number(sessionStorage.getItem(AUTH_SESSION_VERSION_KEY) ?? "0");
      sessionStorage.setItem(AUTH_SESSION_VERSION_KEY, String(Number.isFinite(current) ? current + 1 : 1));
    }
    sessionStorage.setItem(AUTH_SESSION_USER_KEY, id);
  } catch {
    // Il sync server resta operativo anche quando lo storage è indisponibile.
  }
}

export function assignPrefsMirrorToUser(id: string): void {
  try {
    localStorage.setItem(UI_PREFS_USER_KEY, id);
  } catch {
    // Solo sessione.
  }
}

export function prefsMirrorBelongsToActiveSession(): boolean {
  try {
    if (/\/auth\/?$/.test(window.location.pathname)) return false;
  } catch {
    return false;
  }
  const owner = storedPrefsUser();
  const active = activeAuthSessionUser();
  return !!owner && !!active && owner === active;
}

export function clearUiPrefsMirror(): void {
  try {
    for (const key of UI_PREFS_MIRROR_KEYS) localStorage.removeItem(key);
    localStorage.removeItem(UI_PREFS_USER_KEY);
  } catch {
    // Il logout/session reset resta valido anche senza storage.
  }
}

export function clearAppearanceAuthSession(expectedVersion?: string): boolean {
  try {
    if (expectedVersion != null && authSessionVersion() !== expectedVersion) return false;
    sessionStorage.removeItem(AUTH_SESSION_USER_KEY);
    const current = Number(sessionStorage.getItem(AUTH_SESSION_VERSION_KEY) ?? "0");
    sessionStorage.setItem(AUTH_SESSION_VERSION_KEY, String(Number.isFinite(current) ? current + 1 : 1));
  } catch {
    // Continua comunque con la pulizia del mirror locale.
  }
  clearUiPrefsMirror();
  return true;
}