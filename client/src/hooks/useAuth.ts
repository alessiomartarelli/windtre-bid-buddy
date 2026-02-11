import { useState, useEffect, useCallback } from 'react';

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

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = useCallback(async () => {
    try {
      const response = await fetch('/api/user', { credentials: 'include' });
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

  const signIn = async (email: string, password: string) => {
    // Not used with Replit Auth - redirect to /api/login
    window.location.href = '/api/login';
    return { error: null };
  };

  const signUp = async (email: string, password: string, fullName: string, organizationName: string) => {
    // Not used with Replit Auth
    window.location.href = '/api/login';
    return { error: null };
  };

  const signOut = async () => {
    window.location.href = '/api/logout';
    return { error: null };
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
