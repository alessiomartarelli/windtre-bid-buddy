import { useAuth } from '@/hooks/useAuth';
import { isModuleEnabled, isModuleAllowedForBrands } from '@shared/modules';

/**
 * Restituisce helper per verificare se un modulo è abilitato per l'org corrente.
 * super_admin bypassa sempre i flag.
 * Oltre a `enabledModules`, i moduli WindTre-specifici richiedono che l'org
 * abbia il brand WindTre associato (org senza brand = nessun filtro).
 */
export function useEnabledModules() {
  const { profile, organization, organizationBrands, loading } = useAuth();
  const isSuperAdmin = profile?.role === 'super_admin';
  const enabledModules = organization?.enabledModules ?? null;
  const brandNames = organizationBrands?.map((b) => b.name) ?? null;

  const isEnabled = (key: string): boolean => {
    if (isSuperAdmin) return true;
    return isModuleEnabled(enabledModules, key) && isModuleAllowedForBrands(brandNames, key);
  };

  return { isEnabled, enabledModules, isSuperAdmin, loading };
}
