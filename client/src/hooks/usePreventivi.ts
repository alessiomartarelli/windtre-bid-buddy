import { useState, useCallback } from 'react';
import { useAuth } from './useAuth';
import { apiUrl } from "@/lib/basePath";

export interface Preventivo {
  id: string;
  organization_id: string;
  organizationId: string;
  created_by: string;
  createdBy: string;
  name: string;
  data: any;
  created_at: string;
  createdAt: string;
  updated_at: string;
  updatedAt: string;
}

export function usePreventivi() {
  const { user, profile } = useAuth();
  const [preventivi, setPreventivi] = useState<Preventivo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPreventivi = useCallback(async () => {
    if (!user) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(apiUrl('/api/preventivi'), { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      setPreventivi(data.map((p: any) => ({
        ...p,
        organization_id: p.organizationId,
        created_by: p.createdBy,
        created_at: p.createdAt,
        updated_at: p.updatedAt,
      })));
    } catch (err) {
      console.error('Error fetching preventivi:', err);
      setError('Errore nel caricamento dei preventivi');
    } finally {
      setLoading(false);
    }
  }, [user]);

  const createPreventivo = useCallback(async (name: string, data: any) => {
    if (!user) return { error: 'Utente non autenticato' };

    try {
      const response = await fetch(apiUrl('/api/preventivi'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, data }),
      });
      if (!response.ok) throw new Error('Failed to create');
      const newPreventivo = await response.json();
      const mapped = {
        ...newPreventivo,
        organization_id: newPreventivo.organizationId,
        created_by: newPreventivo.createdBy,
        created_at: newPreventivo.createdAt,
        updated_at: newPreventivo.updatedAt,
      };
      setPreventivi(prev => [mapped, ...prev]);
      return { data: mapped };
    } catch (err) {
      return { error: 'Errore nella creazione del preventivo' };
    }
  }, [user]);

  const updatePreventivo = useCallback(async (id: string, name: string, data: any) => {
    if (!user) return { error: 'Utente non autenticato' };

    try {
      const response = await fetch(apiUrl(`/api/preventivi/${id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, data }),
      });
      if (!response.ok) throw new Error('Failed to update');
      const updated = await response.json();
      const mapped = {
        ...updated,
        organization_id: updated.organizationId,
        created_by: updated.createdBy,
        created_at: updated.createdAt,
        updated_at: updated.updatedAt,
      };
      setPreventivi(prev => prev.map(p => p.id === id ? mapped : p));
      return { data: mapped };
    } catch (err) {
      return { error: 'Errore nell\'aggiornamento del preventivo' };
    }
  }, [user]);

  const deletePreventivo = useCallback(async (id: string) => {
    if (!user) return { error: 'Utente non autenticato' };

    try {
      const response = await fetch(apiUrl(`/api/preventivi/${id}`), {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to delete');
      setPreventivi(prev => prev.filter(p => p.id !== id));
      return { success: true };
    } catch (err) {
      return { error: 'Errore nella cancellazione del preventivo' };
    }
  }, [user]);

  const loadPreventivo = useCallback(async (id: string) => {
    if (!user) return { error: 'Utente non autenticato' };

    try {
      const response = await fetch(apiUrl(`/api/preventivi/${id}`), { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to load');
      const data = await response.json();
      return { data: { ...data, organization_id: data.organizationId, created_by: data.createdBy, created_at: data.createdAt, updated_at: data.updatedAt } };
    } catch (err) {
      return { error: 'Errore nel caricamento del preventivo' };
    }
  }, [user]);

  return {
    preventivi,
    loading,
    error,
    fetchPreventivi,
    createPreventivo,
    updatePreventivo,
    deletePreventivo,
    loadPreventivo,
  };
}
