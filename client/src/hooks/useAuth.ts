import { useState, useEffect, useCallback } from 'react';
import { apiUrl } from "@/lib/basePath";

interface Profile {
  id: string;
  organization_id: string | null;
  organizationId: string | null;
  full_name: string | null;
  fullName: string | null;
  email: string | null;
  role: string;
  profileImageUrl: string | null;
}

interface Organization {
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

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/api/user'), { credentials: 'include' });
      if (response.status === 401) {
        setUser(null);
        setProfile(null);
        setOrganization(null);
        setLoading(false);
        return;
      }
      if (!response.ok) throw new Error('Failed to fetch user');
      
      const data = await response.json();
      setUser({ id: data.id, email: data.email });
      setProfile({
        ...data,
        full_name: data.fullName,
        organization_id: data.organizationId,
      });
      if (data.organization) {
        setOrganization(data.organization);
      }
    } catch (error) {
      console.error('Error fetching user:', error);
      setUser(null);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

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
      setUser({ id: data.id, email: data.email });
      setProfile({
        ...data,
        full_name: data.fullName,
        organization_id: data.organizationId,
      });
      if (data.organization) {
        setOrganization(data.organization);
      }
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
      setUser({ id: data.id, email: data.email });
      setProfile({
        ...data,
        full_name: data.fullName,
        organization_id: data.organizationId,
      });
      if (data.organization) {
        setOrganization(data.organization);
      }
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
    loading,
    signIn,
    signUp,
    signOut,
  };
}
