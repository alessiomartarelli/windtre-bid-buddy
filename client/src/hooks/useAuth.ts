import { useState, useEffect, useCallback } from 'react';
import { apiUrl } from "@/lib/basePath";
import {
  authSessionVersion,
  clearAppearanceAuthSession,
  markAuthenticatedSessionUser,
} from "@/lib/uiPrefsStorage";

interface Profile {
  id: string;
  organization_id: string | null;
  organizationId: string | null;
  full_name: string | null;
  fullName: string | null;
  email: string | null;
  role: string;
  profileImageUrl: string | null;
  emailNotificationsDisabled?: boolean;
  moduliConsentiti?: string[] | null;
  uiPrefs?: {
    theme?: string;
    accent?: { type: 'preset'; id: string } | { type: 'custom'; hex: string };
    scheme?: string;
    dashboardStyle?: string;
    salesStyle?: string;
  } | null;
}

interface Organization {
  id: string;
  name: string;
  enabledModules?: Record<string, boolean> | null;
}

interface OrganizationBrand {
  id: string;
  name: string;
}

interface User {
  id: string;
  email: string | null;
}

interface AuthError {
  message: string;
}

// Evento globale emesso quando arriva un profilo autenticato (fetch/login/
// signup). Serve a componenti singleton (es. UiPrefsSync) che non condividono
// lo stato di questa istanza di useAuth (ogni chiamata è un fetcher isolato).
export const AUTH_PROFILE_EVENT = 'mystoredesk:auth-profile';
export const AUTH_CLEARED_EVENT = 'mystoredesk:auth-cleared';

function emitAuthProfile(data: any) {
  try {
    window.dispatchEvent(new CustomEvent(AUTH_PROFILE_EVENT, { detail: data }));
  } catch {
    // ambiente senza window/CustomEvent: nessun sync
  }
}

function emitAuthCleared() {
  try {
    window.dispatchEvent(new CustomEvent(AUTH_CLEARED_EVENT));
  } catch {
    // ambiente senza window/CustomEvent
  }
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [organizationBrands, setOrganizationBrands] = useState<OrganizationBrand[]>([]);
  const [loading, setLoading] = useState(true);

  const applyAuthProfile = useCallback((data: any) => {
    setUser({ id: data.id, email: data.email });
    setProfile({
      ...data,
      full_name: data.fullName,
      organization_id: data.organizationId,
    });
    setOrganization(data.organization ?? null);
    setOrganizationBrands(Array.isArray(data.organizationBrands) ? data.organizationBrands : []);
  }, []);

  const fetchUser = useCallback(async () => {
    const requestSessionVersion = authSessionVersion();
    try {
      const response = await fetch(apiUrl('/api/user'), { credentials: 'include' });
      if (response.status === 401) {
        if (clearAppearanceAuthSession(requestSessionVersion)) emitAuthCleared();
        setUser(null);
        setProfile(null);
        setOrganization(null);
        setOrganizationBrands([]);
        setLoading(false);
        return;
      }
      if (!response.ok) throw new Error('Failed to fetch user');
      
      const data = await response.json();
      markAuthenticatedSessionUser(data.id);
      applyAuthProfile(data);
      emitAuthProfile(data);
    } catch (error) {
      console.error('Error fetching user:', error);
      setUser(null);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [applyAuthProfile]);

  useEffect(() => {
    fetchUser();
    const handleAuthProfile = (event: Event) => {
      const data = (event as CustomEvent).detail;
      if (data?.id) applyAuthProfile(data);
    };
    window.addEventListener(AUTH_PROFILE_EVENT, handleAuthProfile);
    return () => window.removeEventListener(AUTH_PROFILE_EVENT, handleAuthProfile);
  }, [applyAuthProfile, fetchUser]);

  const signIn = async (email: string, password: string): Promise<{ error: AuthError | null }> => {
    try {
      const response = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const data = await response.json();
        return { error: { message: data.error || 'Errore durante il login' } };
      }

      const data = await response.json();
      markAuthenticatedSessionUser(data.id, true);
      applyAuthProfile(data);
      emitAuthProfile(data);
      return { error: null };
    } catch (error) {
      return { error: { message: 'Errore di connessione' } };
    }
  };

  const signUp = async (email: string, password: string, fullName: string, organizationName: string): Promise<{ error: AuthError | null }> => {
    try {
      const response = await fetch(apiUrl('/api/auth/signup'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, fullName, organizationName }),
      });

      if (!response.ok) {
        const data = await response.json();
        return { error: { message: data.error || 'Errore durante la registrazione' } };
      }

      const data = await response.json();
      markAuthenticatedSessionUser(data.id, true);
      applyAuthProfile(data);
      emitAuthProfile(data);
      return { error: null };
    } catch (error) {
      return { error: { message: 'Errore di connessione' } };
    }
  };

  const signOut = async (): Promise<{ error: AuthError | null }> => {
    try {
      await fetch(apiUrl('/api/auth/logout'), {
        method: 'POST',
        credentials: 'include',
      });
      setUser(null);
      setProfile(null);
      setOrganization(null);
      setOrganizationBrands([]);
      clearAppearanceAuthSession();
      emitAuthCleared();
      return { error: null };
    } catch (error) {
      return { error: { message: 'Errore durante il logout' } };
    }
  };

  return {
    user,
    session: user ? { user } : null,
    profile,
    organization,
    organizationBrands,
    loading,
    signIn,
    signUp,
    signOut,
    refreshUser: fetchUser,
  };
}
