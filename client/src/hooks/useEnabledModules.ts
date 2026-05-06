import { useAuth } from '@/hooks/useAuth';
import { isModuleEnabled } from '@shared/modules';

/**
 * Restituisce helper per verificare se un modulo è abilitato per l'org corrente.
 * super_admin bypassa sempre i flag.
 */
export function useEnabledModules() {
  const { profile, organization, loading } = useAuth();
  const isSuperAdmin = profile?.role === 'super_admin';
  const enabledModules = organization?.enabledModules ?? null;

  const isEnabled = (key: string): boolean => {
    if (isSuperAdmin) return true;
    return isModuleEnabled(enabledModules, key);
  };

  return { isEnabled, enabledModules, isSuperAdmin, loading };
}
