import { useAuth } from '@/hooks/useAuth';
import { isModuleAccessible } from '@shared/modules';

/**
 * Restituisce helper per verificare se un modulo è accessibile all'utente corrente.
 * super_admin bypassa sempre i flag.
 * La visibilità effettiva è l'intersezione: (a) modulo abilitato per l'org,
 * (b) consentito dal brand gating (org senza brand = nessun filtro),
 * (c) concesso al profilo (`moduliConsentiti`; null = nessuna restrizione).
 */
export function useEnabledModules() {
  const { profile, organization, organizationBrands, loading } = useAuth();
  const isSuperAdmin = profile?.role === 'super_admin';
  const enabledModules = organization?.enabledModules ?? null;
  const brandNames = organizationBrands?.map((b) => b.name) ?? null;
  const moduliConsentiti = profile?.moduliConsentiti ?? null;

  const isEnabled = (key: string): boolean =>
    isModuleAccessible({ isSuperAdmin, enabledModules, brandNames, moduliConsentiti, key });

  return { isEnabled, enabledModules, isSuperAdmin, loading };
}
