import { useCallback, useRef, useEffect } from 'react';
import { useAuth } from './useAuth';
import { PreventivatoreConfig } from './use-preventivatore-storage';

const DEBOUNCE_MS = 2500;

export function useOrganizationConfig() {
  const { profile } = useAuth();
  const profileRef = useRef(profile);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedConfig = useRef<string>('');

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  const loadRemoteConfig = useCallback(async (): Promise<PreventivatoreConfig | null> => {
    const p = profileRef.current;
    if (!p?.organization_id && !p?.organizationId) {
      return null;
    }

    try {
      const response = await fetch('/api/organization-config', { credentials: 'include' });
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error('Failed to load config');
      }
      const data = await response.json();
      
      if (!data) return null;
      
      lastSavedConfig.current = JSON.stringify(data.config);
      return data.config as PreventivatoreConfig;
    } catch (err) {
      console.error('[OrgConfig] Error loading config:', err);
      return null;
    }
  }, []);

  const saveRemoteConfigDebounced = useCallback((config: Omit<PreventivatoreConfig, 'savedAt'>) => {
    const p = profileRef.current;
    if (!p?.organization_id && !p?.organizationId) return;

    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    debounceTimer.current = setTimeout(async () => {
      const configJson = JSON.stringify(config);
      if (configJson === lastSavedConfig.current) return;

      try {
        await fetch('/api/organization-config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ config, configVersion: config.configVersion || '2.0' }),
        });
        lastSavedConfig.current = configJson;
      } catch (err) {
        console.error('[OrgConfig] Error saving config:', err);
      }
    }, DEBOUNCE_MS);
  }, []);

  const saveRemoteConfigNow = useCallback(async (config: Omit<PreventivatoreConfig, 'savedAt'>): Promise<boolean> => {
    const p = profileRef.current;
    if (!p?.organization_id && !p?.organizationId) return false;

    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }

    try {
      const response = await fetch('/api/organization-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ config, configVersion: config.configVersion || '2.0' }),
      });
      if (!response.ok) throw new Error('Failed to save');
      lastSavedConfig.current = JSON.stringify(config);
      return true;
    } catch (err) {
      console.error('[OrgConfig] Error saving config:', err);
      return false;
    }
  }, []);

  return {
    loadRemoteConfig,
    saveRemoteConfigDebounced,
    saveRemoteConfigNow,
  };
}
