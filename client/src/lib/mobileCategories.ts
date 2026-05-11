import { MobileActivationType } from '@/types/preventivatore';

export const SIM_CONSUMER_CORE = new Set<string>([
  MobileActivationType.TIED,
  MobileActivationType.UNTIED,
  MobileActivationType.TOURIST_FULL,
  MobileActivationType.TOURIST_PASS,
  MobileActivationType.TOURIST_XXL,
  MobileActivationType.SIM_ALLARME,
]);

export const SIM_PIVA_CORE = new Set<string>([
  MobileActivationType.SIM_IVA,
  MobileActivationType.PROFESSIONAL_FLEX,
  MobileActivationType.PROFESSIONAL_DATA_10,
  MobileActivationType.PROFESSIONAL_SPECIAL,
  MobileActivationType.PROFESSIONAL_STAFF,
  MobileActivationType.PROFESSIONAL_WORLD,
  MobileActivationType.ALTRE_SIM_IVA,
]);

export const MOBILE_SIM_CORE_TYPES: string[] = [
  ...Array.from(SIM_CONSUMER_CORE),
  ...Array.from(SIM_PIVA_CORE),
];

export const MOBILE_SIM_CORE_SET = new Set<string>(MOBILE_SIM_CORE_TYPES);

export function isMobileSimCore(type: string | undefined | null): boolean {
  if (!type) return false;
  return MOBILE_SIM_CORE_SET.has(type);
}
