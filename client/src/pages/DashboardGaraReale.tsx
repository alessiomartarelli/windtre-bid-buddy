import { useState, useMemo, Fragment, useCallback } from "react";
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer } from "recharts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  TrendingUp,
  Target,
  Award,
  AlertTriangle,
  Smartphone,
  Wifi,
  Zap,
  Shield,
  Handshake,
  BarChart3,
  Calendar,
  Store,
  Loader2,
  Trophy,
  Settings,
  RefreshCw,
  Briefcase,
  Users,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { apiUrl } from "@/lib/basePath";
import { SIM_CONSUMER_CORE, SIM_PIVA_CORE } from "@/lib/mobileCategories";
import { AppNavbar } from "@/components/AppNavbar";
import { type GaraConfigRecord, type GaraConfigPdv, type GaraConfigListItem } from "@/hooks/useGaraConfig";
import {
  getWorkdayInfoForMonth,
  calcolaPremioPistaFissoPerPos,
  type WorkdayInfo,
  type FissoCategoriaType,
  type PistaFissoPosConfig,
  type AttivatoFissoRiga,
} from "@/lib/calcoloPistaFisso";
import {
  calcolaPremioPistaMobilePerPos,
} from "@/utils/calcoli-mobile";
import {
  calcoloEnergiaPerPos,
} from "@/lib/calcoloEnergia";
import {
  calcolaPartnershipRewardPerPos,
} from "@/lib/calcoloPartnershipReward";
import {
  calcoloAssicurazioniPerPos,
} from "@/lib/calcoloAssicurazioni";
import { useTabelleCalcoloConfig } from "@/hooks/useTabelleCalcoloConfig";
import {
  calcolaProtecta,
} from "@/lib/calcoloProtecta";
import {
  calcolaExtraGaraIva,
  PREMI_EXTRA_GARA,
  type ExtraGaraConfigOverrides,
  type ExtraGaraSogliePerRS,
} from "@/lib/calcoloExtraGaraIva";
import { type ExtraGaraIvaRsResult } from "@/types/extra-gara-iva";
import {
  type StoreCalendar,
  type Weekday,
  MOBILE_CATEGORIES_CONFIG_DEFAULT,
  type MobileCategoryConfig,
  type PistaMobilePosConfig,
  type AttivatoMobileDettaglio,
  MobileActivationType,
  type PuntoVendita,
} from "@/types/preventivatore";
import {
  type EnergiaCategory,
  type EnergiaConfig,
  type EnergiaAttivatoRiga,
  type EnergiaPdvInGara,
  ENERGIA_BASE_PAY,
} from "@/types/energia";
import {
  type CBEventType,
  type AttivatoCBDettaglio,
  CB_EVENTS_CONFIG,
  PARTNERSHIP_DEFAULTS,
} from "@/types/partnership-cb-events";
import { calcoloCBPerPdv, clusterCBToLevel, getCBGettoniForCategory, type CBCalcItem } from "@/lib/calcoloCB";
import {
  type PartnershipRewardPosConfig,
} from "@/types/partnership-reward";
import {
  type AssicurazioniAttivatoRiga,
  type AssicurazioniConfig,
  type AssicurazioniPdvInGara,
} from "@/types/assicurazioni";
import {
  type ProtectaAttivatoRiga,
  type ProtectaProduct,
  createEmptyProtectaAttivato,
} from "@/types/protecta";

interface AggregatedItem {
  pista: string;
  targetCategory: string;
  targetLabel: string;
  pezzi: number;
  canone: number;
  ruleType?: 'base' | 'additional';
  descriptions?: Record<string, number>;
}

interface AddonItem {
  pista: string;
  targetCategory: string;
  targetLabel: string;
  occorrenze: number;
  canone: number;
}

interface ExtraTally {
  pezzi: number;
  importo: number;
}

interface DeviceModalitaTally {
  pezzi: number;
  descriptions: Record<string, number>;
}
interface DeviceKindTally {
  finanziato: DeviceModalitaTally;
  rate: DeviceModalitaTally;
  altro: DeviceModalitaTally;
}
interface DeviceTally {
  smartphone: DeviceKindTally;
  smartDevice: DeviceKindTally;
  internetDevice: DeviceKindTally;
}

const EMPTY_DEVICE_KIND: DeviceKindTally = {
  finanziato: { pezzi: 0, descriptions: {} },
  rate: { pezzi: 0, descriptions: {} },
  altro: { pezzi: 0, descriptions: {} },
};

interface PdvData {
  codicePos: string;
  nomeNegozio: string;
  ragioneSociale: string;
  items: AggregatedItem[];
  addons?: AddonItem[];
  accessori?: ExtraTally;
  servizi?: ExtraTally;
  devices?: DeviceTally;
  unmapped: number;
  totalArticoli: number;
}

const SMARTPHONE_MOBILE_CATEGORIES = new Set<string>([
  'DEVICE_VAR_SP_LT_200',
  'DEVICE_VAR_SP_GTE_200',
  'DEVICE_1_FIN_SP_LT_200',
  'DEVICE_1_FIN_SP_200_600',
  'DEVICE_1_FIN_SP_GTE_600',
]);

const SMARTPHONE_CB_CATEGORIES = new Set<string>([
  'IMP_AGG_0_VAR_FINANZ',
  'IMP_AGG_GT0_FINANZ',
  'IMP_AGG_GT0_VAR',
  'multi_device_finanziamento',
]);

const SMARTPHONE_MOBILE_FIN = new Set<string>([
  'DEVICE_1_FIN_SP_LT_200',
  'DEVICE_1_FIN_SP_200_600',
  'DEVICE_1_FIN_SP_GTE_600',
  'DEVICE_2_FINANZIATO',
]);
const SMARTPHONE_MOBILE_RATE = new Set<string>([
  'DEVICE_VAR_SP_LT_200',
  'DEVICE_VAR_SP_GTE_200',
]);
const SMARTPHONE_CB_FIN = new Set<string>([
  'IMP_AGG_GT0_FINANZ',
  'multi_device_finanziamento',
]);
const SMARTPHONE_CB_RATE = new Set<string>([
  'IMP_AGG_GT0_VAR',
]);
// IMP_AGG_0_VAR_FINANZ è ambigua (= 0) → conta nel totale ma non nel breakdown

function countByCats(pdv: PdvData, pista: string, cats: Set<string>): number {
  let n = 0;
  for (const it of pdv.items) if (it.pista === pista && cats.has(it.targetCategory)) n += it.pezzi;
  for (const a of pdv.addons || []) if (a.pista === pista && cats.has(a.targetCategory)) n += a.occorrenze;
  return n;
}
function pdvSmartphoneMobileCount(pdv: PdvData): number {
  return countByCats(pdv, 'mobile', SMARTPHONE_MOBILE_CATEGORIES);
}
function pdvSmartphoneCBCount(pdv: PdvData): number {
  return countByCats(pdv, 'cb', SMARTPHONE_CB_CATEGORIES);
}
function pdvSmartphoneSplit(pdv: PdvData, pista: 'mobile' | 'cb'): { fin: number; rate: number; total: number } {
  if (pista === 'mobile') {
    const fin = countByCats(pdv, 'mobile', SMARTPHONE_MOBILE_FIN);
    const rate = countByCats(pdv, 'mobile', SMARTPHONE_MOBILE_RATE);
    return { fin, rate, total: pdvSmartphoneMobileCount(pdv) };
  }
  const fin = countByCats(pdv, 'cb', SMARTPHONE_CB_FIN);
  const rate = countByCats(pdv, 'cb', SMARTPHONE_CB_RATE);
  return { fin, rate, total: pdvSmartphoneCBCount(pdv) };
}

function deviceKindTotal(k?: DeviceKindTally): number {
  if (!k) return 0;
  return k.finanziato.pezzi + k.rate.pezzi + k.altro.pezzi;
}
function mergedDescriptions(k?: DeviceKindTally): { fin: Record<string, number>; rate: Record<string, number>; altro: Record<string, number>; all: Record<string, number> } {
  const fin = k?.finanziato.descriptions || {};
  const rate = k?.rate.descriptions || {};
  const altro = k?.altro.descriptions || {};
  const all: Record<string, number> = {};
  for (const [d, n] of Object.entries(fin)) all[d] = (all[d] || 0) + n;
  for (const [d, n] of Object.entries(rate)) all[d] = (all[d] || 0) + n;
  for (const [d, n] of Object.entries(altro)) all[d] = (all[d] || 0) + n;
  return { fin, rate, altro, all };
}

type PdvSortKey =
  | 'pezzi_default'
  | 'premio'
  | 'smartphone'
  | 'accessori_pezzi'
  | 'accessori_fatturato'
  | 'servizi_fatturato'
  | 'nome_az'
  | 'punti_mobile'
  | 'punti_fisso'
  | 'punti_cb'
  | 'punti_energia'
  | 'punti_assicurazioni'
  | 'punti_protecta';

const PDV_SORT_OPTIONS: { value: PdvSortKey; label: string }[] = [
  { value: 'pezzi_default', label: 'Pezzi totali (RS)' },
  { value: 'premio', label: 'Premio €' },
  { value: 'smartphone', label: 'Pezzi smartphone' },
  { value: 'accessori_pezzi', label: 'Pezzi accessori' },
  { value: 'accessori_fatturato', label: 'Fatturato accessori €' },
  { value: 'servizi_fatturato', label: 'Fatturato servizi €' },
  { value: 'nome_az', label: 'Nome PDV (A-Z)' },
  { value: 'punti_mobile', label: 'Punti Mobile' },
  { value: 'punti_fisso', label: 'Punti Fisso' },
  { value: 'punti_cb', label: 'Punti CB' },
  { value: 'punti_energia', label: 'Punti Energia' },
  { value: 'punti_assicurazioni', label: 'Punti Assicurazioni' },
  { value: 'punti_protecta', label: 'Punti Protecta' },
];

interface MappedSalesResponse {
  month: number;
  year: number;
  totalSales: number;
  totalArticoli: number;
  totalMapped: number;
  totalUnmapped: number;
  pdvList: PdvData[];
  totaliPerPista: Record<string, Record<string, { targetCategory: string; targetLabel: string; pezzi: number }>>;
  totaliAddonsPerPista?: Record<string, Record<string, { targetCategory: string; targetLabel: string; occorrenze: number; canone: number }>>;
  latestSaleDate: string | null;
  inGaraOnly?: boolean;
  totalSalesUnfiltered?: number;
  salesExcludedOutOfGara?: number;
  calendarsAvailable?: boolean;
}

interface OrgConfigPdv {
  id: string;
  codicePos: string;
  nome: string;
  ragioneSociale: string;
  calendar: StoreCalendar;
  clusterMobile?: string;
  clusterFisso?: string;
  clusterCB?: string;
  abilitaEnergia?: boolean;
  abilitaAssicurazioni?: boolean;
}

interface OrgConfigResponse {
  config: {
    puntiVendita?: OrgConfigPdv[];
    pistaFissoConfig?: {
      sogliePerPos: PistaFissoPosConfig[];
    };
    pistaMobileConfig?: {
      sogliePerPos: PistaMobilePosConfig[];
    };
    energiaConfig?: EnergiaConfig;
    energiaPdvInGara?: Array<{ pdvId: string; isInGara: boolean; codicePos: string }>;
    mobileCategories?: MobileCategoryConfig[];
    configGara?: { annoGara: number; meseGara: number };
    partnershipRewardConfig?: {
      configPerPos: Array<{ posCode: string; config: { target80: number; target100: number; premio80: number; premio100: number } }>;
    };
    assicurazioniConfig?: AssicurazioniConfig;
    assicurazioniPdvInGara?: AssicurazioniPdvInGara[];
  };
  configVersion: number;
}

const PISTA_ORDER: string[] = ['mobile', 'fisso', 'cb', 'partnership', 'extra_gara_iva', 'energia', 'assicurazioni', 'protecta'];
const pistaOrderRank = (key: string): number => {
  const i = PISTA_ORDER.indexOf(key);
  return i === -1 ? 999 : i;
};

const PISTA_CONFIG = {
  mobile: { label: "Mobile", icon: Smartphone, color: "bg-blue-500", lightColor: "bg-blue-50 text-blue-700 border-blue-200" },
  fisso: { label: "Fisso", icon: Wifi, color: "bg-green-500", lightColor: "bg-green-50 text-green-700 border-green-200" },
  energia: { label: "Energia", icon: Zap, color: "bg-amber-500", lightColor: "bg-amber-50 text-amber-700 border-amber-200" },
  assicurazioni: { label: "Assicurazioni", icon: Shield, color: "bg-purple-500", lightColor: "bg-purple-50 text-purple-700 border-purple-200" },
  partnership: { label: "Partnership", icon: Handshake, color: "bg-cyan-500", lightColor: "bg-cyan-50 text-cyan-700 border-cyan-200" },
  cb: { label: "Customer Base", icon: Users, color: "bg-orange-500", lightColor: "bg-orange-50 text-orange-700 border-orange-200" },
  protecta: { label: "Protecta", icon: Shield, color: "bg-rose-500", lightColor: "bg-rose-50 text-rose-700 border-rose-200" },
  extra_gara_iva: { label: "Extra Gara P.IVA", icon: Briefcase, color: "bg-indigo-500", lightColor: "bg-indigo-50 text-indigo-700 border-indigo-200" },
} as const;

const DEFAULT_CALENDAR: StoreCalendar = {
  weeklySchedule: { workingDays: [1, 2, 3, 4, 5, 6] as Weekday[] },
  specialDays: [],
};

const FISSO_CONSUMER_CORE = new Set<string>([
  "FISSO_FTTC", "FISSO_FTTH", "FISSO_FWA_OUT", "FISSO_FWA_IND_2P", "FISSO_VOCE",
]);

const FISSO_BUSINESS_CORE = new Set<string>([
  "FISSO_PIVA_1A_LINEA", "FISSO_PIVA_2A_LINEA",
]);

const FISSO_BUSINESS_CATEGORIES = new Set<string>([
  "FISSO_PIVA_1A_LINEA", "FISSO_PIVA_2A_LINEA", "CHIAMATE_ILLIMITATE",
]);

function isCorePezziItem(pista: string, targetCategory: string): boolean {
  if (pista === "mobile") return SIM_CONSUMER_CORE.has(targetCategory) || SIM_PIVA_CORE.has(targetCategory);
  if (pista === "fisso") return FISSO_CONSUMER_CORE.has(targetCategory) || FISSO_BUSINESS_CORE.has(targetCategory);
  return true;
}

interface MobileGroupedCategory {
  groupLabel: string;
  groupKey: string;
  totalPezzi: number;
  totalProiezione: number;
  children: { category: string; label: string; pezzi: number; proiezione: number }[];
}

function groupMobileCategories(
  categories: { category: string; label: string; pezzi: number; proiezione: number }[]
): MobileGroupedCategory[] {
  const consumerChildren: typeof categories = [];
  const ivaChildren: typeof categories = [];

  for (const cat of categories) {
    if (SIM_PIVA_CORE.has(cat.category)) {
      ivaChildren.push(cat);
    } else {
      consumerChildren.push(cat);
    }
  }

  const groups: MobileGroupedCategory[] = [];

  if (consumerChildren.length > 0) {
    const corePezzi = consumerChildren.filter(c => SIM_CONSUMER_CORE.has(c.category)).reduce((s, c) => s + c.pezzi, 0);
    const coreProiezione = consumerChildren.filter(c => SIM_CONSUMER_CORE.has(c.category)).reduce((s, c) => s + c.proiezione, 0);
    groups.push({
      groupLabel: "SIM Consumer",
      groupKey: "sim_consumer",
      totalPezzi: corePezzi,
      totalProiezione: coreProiezione,
      children: consumerChildren.sort((a, b) => {
        const rank = (cat: string) => {
          if (SIM_CONSUMER_CORE.has(cat)) return 0;
          if (cat.startsWith("PIU_SICURI_")) return 2;
          if (cat.startsWith("DEVICE_")) return 3;
          return 1;
        };
        const aR = rank(a.category);
        const bR = rank(b.category);
        if (aR !== bR) return aR - bR;
        return b.pezzi - a.pezzi;
      }),
    });
  }

  if (ivaChildren.length > 0) {
    const corePezzi = ivaChildren.filter(c => SIM_PIVA_CORE.has(c.category)).reduce((s, c) => s + c.pezzi, 0);
    const coreProiezione = ivaChildren.filter(c => SIM_PIVA_CORE.has(c.category)).reduce((s, c) => s + c.proiezione, 0);
    groups.push({
      groupLabel: "SIM Business",
      groupKey: "sim_iva",
      totalPezzi: corePezzi,
      totalProiezione: coreProiezione,
      children: ivaChildren.sort((a, b) => b.pezzi - a.pezzi),
    });
  }

  return groups;
}

function groupFissoCategories(
  categories: { category: string; label: string; pezzi: number; proiezione: number }[]
): MobileGroupedCategory[] {
  const consumerChildren: typeof categories = [];
  const businessChildren: typeof categories = [];
  const otherChildren: typeof categories = [];

  for (const cat of categories) {
    if (FISSO_BUSINESS_CATEGORIES.has(cat.category)) {
      businessChildren.push(cat);
    } else if (FISSO_CONSUMER_CORE.has(cat.category) || ["FRITZ_BOX", "NETFLIX_CON_ADV", "NETFLIX_SENZA_ADV", "CONVERGENZA", "LINEA_ATTIVA", "BOLLETTINO_POSTALE", "PIU_SICURI_CASA_UFFICIO", "ASSICURAZIONI_PLUS_FULL", "MIGRAZIONI_FTTH_FWA"].includes(cat.category)) {
      consumerChildren.push(cat);
    } else {
      otherChildren.push(cat);
    }
  }

  const groups: MobileGroupedCategory[] = [];

  if (consumerChildren.length > 0) {
    const corePezzi = consumerChildren.filter(c => FISSO_CONSUMER_CORE.has(c.category)).reduce((s, c) => s + c.pezzi, 0);
    const coreProiezione = consumerChildren.filter(c => FISSO_CONSUMER_CORE.has(c.category)).reduce((s, c) => s + c.proiezione, 0);
    groups.push({
      groupLabel: "Fisso Consumer",
      groupKey: "fisso_consumer",
      totalPezzi: corePezzi,
      totalProiezione: coreProiezione,
      children: consumerChildren.sort((a, b) => {
        const aCore = FISSO_CONSUMER_CORE.has(a.category) ? 0 : 1;
        const bCore = FISSO_CONSUMER_CORE.has(b.category) ? 0 : 1;
        if (aCore !== bCore) return aCore - bCore;
        return b.pezzi - a.pezzi;
      }),
    });
  }

  if (businessChildren.length > 0) {
    const corePezzi = businessChildren.filter(c => FISSO_BUSINESS_CORE.has(c.category)).reduce((s, c) => s + c.pezzi, 0);
    const coreProiezione = businessChildren.filter(c => FISSO_BUSINESS_CORE.has(c.category)).reduce((s, c) => s + c.proiezione, 0);
    groups.push({
      groupLabel: "Fisso Business",
      groupKey: "fisso_business",
      totalPezzi: corePezzi,
      totalProiezione: coreProiezione,
      children: businessChildren.sort((a, b) => b.pezzi - a.pezzi),
    });
  }

  if (otherChildren.length > 0) {
    groups.push({
      groupLabel: "Altre Info / Add-on",
      groupKey: "fisso_altro",
      totalPezzi: otherChildren.reduce((s, c) => s + c.pezzi, 0),
      totalProiezione: otherChildren.reduce((s, c) => s + c.proiezione, 0),
      children: otherChildren.sort((a, b) => b.pezzi - a.pezzi),
    });
  }

  return groups;
}

interface PistaCalcResult {
  premioStimato: number;
  puntiTotali: number;
  sogliaRaggiunta: number;
  sogliaLabel: string;
  forecastTarget?: number;
  forecastGap?: number;
}

const EMPTY_CALC: PistaCalcResult = {
  premioStimato: 0, puntiTotali: 0, sogliaRaggiunta: 0, sogliaLabel: "Nessuna",
};

function sogliaToLabel(soglia: number, maxSoglia: number = 5): string {
  if (soglia <= 0) return "Nessuna";
  return `S${soglia}`;
}

function normalizeRS(s: string): string {
  return s.trim().toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ');
}

function clusterToNumber(cluster?: string): 1 | 2 | 3 {
  if (!cluster) return 1;
  if (cluster.includes("3") || cluster === "CC3") return 3;
  if (cluster.includes("2") || cluster === "CC2") return 2;
  return 1;
}

function calcMobilePerPdv(
  pdvItems: AggregatedItem[],
  mobileConfig: PistaMobilePosConfig | undefined,
  calendar: StoreCalendar,
  year: number,
  month: number,
  mobileCategories: MobileCategoryConfig[],
  workdayInfo: WorkdayInfo,
  soglieOverride?: { soglia1?: number; soglia2?: number; soglia3?: number; soglia4?: number },
  moltiplicatoriPerGruppo?: Record<string, number[]>,
): PistaCalcResult {
  if (!mobileConfig || pdvItems.length === 0) return EMPTY_CALC;

  const mobileEnumValues = new Set(Object.values(MobileActivationType) as string[]);
  const validItems = pdvItems.filter((item) => mobileEnumValues.has(item.targetCategory));
  const dettaglio: AttivatoMobileDettaglio[] = validItems.map((item, idx) => ({
    id: `bisuite-${idx}`,
    type: item.targetCategory as MobileActivationType,
    pezzi: item.pezzi,
  }));

  const totalCanone = validItems.reduce((sum, item) => sum + (item.canone || 0), 0);

  const canonePerType: Record<string, number> = {};
  for (const item of validItems) {
    canonePerType[item.targetCategory] = (canonePerType[item.targetCategory] || 0) + (item.canone || 0);
  }

  const result = calcolaPremioPistaMobilePerPos({
    configPos: mobileConfig,
    dettaglio,
    calendar,
    year,
    month: month - 1,
    mobileCategories,
    workdayInfoOverride: workdayInfo,
    valoreCanoniOverride: totalCanone,
    soglieOverride,
    moltiplicatoriPerGruppo,
    canonePerType,
  });

  return {
    premioStimato: result.premio,
    puntiTotali: result.punti,
    sogliaRaggiunta: result.soglia,
    sogliaLabel: sogliaToLabel(result.soglia, 4),
    forecastTarget: result.forecastTargetPunti,
    forecastGap: result.forecastGapPunti,
  };
}

function mergeItemsWithAddons(items: AggregatedItem[], addons?: AddonItem[]): AggregatedItem[] {
  if (!addons || addons.length === 0) return items;
  const merged = [...items];
  for (const addon of addons) {
    merged.push({
      pista: addon.pista,
      targetCategory: addon.targetCategory,
      targetLabel: addon.targetLabel,
      pezzi: addon.occorrenze,
      canone: addon.canone,
      ruleType: 'additional',
    });
  }
  return merged;
}

function calcFissoPerPdv(
  pdvItems: AggregatedItem[],
  fissoConfig: PistaFissoPosConfig | undefined,
  calendar: StoreCalendar,
  clusterFisso: 1 | 2 | 3,
  posCode: string,
  year: number,
  month: number,
  workdayInfo: WorkdayInfo,
  gettoniContrattualiOverride?: Record<string, number>,
  soglieOverride?: { soglia1?: number; soglia2?: number; soglia3?: number; soglia4?: number; soglia5?: number },
  euroPerPezzoOverride?: Record<string, number>,
  addons?: AddonItem[],
): PistaCalcResult {
  const allItems = mergeItemsWithAddons(pdvItems, addons?.filter(a => a.pista === 'fisso'));
  if (!fissoConfig || allItems.length === 0) return EMPTY_CALC;

  const VALID_FISSO_TYPES: Set<string> = new Set([
    "FISSO_FTTC","FISSO_FTTH","FISSO_FWA_OUT","FISSO_FWA_IND_2P","FRITZ_BOX",
    "NETFLIX_CON_ADV","NETFLIX_SENZA_ADV","CONVERGENZA","LINEA_ATTIVA",
    "FISSO_PIVA_1A_LINEA","FISSO_PIVA_2A_LINEA","CHIAMATE_ILLIMITATE",
    "BOLLETTINO_POSTALE","PIU_SICURI_CASA_UFFICIO","ASSICURAZIONI_PLUS_FULL","MIGRAZIONI_FTTH_FWA",
    "FISSO_VOCE",
    "FIBRA_FTTH_ADDON","VOCE_UNLIMITED","CONVERGENZA_LUCE_GAS","CONVERGENTE_ASSICUR",
  ]);
  const validFissoItems = allItems.filter((item) => VALID_FISSO_TYPES.has(item.targetCategory));
  const attivato: AttivatoFissoRiga[] = validFissoItems.map((item) => ({
    categoria: item.targetCategory as FissoCategoriaType,
    pezzi: item.pezzi,
  }));

  const result = calcolaPremioPistaFissoPerPos({
    annoGara: year,
    meseGara: month,
    calendar,
    clusterFisso,
    posCode,
    pistaConfig: fissoConfig,
    attivato,
    workdayInfoOverride: workdayInfo,
    gettoniContrattualiOverride,
    soglieOverride,
    euroPerPezzoOverride,
  });

  const fissoAddons = addons?.filter(a => a.pista === 'fisso') || [];
  let premioAdjusted = result.premio;

  for (const addon of fissoAddons) {
    if (addon.occorrenze <= 0) continue;
    const canone = addon.canone || 0;

    switch (addon.targetCategory) {
      case "CONVERGENZA":
        premioAdjusted -= addon.occorrenze * 46;
        premioAdjusted += canone * 2;
        break;
      case "LINEA_ATTIVA":
        premioAdjusted -= addon.occorrenze * 23;
        premioAdjusted += canone * 1;
        break;
      case "FIBRA_FTTH_ADDON":
        premioAdjusted += canone * 1;
        break;
      case "VOCE_UNLIMITED": {
        let multVoce = 0;
        if (result.soglia === 1) multVoce = 0.25;
        else if (result.soglia === 2) multVoce = 0.5;
        else if (result.soglia === 3) multVoce = 0.5;
        else if (result.soglia === 4) multVoce = 1;
        else if (result.soglia >= 5) multVoce = 1.5;
        premioAdjusted += canone * multVoce;
        break;
      }
      case "CONVERGENZA_LUCE_GAS":
        premioAdjusted += canone * 2;
        break;
      case "CONVERGENTE_ASSICUR":
        premioAdjusted += canone * 2;
        break;
    }
  }

  return {
    premioStimato: premioAdjusted,
    puntiTotali: result.punti,
    sogliaRaggiunta: result.soglia,
    sogliaLabel: sogliaToLabel(result.soglia, 5),
  };
}

function calcEnergiaPerPdv(
  pdvItems: AggregatedItem[],
  energiaConfig: EnergiaConfig | undefined,
  posCode: string,
  isInGara: boolean,
  numPdv: number,
  compensiBaseOverride?: Record<string, number>,
  bonusPerContrattoOverride?: number,
  pistaBonusPerContrattoOverride?: Record<string, number>,
  pistaBaseOverride?: Record<string, number>,
  pistaDa4Override?: Record<string, number>,
): PistaCalcResult {
  if (!energiaConfig || pdvItems.length === 0) return EMPTY_CALC;

  const VALID_ENERGIA_TYPES = new Set(Object.keys(ENERGIA_BASE_PAY));
  const validEnergiaItems = pdvItems.filter((item) => VALID_ENERGIA_TYPES.has(item.targetCategory));
  const attivato: EnergiaAttivatoRiga[] = validEnergiaItems.map((item, idx) => ({
    id: `bisuite-${idx}`,
    category: item.targetCategory as EnergiaCategory,
    pezzi: item.pezzi,
  }));

  const pdvInGaraList: EnergiaPdvInGara[] = [{ pdvId: posCode, codicePos: posCode, nome: posCode, isInGara }];

  const result = calcoloEnergiaPerPos({
    posCode,
    attivato,
    config: energiaConfig,
    pdvInGaraList,
    isNegozioInGara: isInGara,
    numPdv,
    compensiBaseOverride,
    bonusPerContrattoOverride,
    pistaBonusPerContrattoOverride,
    pistaBaseOverride,
    pistaDa4Override,
  });

  return {
    premioStimato: result.premioTotale,
    puntiTotali: result.totalePezzi,
    sogliaRaggiunta: result.sogliaRaggiunta,
    sogliaLabel: sogliaToLabel(result.sogliaRaggiunta, 3),
  };
}

const VALID_CB_TYPES = new Set(CB_EVENTS_CONFIG.map((c) => c.type as string));

function resolveClusterGettoniFromConfig(
  eventType: string,
  clusterCB: string | undefined,
  tcPartnership?: { clusterGettoniUntied?: Record<string, number>; clusterGettoniRivincoli?: Record<string, number> },
): number | undefined {
  const clusterLevel = clusterCBToLevel(clusterCB);
  const clusterKeys = ['C0U', 'C1U', 'C2U', 'C3U'];
  const clusterKeysT = ['C0T', 'C1T', 'C2T', 'C3T'];

  if (eventType === 'cambio_offerta_untied') {
    const key = clusterKeys[clusterLevel] || 'C0U';
    return tcPartnership?.clusterGettoniUntied?.[key]
      ?? getCBGettoniForCategory(eventType, clusterLevel);
  }
  if (eventType === 'cambio_offerta_rivincoli') {
    const key = clusterKeysT[clusterLevel] || 'C0T';
    return tcPartnership?.clusterGettoniRivincoli?.[key]
      ?? getCBGettoniForCategory(eventType, clusterLevel);
  }
  return undefined;
}

function calcPartnershipPerPdv(
  pdvItems: AggregatedItem[],
  partnershipConfig: PartnershipRewardPosConfig | undefined,
  giorniLavorativi: number,
  posCode: string,
  tcPartnership?: { puntiPartnership?: Record<string, number>; gettoniEvento?: Record<string, number>; clusterGettoniUntied?: Record<string, number>; clusterGettoniRivincoli?: Record<string, number> },
  clusterCB?: string,
): PistaCalcResult {
  if (pdvItems.length === 0) return EMPTY_CALC;

  const validItems = pdvItems.filter((item) => VALID_CB_TYPES.has(item.targetCategory));
  const attivato: AttivatoCBDettaglio[] = validItems.map((item) => {
    const defaults = PARTNERSHIP_DEFAULTS[item.targetCategory];
    const punti = tcPartnership?.puntiPartnership?.[item.targetCategory]
      ?? defaults?.puntiPartnership
      ?? 1;

    const clusterGettoni = resolveClusterGettoniFromConfig(item.targetCategory, clusterCB, tcPartnership);
    const gettoni = clusterGettoni
      ?? tcPartnership?.gettoniEvento?.[item.targetCategory]
      ?? defaults?.gettoni
      ?? 0;
    return {
      eventType: item.targetCategory as CBEventType,
      pezzi: item.pezzi,
      gettoni,
      puntiPartnership: punti,
      clusterCard: clusterCB,
    };
  });

  if (!partnershipConfig) {
    // Senza config soglie partnership non c'e' premio sbloccabile.
    // I gettoni NON sono conteggiati nella pista Partnership (sono CB).
    let puntiTotali = 0;
    for (const a of attivato) puntiTotali += a.pezzi * a.puntiPartnership;
    return {
      premioStimato: 0,
      puntiTotali,
      sogliaRaggiunta: 0,
      sogliaLabel: "N/A",
    };
  }

  const result = calcolaPartnershipRewardPerPos({
    posCode,
    config: partnershipConfig,
    attivato,
    giorniLavorativi,
  });

  const targetNum = result.targetRaggiunto === "100%" ? 2 : result.targetRaggiunto === "80%" ? 1 : 0;
  return {
    premioStimato: result.premioMaturato,
    puntiTotali: result.punti,
    sogliaRaggiunta: targetNum,
    sogliaLabel: result.targetRaggiunto === "nessuno" ? "Nessuna" : result.targetRaggiunto,
    forecastTarget: partnershipConfig.config.target100,
    forecastGap: result.punti - partnershipConfig.config.target100,
  };
}

function calcCBFromItems(
  items: { targetCategory: string; pezzi: number }[],
  clusterCB?: string,
): PistaCalcResult {
  const cbItems: CBCalcItem[] = items.map(i => ({ targetCategory: i.targetCategory, count: i.pezzi }));
  return calcoloCBPerPdv(cbItems, clusterCB);
}

function calcCBFromItemsAndAddons(
  pdvItems: AggregatedItem[],
  pdvAddons: AddonItem[],
  clusterCB?: string,
): PistaCalcResult {
  const cbItems: CBCalcItem[] = [
    ...pdvItems.map(i => ({ targetCategory: i.targetCategory, count: i.pezzi })),
    ...pdvAddons.map(a => ({ targetCategory: a.targetCategory, count: a.occorrenze })),
  ];
  return calcoloCBPerPdv(cbItems, clusterCB);
}

function calcAssicurazioniForAllPdv(
  mappedData: MappedSalesResponse,
  puntiVendita: OrgConfigPdv[],
  assicConfig: AssicurazioniConfig | undefined,
  pdvInGara: AssicurazioniPdvInGara[],
  puntiOverride?: Record<string, number>,
  premiOverride?: Record<string, number>,
): Map<string, PistaCalcResult> {
  const resultMap = new Map<string, PistaCalcResult>();
  if (!assicConfig || puntiVendita.length === 0) return resultMap;

  const ASSIC_PRODUCT_KEYS: Set<string> = new Set([
    "protezionePro","casaFamigliaFull","casaFamigliaPlus","casaFamigliaStart",
    "sportFamiglia","sportIndividuale","viaggiVacanze","elettrodomestici","micioFido",
  ]);

  const attivatoByPos: Record<string, AssicurazioniAttivatoRiga> = {};
  for (const pdv of mappedData.pdvList) {
    const items = pdv.items.filter((i) => i.pista === "assicurazioni" && ASSIC_PRODUCT_KEYS.has(i.targetCategory));
    if (items.length === 0) continue;
    const riga: AssicurazioniAttivatoRiga = {
      protezionePro: 0, casaFamigliaFull: 0, casaFamigliaPlus: 0, casaFamigliaStart: 0,
      sportFamiglia: 0, sportIndividuale: 0, viaggiVacanze: 0, elettrodomestici: 0,
      micioFido: 0, viaggioMondo: 0, viaggioMondoPremio: 0, reloadForever: 0,
    };
    for (const item of items) {
      const key = item.targetCategory as keyof AssicurazioniAttivatoRiga;
      if (key in riga) {
        riga[key] = item.pezzi;
      }
    }
    attivatoByPos[pdv.codicePos] = riga;
  }

  const pdvs = puntiVendita.map((p) => ({
    id: p.id,
    codicePos: p.codicePos,
    nome: p.nome,
    ragioneSociale: p.ragioneSociale,
    calendar: p.calendar,
    tipoPosizione: "strada" as PuntoVendita["tipoPosizione"],
    canale: "franchising" as PuntoVendita["canale"],
    clusterMobile: (p.clusterMobile || "") as PuntoVendita["clusterMobile"],
    clusterFisso: (p.clusterFisso || "") as PuntoVendita["clusterFisso"],
    clusterCB: (p.clusterCB || "") as PuntoVendita["clusterCB"],
    clusterPIva: "" as PuntoVendita["clusterPIva"],
    ruoloBusiness: "none" as PuntoVendita["ruoloBusiness"],
    abilitaEnergia: p.abilitaEnergia ?? false,
    abilitaAssicurazioni: p.abilitaAssicurazioni ?? false,
  })) as PuntoVendita[];

  const results = calcoloAssicurazioniPerPos(pdvs, assicConfig, pdvInGara, attivatoByPos, puntiOverride, premiOverride);
  for (const r of results) {
    const sogliaNum = r.bonusSoglia2 > 0 ? 2 : r.bonusSoglia1 > 0 ? 1 : 0;
    resultMap.set(r.pdvId, {
      premioStimato: r.premioTotale,
      puntiTotali: r.puntiTotali,
      sogliaRaggiunta: sogliaNum,
      sogliaLabel: sogliaNum === 0 ? "Nessuna" : `S${sogliaNum}`,
    });
  }
  return resultMap;
}

function calcProtectaForAllPdv(
  mappedData: MappedSalesResponse,
  puntiVendita: OrgConfigPdv[],
  gettoniOverride?: Record<string, number>,
): Map<string, PistaCalcResult> {
  const resultMap = new Map<string, PistaCalcResult>();
  if (puntiVendita.length === 0) return resultMap;

  const PROTECTA_KEYS: Set<string> = new Set([
    "casaStart","casaStartFinanziato","casaPlus","casaPlusFinanziato","negozioProtetti","negozioProtettiFinanziato",
  ]);

  const attivatoByPos: Record<string, ProtectaAttivatoRiga> = {};
  for (const pdv of mappedData.pdvList) {
    const items = pdv.items.filter((i) => i.pista === "protecta" && PROTECTA_KEYS.has(i.targetCategory));
    if (items.length === 0) continue;
    const riga = createEmptyProtectaAttivato();
    for (const item of items) {
      const key = item.targetCategory as keyof ProtectaAttivatoRiga;
      if (key in riga) {
        riga[key] = item.pezzi;
      }
    }
    attivatoByPos[pdv.codicePos] = riga;
  }

  const pdvs = puntiVendita.map((p) => ({
    id: p.id,
    codicePos: p.codicePos,
    nome: p.nome,
    ragioneSociale: p.ragioneSociale,
    calendar: p.calendar,
    tipoPosizione: "strada" as PuntoVendita["tipoPosizione"],
    canale: "franchising" as PuntoVendita["canale"],
    clusterMobile: (p.clusterMobile || "") as PuntoVendita["clusterMobile"],
    clusterFisso: (p.clusterFisso || "") as PuntoVendita["clusterFisso"],
    clusterCB: (p.clusterCB || "") as PuntoVendita["clusterCB"],
    clusterPIva: "" as PuntoVendita["clusterPIva"],
    ruoloBusiness: "none" as PuntoVendita["ruoloBusiness"],
    abilitaEnergia: p.abilitaEnergia ?? false,
    abilitaAssicurazioni: p.abilitaAssicurazioni ?? false,
  })) as PuntoVendita[];

  const results = calcolaProtecta(attivatoByPos, pdvs, gettoniOverride);
  for (const r of results) {
    resultMap.set(r.pdvId, {
      premioStimato: r.premioTotale,
      puntiTotali: r.pezziTotali,
      sogliaRaggiunta: 0,
      sogliaLabel: "N/A",
    });
  }
  return resultMap;
}

function getSogliaColor(soglia: string): string {
  if (soglia === "Nessuna" || soglia === "N/A") return "text-red-600 bg-red-50 border-red-200";
  if (soglia === "S1") return "text-amber-600 bg-amber-50 border-amber-200";
  if (soglia === "S2") return "text-yellow-600 bg-yellow-50 border-yellow-200";
  if (soglia === "S3") return "text-lime-600 bg-lime-50 border-lime-200";
  return "text-green-600 bg-green-50 border-green-200";
}

function getMonthOptions() {
  const now = new Date();
  const options = [];
  for (let i = -2; i <= 1; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const monthNames = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
    options.push({
      value: `${d.getFullYear()}-${d.getMonth() + 1}`,
      label: `${monthNames[d.getMonth()]} ${d.getFullYear()}`,
      month: d.getMonth() + 1,
      year: d.getFullYear(),
    });
  }
  return options;
}

function formatEuro(value: number): string {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
}

function ProjectionBadge({ current, projected, label }: { current: number; projected: number; label: string }) {
  const ratio = projected > 0 ? current / projected : 0;
  const color = ratio >= 1 ? "bg-green-100 text-green-800" : ratio >= 0.7 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800";

  return (
    <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${color}`} data-testid={`projection-badge-${label}`}>
      <TrendingUp className="h-3.5 w-3.5" />
      Proiezione: {projected}
    </div>
  );
}

type CompactRowMetrics = {
  pezziAtt?: number;
  pezziProi?: number;
  puntiAtt?: number;
  puntiProi?: number;
  sogliaAtt?: string;
  sogliaProi?: string;
  premioAtt?: number;
  premioProi?: number;
};

function PistaCompactRow({
  testId, expanded, onToggle, name, subtitle, metrics, premioColor, children,
}: {
  testId: string;
  expanded: boolean;
  onToggle: () => void;
  name: string;
  subtitle?: string;
  metrics: CompactRowMetrics;
  premioColor?: 'green' | 'orange';
  children?: React.ReactNode;
}) {
  const m = metrics;
  const showSoglia = !!m.sogliaAtt && m.sogliaAtt !== "N/A";
  const showProiSoglia = !!m.sogliaProi && m.sogliaProi !== "N/A";
  const projDiffersPezzi = m.pezziAtt !== undefined && m.pezziProi !== undefined && m.pezziProi > m.pezziAtt;
  const projDiffersPunti = m.puntiAtt !== undefined && m.puntiProi !== undefined && (m.puntiProi > m.puntiAtt + 0.05 || (showProiSoglia && m.sogliaProi !== m.sogliaAtt));
  const projDiffersPremio = m.premioAtt !== undefined && m.premioProi !== undefined && m.premioProi > m.premioAtt + 0.005;
  const premioCls = premioColor === 'orange' ? 'text-orange-700 dark:text-orange-400' : 'text-green-700 dark:text-green-400';
  return (
    <div className="rounded-lg border" data-testid={`row-pista-${testId}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-2 px-2.5 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-lg text-left"
        data-testid={`btn-expand-row-${testId}`}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />}
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-700 dark:text-gray-200 truncate">{name}</div>
            {subtitle && <div className="text-[11px] text-gray-500 truncate">{subtitle}</div>}
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0 text-xs flex-wrap justify-end pl-5 sm:pl-0">
          {m.pezziAtt !== undefined && (
            <span className="font-medium whitespace-nowrap">
              {m.pezziAtt}
              {projDiffersPezzi && <span className="text-blue-500"> → {m.pezziProi}</span>}
              <span className="text-gray-400 ml-1">pz</span>
            </span>
          )}
          {m.puntiAtt !== undefined && (
            <span className="flex items-center gap-1 whitespace-nowrap">
              <span className="font-medium">{m.puntiAtt.toFixed(1)} pt</span>
              {showSoglia && (
                <Badge className={`text-[10px] px-1.5 py-0 h-4 ${getSogliaColor(m.sogliaAtt!)}`} variant="outline">{m.sogliaAtt}</Badge>
              )}
            </span>
          )}
          {projDiffersPunti && m.puntiProi !== undefined && (
            <span className="flex items-center gap-1 text-blue-600 whitespace-nowrap">
              <TrendingUp className="h-3 w-3" />
              <span className="font-medium">{m.puntiProi.toFixed(1)} pt</span>
              {showProiSoglia && (
                <Badge className={`text-[10px] px-1.5 py-0 h-4 ${getSogliaColor(m.sogliaProi!)}`} variant="outline">{m.sogliaProi}</Badge>
              )}
            </span>
          )}
          {m.premioAtt !== undefined && (m.premioAtt > 0 || (m.premioProi ?? 0) > 0) && (
            <span className={`font-bold whitespace-nowrap ${premioCls}`}>
              {formatEuro(m.premioAtt)}
              {projDiffersPremio && (
                <span className="text-blue-600 ml-1">→ {formatEuro(m.premioProi!)}</span>
              )}
            </span>
          )}
        </div>
      </button>
      {expanded && children && (
        <div className="px-2.5 pb-2.5 pt-2 border-t space-y-1.5">{children}</div>
      )}
    </div>
  );
}

export default function DashboardGaraReale() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const now = new Date();
  const [selectedPeriod, setSelectedPeriod] = useState(`${now.getFullYear()}-${now.getMonth() + 1}`);
  const [expandedPistaCategories, setExpandedPistaCategories] = useState<Set<string>>(new Set());
  const [expandedRsRows, setExpandedRsRows] = useState<Set<string>>(new Set());
  const toggleRsRow = useCallback((key: string) => {
    setExpandedRsRows(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);
  const [expandedMobileGroups, setExpandedMobileGroups] = useState<Set<string>>(new Set());
  const [expandedFissoGroups, setExpandedFissoGroups] = useState<Set<string>>(new Set());
  const [selectedConfigId, setSelectedConfigId] = useState<string>("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pdvSortKey, setPdvSortKey] = useState<PdvSortKey>('pezzi_default');
  const [expandedDeviceDrills, setExpandedDeviceDrills] = useState<Set<string>>(new Set());
  const toggleDeviceDrill = useCallback((key: string) => {
    setExpandedDeviceDrills((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);
  const [expandedAggModelloDrills, setExpandedAggModelloDrills] = useState<Set<string>>(new Set());
  const [aggModelloDrillMode, setAggModelloDrillMode] = useState<Record<string, 'pdv' | 'rs'>>({});
  const toggleAggModelloDrill = useCallback((key: string) => {
    setExpandedAggModelloDrills((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const { config: orgSystemTcDefaults } = useTabelleCalcoloConfig();

  const [selMonth, selYear] = useMemo(() => {
    const parts = selectedPeriod.split("-");
    return [parseInt(parts[1]), parseInt(parts[0])];
  }, [selectedPeriod]);

  const monthOptions = useMemo(() => getMonthOptions(), []);

  const { data: configList } = useQuery<GaraConfigListItem[]>({
    queryKey: ["/api/gara-config/list", selMonth, selYear],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/gara-config/list?month=${selMonth}&year=${selYear}`), { credentials: "include" });
      if (!res.ok) throw new Error("Errore lista config");
      return res.json();
    },
  });

  const effectiveConfigId = selectedConfigId || (configList && configList.length > 0 ? configList[0].id : "");

  // Versione delle regole BiSuite mapping. Cambia ogni volta che le regole
  // vengono salvate o mergiate (anche fuori da questa pagina). Inserita nella
  // queryKey delle vendite mappate per forzare un refetch automatico quando
  // le regole cambiano, senza dover reimportare BiSuite o invalidare a mano.
  const { data: mappingVersion } = useQuery<{ rulesUpdatedAt: string | null }>({
    queryKey: ["/api/bisuite-mapping-version"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/bisuite-mapping-version"), { credentials: "include" });
      if (!res.ok) throw new Error("Errore versione mappatura");
      return res.json();
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });
  const rulesUpdatedAt = mappingVersion?.rulesUpdatedAt ?? null;

  const { data: mappedData, isLoading: loadingMapped } = useQuery<MappedSalesResponse>({
    queryKey: ["/api/admin/bisuite-mapped-sales", selMonth, selYear, effectiveConfigId, "inGara", rulesUpdatedAt],
    queryFn: async () => {
      const params = new URLSearchParams({
        month: String(selMonth),
        year: String(selYear),
        inGaraOnly: "true",
      });
      if (effectiveConfigId) params.set("garaConfigId", effectiveConfigId);
      const res = await fetch(apiUrl(`/api/admin/bisuite-mapped-sales?${params.toString()}`), { credentials: "include" });
      if (!res.ok) throw new Error("Errore nel caricamento dati");
      return res.json();
    },
    enabled: !!configList,
  });

  const { data: garaConfig, isLoading: loadingConfig } = useQuery<GaraConfigRecord | null>({
    queryKey: ["/api/gara-config", selMonth, selYear, effectiveConfigId],
    queryFn: async () => {
      if (!effectiveConfigId) {
        const res = await fetch(apiUrl(`/api/gara-config?month=${selMonth}&year=${selYear}`), { credentials: "include" });
        if (!res.ok) throw new Error("Errore config gara");
        return await res.json() as GaraConfigRecord | null;
      }
      const res = await fetch(apiUrl(`/api/gara-config?id=${effectiveConfigId}`), { credentials: "include" });
      if (!res.ok) throw new Error("Errore config gara");
      return await res.json() as GaraConfigRecord | null;
    },
    enabled: !!configList,
  });

  const garaConfigMissing = !loadingConfig && !garaConfig;

  const garaPdvList: GaraConfigPdv[] = garaConfig?.config?.pdvList || [];

  const garaCalcConfig = useMemo(() => {
    const cfg = garaConfig?.config as unknown as Record<string, unknown> | null;
    return {
      pistaMobileConfig: (cfg?.pistaMobileConfig || cfg?.pistaMobile) as OrgConfigResponse["config"]["pistaMobileConfig"] | undefined,
      pistaFissoConfig: (cfg?.pistaFissoConfig || cfg?.pistaFisso) as OrgConfigResponse["config"]["pistaFissoConfig"] | undefined,
      energiaConfig: cfg?.energiaConfig as EnergiaConfig | undefined,
      mobileCategories: cfg?.mobileCategories as MobileCategoryConfig[] | undefined,
      partnershipRewardConfig: cfg?.partnershipRewardConfig as OrgConfigResponse["config"]["partnershipRewardConfig"] | undefined,
      assicurazioniConfig: cfg?.assicurazioniConfig as AssicurazioniConfig | undefined,
      tipologiaGara: (cfg?.tipologiaGara as string) || 'gara_operatore',
      modalitaInserimentoRS: (cfg?.modalitaInserimentoRS as string) || 'per_pdv',
      pistaMobileRSConfig: (cfg?.pistaMobileRSConfig as { sogliePerRS?: Array<{ ragioneSociale: string; soglia1: number; soglia2: number; soglia3: number; soglia4: number; forecastTargetPunti: number; clusterPista: string }> }) || undefined,
      pistaFissoRSConfig: (cfg?.pistaFissoRSConfig as { sogliePerRS?: Array<{ ragioneSociale: string; soglia1: number; soglia2: number; soglia3: number; soglia4: number; soglia5: number; forecastTargetPunti: number }> }) || undefined,
      partnershipRewardRSConfig: (cfg?.partnershipRewardRSConfig as { configPerRS?: Array<{ ragioneSociale: string; target100: number; target80: number; premio100: number; premio80: number }> }) || undefined,
      energiaRSConfig: (cfg?.energiaRSConfig as { configPerRS?: Array<{ ragioneSociale: string; pdvInGara: number; targetNoMalus: number; targetS1: number; targetS2: number; targetS3: number; premio: number; premioS1?: number; premioS2?: number; premioS3?: number; pistaSoglia_S1?: number; pistaSoglia_S2?: number; pistaSoglia_S3?: number; pistaSoglia_S4?: number; pistaSoglia_S5?: number }> }) || undefined,
      assicurazioniRSConfig: (cfg?.assicurazioniRSConfig as { configPerRS?: Array<{ ragioneSociale: string; pdvInGara: number; targetNoMalus: number; targetS1: number; targetS2: number; premio: number; premioS1?: number; premioS2?: number }> }) || undefined,
      extraGaraIvaConfig: cfg?.extraGaraIvaConfig as ExtraGaraConfigOverrides | undefined,
      extraGaraIvaSogliePerRS: cfg?.extraGaraIvaSogliePerRS as ExtraGaraSogliePerRS | undefined,
      tabelleCalcolo: cfg?.tabelleCalcolo as Record<string, unknown> | undefined,
    };
  }, [garaConfig]);

  const puntiVenditaFromGara: OrgConfigPdv[] = useMemo(() => {
    return garaPdvList.map((p) => ({
      id: p.id,
      codicePos: p.codicePos,
      nome: p.nome,
      ragioneSociale: p.ragioneSociale,
      calendar: p.calendar as StoreCalendar,
      clusterMobile: p.clusterMobile,
      clusterFisso: p.clusterFisso,
      clusterCB: p.clusterCB || '',
      abilitaEnergia: p.abilitaEnergia,
      abilitaAssicurazioni: p.abilitaAssicurazioni,
    }));
  }, [garaPdvList]);

  const workdayInfo = useMemo<WorkdayInfo>(() => {
    const calendar = puntiVenditaFromGara[0]?.calendar || DEFAULT_CALENDAR;
    return getWorkdayInfoForMonth(selYear, selMonth - 1, calendar, new Date());
  }, [puntiVenditaFromGara, selMonth, selYear]);

  const pistaStats = useMemo(() => {
    if (!mappedData || garaConfigMissing) return [];

    const puntiVendita = puntiVenditaFromGara;
    const isRSPerRS = garaCalcConfig.tipologiaGara === 'gara_operatore_rs' && garaCalcConfig.modalitaInserimentoRS === 'per_rs';
    const mobileConfigs = garaCalcConfig.pistaMobileConfig?.sogliePerPos || [];
    const fissoConfigs = garaCalcConfig.pistaFissoConfig?.sogliePerPos || [];
    const mobileRSConfigs = garaCalcConfig.pistaMobileRSConfig?.sogliePerRS || [];
    const fissoRSConfigs = garaCalcConfig.pistaFissoRSConfig?.sogliePerRS || [];
    const partnershipRSConfigs = garaCalcConfig.partnershipRewardRSConfig?.configPerRS || [];
    const energiaConfig = garaCalcConfig.energiaConfig;
    const energiaRSConfigs = garaCalcConfig.energiaRSConfig?.configPerRS || [];
    const assicurazioniRSConfigs = garaCalcConfig.assicurazioniRSConfig?.configPerRS || [];
    const energiaPdvInGara = puntiVendita.filter(p => p.abilitaEnergia).map(p => ({ pdvId: p.codicePos, codicePos: p.codicePos, isInGara: true }));
    const mobileCategories = garaCalcConfig.mobileCategories || MOBILE_CATEGORIES_CONFIG_DEFAULT;
    const numPdvInGaraEnergia = energiaPdvInGara.length || puntiVendita.length || 1;
    const partnershipConfigs = garaCalcConfig.partnershipRewardConfig?.configPerPos || [];
    const assicConfig = garaCalcConfig.assicurazioniConfig;
    const assicPdvInGara: AssicurazioniPdvInGara[] = puntiVendita.filter(p => p.abilitaAssicurazioni).map(p => ({ pdvId: p.codicePos, codicePos: p.codicePos, nome: p.nome, inGara: true }));


    const getMobileConfigForPdv = (codicePos: string, ragioneSociale: string): PistaMobilePosConfig | undefined => {
      if (isRSPerRS) {
        const rsConfig = mobileRSConfigs.find(c => normalizeRS(c.ragioneSociale) === normalizeRS(ragioneSociale));
        if (rsConfig) {
          return {
            posCode: codicePos,
            soglia1: rsConfig.soglia1, soglia2: rsConfig.soglia2, soglia3: rsConfig.soglia3, soglia4: rsConfig.soglia4,
            multiplierSoglia1: (rsConfig as Record<string, unknown>).multiplierSoglia1 as number || 1,
            multiplierSoglia2: (rsConfig as Record<string, unknown>).multiplierSoglia2 as number || 1.2,
            multiplierSoglia3: (rsConfig as Record<string, unknown>).multiplierSoglia3 as number || 1.5,
            multiplierSoglia4: (rsConfig as Record<string, unknown>).multiplierSoglia4 as number || 2,
            forecastTargetPunti: rsConfig.forecastTargetPunti,
            clusterPista: rsConfig.clusterPista as unknown as 1 | 2 | 3 | undefined,
          };
        }
        return undefined;
      }
      const found = mobileConfigs.find(c => c.posCode === codicePos) || mobileConfigs[0];
      if (found && !found.multiplierSoglia1) {
        return { ...found, multiplierSoglia1: 1, multiplierSoglia2: 1.2, multiplierSoglia3: 1.5, multiplierSoglia4: 2 };
      }
      return found;
    };

    const getFissoConfigForPdv = (codicePos: string, ragioneSociale: string): PistaFissoPosConfig | undefined => {
      if (isRSPerRS) {
        const rsConfig = fissoRSConfigs.find(c => normalizeRS(c.ragioneSociale) === normalizeRS(ragioneSociale));
        if (rsConfig) {
          return {
            posCode: codicePos,
            soglia1: rsConfig.soglia1, soglia2: rsConfig.soglia2, soglia3: rsConfig.soglia3, soglia4: rsConfig.soglia4, soglia5: rsConfig.soglia5,
            multiplierSoglia1: (rsConfig as unknown as Record<string, unknown>).multiplierSoglia1 as number || 2,
            multiplierSoglia2: (rsConfig as unknown as Record<string, unknown>).multiplierSoglia2 as number || 3,
            multiplierSoglia3: (rsConfig as unknown as Record<string, unknown>).multiplierSoglia3 as number || 3.5,
            multiplierSoglia4: (rsConfig as unknown as Record<string, unknown>).multiplierSoglia4 as number || 4,
            multiplierSoglia5: (rsConfig as unknown as Record<string, unknown>).multiplierSoglia5 as number || 5,
            forecastTargetPunti: rsConfig.forecastTargetPunti,
          };
        }
        return undefined;
      }
      const found = fissoConfigs.find(c => c.posCode === codicePos) || fissoConfigs[0];
      if (found && !(found as unknown as Record<string, unknown>).multiplierSoglia1) {
        return { ...found, multiplierSoglia1: 2, multiplierSoglia2: 3, multiplierSoglia3: 3.5, multiplierSoglia4: 4, multiplierSoglia5: 5 };
      }
      return found;
    };

    const getPartnershipConfigForPdv = (codicePos: string, ragioneSociale: string) => {
      if (isRSPerRS) {
        const rsConfig = partnershipRSConfigs.find(c => normalizeRS(c.ragioneSociale) === normalizeRS(ragioneSociale));
        if (rsConfig) {
          return { posCode: codicePos, config: { target100: rsConfig.target100, target80: rsConfig.target80, premio100: rsConfig.premio100, premio80: rsConfig.premio80 } };
        }
        return undefined;
      }
      return partnershipConfigs.find(c => c.posCode === codicePos);
    };

    const garaTC = garaCalcConfig.tabelleCalcolo as Record<string, Record<string, unknown>> | undefined;
    const fallbackTC = {
      mobile: { puntiAttivazione: Object.fromEntries(orgSystemTcDefaults.mobile.categories.map(c => [c.type, c.punti])), soglieCluster: orgSystemTcDefaults.mobile.soglieCluster, moltiplicatoriCanone: orgSystemTcDefaults.mobile.moltiplicatoriCanone } as Record<string, unknown>,
      energia: { compensiBase: orgSystemTcDefaults.energia.compensiBase, bonusPerContratto: orgSystemTcDefaults.energia.bonusPerContratto, pistaBase: orgSystemTcDefaults.energia.pistaBase, pistaDa4: orgSystemTcDefaults.energia.pistaDa4 } as Record<string, unknown>,
      assicurazioni: { puntiProdotto: orgSystemTcDefaults.assicurazioni.puntiProdotto, premiProdotto: orgSystemTcDefaults.assicurazioni.premiProdotto } as Record<string, unknown>,
      protecta: { gettoniProdotto: orgSystemTcDefaults.protecta.gettoniProdotto } as Record<string, unknown>,
      fisso: { gettoniContrattuali: orgSystemTcDefaults.fisso.gettoniContrattuali, soglieCluster: orgSystemTcDefaults.fisso.soglieCluster, euroPerPezzo: orgSystemTcDefaults.fisso.euroPerPezzo } as Record<string, unknown>,
      extraGara: { puntiAttivazione: orgSystemTcDefaults.extraGara.puntiAttivazione, soglieMultipos: orgSystemTcDefaults.extraGara.soglieMultipos, soglieMonopos: orgSystemTcDefaults.extraGara.soglieMonopos, premiPerSoglia: orgSystemTcDefaults.extraGara.premiPerSoglia } as Record<string, unknown>,
      partnership: { puntiPartnership: orgSystemTcDefaults.partnership.puntiPartnership, gettoniEvento: orgSystemTcDefaults.partnership.gettoniEvento, clusterGettoniUntied: orgSystemTcDefaults.partnership.clusterGettoniUntied, clusterGettoniRivincoli: orgSystemTcDefaults.partnership.clusterGettoniRivincoli } as Record<string, unknown>,
    };
    const mergeSection = (section: string) => {
      const base = fallbackTC[section as keyof typeof fallbackTC] || {};
      const over = garaTC?.[section] || {};
      return { ...base, ...over };
    };
    const tcMobile = mergeSection('mobile') as { puntiAttivazione?: Record<string, number>; soglieCluster?: Record<string, number[]>; moltiplicatoriCanone?: Record<string, number[]> };
    const tcEnergia = mergeSection('energia') as { compensiBase?: Record<string, number>; bonusPerContratto?: Record<string, number>; pistaBase?: Record<string, number>; pistaDa4?: Record<string, number> };
    const tcAssic = mergeSection('assicurazioni') as { puntiProdotto?: Record<string, number>; premiProdotto?: Record<string, number> };
    const tcProtecta = mergeSection('protecta') as { gettoniProdotto?: Record<string, number> };
    const tcFisso = mergeSection('fisso') as { gettoniContrattuali?: Record<string, number>; soglieCluster?: Record<string, number[]>; euroPerPezzo?: Record<string, number> };
    const tcExtraGara = mergeSection('extraGara') as { puntiAttivazione?: Record<string, number>; soglieMultipos?: Record<string, Record<string, number>>; soglieMonopos?: Record<string, Record<string, number>>; premiPerSoglia?: Record<string, number[]> };
    const tcPartnership = mergeSection('partnership') as { puntiPartnership?: Record<string, number>; gettoniEvento?: Record<string, number>; clusterGettoniUntied?: Record<string, number>; clusterGettoniRivincoli?: Record<string, number> };

    const normalizeClusterKey = (clusterStr: string): string => {
      const upper = clusterStr.toUpperCase();
      if (upper === "CC1") return "cc_1";
      if (upper === "CC2") return "cc_2";
      if (upper === "CC3") return "cc_3";
      return clusterStr;
    };
    const getMobileSoglieForCluster = (clusterStr: string | undefined): { soglia1?: number; soglia2?: number; soglia3?: number; soglia4?: number } | undefined => {
      if (!tcMobile?.soglieCluster || !clusterStr) return undefined;
      const key = normalizeClusterKey(clusterStr);
      const vals = tcMobile.soglieCluster[key];
      if (!vals || vals.length < 4) return undefined;
      return { soglia1: vals[0], soglia2: vals[1], soglia3: vals[2], soglia4: vals[3] };
    };
    const getFissoSoglieForCluster = (clusterStr: string | undefined): { soglia1?: number; soglia2?: number; soglia3?: number; soglia4?: number; soglia5?: number } | undefined => {
      if (!tcFisso?.soglieCluster || !clusterStr) return undefined;
      const key = normalizeClusterKey(clusterStr);
      const vals = tcFisso.soglieCluster[key];
      if (!vals || vals.length < 5) return undefined;
      return { soglia1: vals[0], soglia2: vals[1], soglia3: vals[2], soglia4: vals[3], soglia5: vals[4] };
    };
    const effectiveMobileCategories = (() => {
      const base = [...mobileCategories];
      if (tcMobile?.puntiAttivazione) {
        return base.map(cat => {
          const override = tcMobile.puntiAttivazione![cat.type];
          return override !== undefined ? { ...cat, punti: override } : cat;
        });
      }
      return base;
    })();

    const assicCalcMap = calcAssicurazioniForAllPdv(mappedData, puntiVendita, assicConfig, assicPdvInGara, tcAssic?.puntiProdotto, tcAssic?.premiProdotto);
    const protectaCalcMap = calcProtectaForAllPdv(mappedData, puntiVendita, tcProtecta?.gettoniProdotto);

    const effectivePremiExtraGara: Record<string, number[]> = (() => {
      const base = { ...PREMI_EXTRA_GARA };
      if (tcExtraGara?.premiPerSoglia) {
        for (const [key, val] of Object.entries(tcExtraGara.premiPerSoglia)) {
          if (val) base[key as keyof typeof base] = val;
        }
      }
      const overrides = garaCalcConfig.extraGaraIvaConfig?.premiPerSoglia;
      if (overrides) {
        for (const [key, val] of Object.entries(overrides)) {
          if (val) base[key as keyof typeof base] = val;
        }
      }
      return base;
    })();

    const extraGaraResults: ExtraGaraIvaRsResult[] = (() => {
      const pvForExtraGara: PuntoVendita[] = puntiVendita.map(p => {
        const garaPdv = garaPdvList.find(g => g.codicePos === p.codicePos);
        return {
          id: p.codicePos,
          codicePos: p.codicePos,
          nome: p.nome,
          ragioneSociale: p.ragioneSociale,
          calendar: p.calendar,
          tipoPosizione: "strada" as const,
          canale: "franchising" as const,
          clusterMobile: (p.clusterMobile || "") as PuntoVendita["clusterMobile"],
          clusterFisso: (p.clusterFisso || "") as PuntoVendita["clusterFisso"],
          clusterCB: (p.clusterCB || "") as PuntoVendita["clusterCB"],
          clusterPIva: (garaPdv?.clusterPIva || "") as PuntoVendita["clusterPIva"],
          abilitaEnergia: p.abilitaEnergia ?? false,
          abilitaAssicurazioni: p.abilitaAssicurazioni ?? false,
        };
      });

      const mobileEnumValues = new Set(Object.values(MobileActivationType) as string[]);
      const attivatoMobileByPos: Record<string, AttivatoMobileDettaglio[]> = {};
      const attivatoFissoByPos: Record<string, AttivatoFissoRiga[]> = {};
      const attivatoEnergiaByPos: Record<string, EnergiaAttivatoRiga[]> = {};
      const attivatoAssicurazioniByPos: Record<string, AssicurazioniAttivatoRiga> = {};
      const attivatoProtectaByPos: Record<string, ProtectaAttivatoRiga> = {};

      for (const pdv of mappedData.pdvList) {
        const mobileItems = pdv.items.filter(i => i.pista === "mobile" && mobileEnumValues.has(i.targetCategory));
        if (mobileItems.length > 0) {
          attivatoMobileByPos[pdv.codicePos] = mobileItems.map((it, idx) => ({
            id: `b-${idx}`,
            type: it.targetCategory as MobileActivationType,
            pezzi: it.pezzi,
          }));
        }

        const fissoItems = pdv.items.filter(i => i.pista === "fisso");
        const fissoAddons = (pdv.addons || []).filter(a => a.pista === "fisso");
        if (fissoItems.length > 0 || fissoAddons.length > 0) {
          attivatoFissoByPos[pdv.codicePos] = [
            ...fissoItems.map(it => ({
              categoria: it.targetCategory as FissoCategoriaType,
              pezzi: it.pezzi,
            })),
            ...fissoAddons.map(a => ({
              categoria: a.targetCategory as FissoCategoriaType,
              pezzi: a.occorrenze,
            })),
          ];
        }

        const energiaItems = pdv.items.filter(i => i.pista === "energia");
        if (energiaItems.length > 0) {
          attivatoEnergiaByPos[pdv.codicePos] = energiaItems.map((it, idx) => ({
            id: `b-${idx}`,
            category: it.targetCategory as EnergiaCategory,
            pezzi: it.pezzi,
          }));
        }

        const assicItems = pdv.items.filter(i => i.pista === "assicurazioni");
        if (assicItems.length > 0) {
          const riga: AssicurazioniAttivatoRiga = {
            protezionePro: 0, casaFamigliaFull: 0, casaFamigliaPlus: 0, casaFamigliaStart: 0,
            sportFamiglia: 0, sportIndividuale: 0, viaggiVacanze: 0, elettrodomestici: 0,
            micioFido: 0, viaggioMondo: 0, viaggioMondoPremio: 0, reloadForever: 0,
          };
          for (const it of assicItems) {
            const key = it.targetCategory as keyof AssicurazioniAttivatoRiga;
            if (key in riga) riga[key] = it.pezzi;
          }
          attivatoAssicurazioniByPos[pdv.codicePos] = riga;
        }

        const protectaItems = pdv.items.filter(i => i.pista === "protecta");
        if (protectaItems.length > 0) {
          const riga = createEmptyProtectaAttivato();
          for (const it of protectaItems) {
            const key = it.targetCategory as keyof ProtectaAttivatoRiga;
            if (key in riga) riga[key] = it.pezzi;
          }
          attivatoProtectaByPos[pdv.codicePos] = riga;
        }
      }

      const mergedExtraGaraOverrides: ExtraGaraConfigOverrides = {
        ...garaCalcConfig.extraGaraIvaConfig,
      };
      if (tcExtraGara) {
        if (tcExtraGara.puntiAttivazione && !mergedExtraGaraOverrides.puntiAttivazione) {
          mergedExtraGaraOverrides.puntiAttivazione = tcExtraGara.puntiAttivazione;
        }
        if (tcExtraGara.soglieMultipos && !mergedExtraGaraOverrides.soglieMultipos) {
          mergedExtraGaraOverrides.soglieMultipos = tcExtraGara.soglieMultipos;
        }
        if (tcExtraGara.soglieMonopos && !mergedExtraGaraOverrides.soglieMonopos) {
          mergedExtraGaraOverrides.soglieMonopos = tcExtraGara.soglieMonopos;
        }
        if (tcExtraGara.premiPerSoglia && !mergedExtraGaraOverrides.premiPerSoglia) {
          mergedExtraGaraOverrides.premiPerSoglia = tcExtraGara.premiPerSoglia;
        }
      }

      return calcolaExtraGaraIva({
        puntiVendita: pvForExtraGara,
        attivatoMobileByPos,
        attivatoFissoByPos,
        attivatoEnergiaByPos,
        attivatoAssicurazioniByPos,
        attivatoProtectaByPos,
        configOverrides: mergedExtraGaraOverrides,
        soglieOverridePerRS: garaCalcConfig.extraGaraIvaSogliePerRS,
      });
    })();

    const stats: Array<{
      pista: string;
      label: string;
      totalePezzi: number;
      proiezionePezzi: number;
      calc: PistaCalcResult;
      calcProiezione: PistaCalcResult;
      categories: Array<{ category: string; label: string; pezzi: number; canone: number; proiezione: number }>;
      pdvBreakdown: Array<{
        codicePos: string;
        nomeNegozio: string;
        ragioneSociale: string;
        normalizedRS: string;
        pezzi: number;
        proiezione: number;
        pdvCalc: PistaCalcResult;
        categories: Array<{ category: string; label: string; pezzi: number; canone: number }>;
      }>;
      rsCalcBreakdown?: Map<string, { displayName: string; premioAttuale: number; premioProiettato: number; pezziAttuali: number; pezziProiezione: number; sogliaAttuale: string; sogliaProiezione: string; puntiAttuali: number; puntiProiezione: number; forecastTarget?: number; forecastGap?: number; soglieRef?: { s1: number; s2: number; s3: number; s4?: number; s5?: number } }>;
      soglieRef?: { s1: number; s2: number; s3: number; s4?: number; s5?: number };
    }> = [];

    const pisteOrder: (keyof typeof PISTA_CONFIG)[] = ["mobile", "fisso", "energia", "assicurazioni", "partnership", "cb", "protecta", "extra_gara_iva"];

    for (const pista of pisteOrder) {
      if (pista === "extra_gara_iva") {
        const totalPremio = extraGaraResults.reduce((s, r) => s + r.premioTotaleRS, 0);
        const totalPezzi = extraGaraResults.reduce((s, r) => s + r.pezziTotaliRS, 0);
        const totalPunti = extraGaraResults.reduce((s, r) => s + r.puntiTotaliRS, 0);
        const bestSoglia = extraGaraResults.reduce((s, r) => Math.max(s, r.sogliaRaggiunta), 0);
        const proiezionePezziEG = workdayInfo.elapsedWorkingDays > 0
          ? Math.round((totalPezzi / workdayInfo.elapsedWorkingDays) * workdayInfo.totalWorkingDays)
          : totalPezzi;
        const proiezionePuntiEG = workdayInfo.elapsedWorkingDays > 0
          ? totalPunti * workdayInfo.totalWorkingDays / workdayInfo.elapsedWorkingDays
          : totalPunti;

        const egCategories: Array<{ category: string; label: string; pezzi: number; canone: number; proiezione: number }> = [];
        const egCatTotals: Record<string, { pezzi: number; label: string }> = {};
        for (const rsResult of extraGaraResults) {
          for (const pdvR of rsResult.pdvResults) {
            const addCat = (key: string, label: string, pezzi: number) => {
              if (pezzi > 0) {
                if (!egCatTotals[key]) egCatTotals[key] = { pezzi: 0, label };
                egCatTotals[key].pezzi += pezzi;
              }
            };
            addCat("worldStaff", "World/Staff", pdvR.pezziWorldStaff);
            addCat("fullPlus", "Full Plus/Data 60-100", pdvR.pezziFullPlus);
            addCat("flexSpecial", "Flex/Special/Data 10", pdvR.pezziFlexSpecial);
            addCat("fissoPIva", "Fisso P.IVA", pdvR.pezziFissoPIva);
            addCat("fritzBox", "FRITZ!Box", pdvR.pezziFritzBox);
            addCat("luceGas", "Luce/Gas Business", pdvR.pezziLuceGas);
            addCat("protezionePro", "Protezione Pro", pdvR.pezziProtezionePro);
            addCat("negozioProtetti", "Negozio Protetti", pdvR.pezziNegozioProtetti);
          }
        }
        for (const [key, val] of Object.entries(egCatTotals)) {
          const proj = workdayInfo.elapsedWorkingDays > 0
            ? Math.round((val.pezzi / workdayInfo.elapsedWorkingDays) * workdayInfo.totalWorkingDays) : val.pezzi;
          egCategories.push({ category: key, label: val.label, pezzi: val.pezzi, canone: 0, proiezione: proj });
        }
        egCategories.sort((a, b) => b.pezzi - a.pezzi);

        const egPdvBreakdown = extraGaraResults.flatMap(rsResult =>
          rsResult.pdvResults.filter(p => p.pezziTotali > 0).map(pdvR => {
            const pdvProj = workdayInfo.elapsedWorkingDays > 0
              ? Math.round((pdvR.pezziTotali / workdayInfo.elapsedWorkingDays) * workdayInfo.totalWorkingDays) : pdvR.pezziTotali;
            return {
              codicePos: pdvR.pdvCode,
              nomeNegozio: pdvR.nome,
              ragioneSociale: pdvR.ragioneSociale,
              normalizedRS: normalizeRS(pdvR.ragioneSociale),
              pezzi: pdvR.pezziTotali,
              proiezione: pdvProj,
              pdvCalc: {
                premioStimato: pdvR.premioTotale,
                puntiTotali: pdvR.puntiTotali,
                sogliaRaggiunta: rsResult.sogliaRaggiunta,
                sogliaLabel: sogliaToLabel(rsResult.sogliaRaggiunta, 4),
              } as PistaCalcResult,
              categories: [
                { category: "worldStaff", label: "World/Staff", pezzi: pdvR.pezziWorldStaff, canone: 0 },
                { category: "fullPlus", label: "Full Plus/Data 60-100", pezzi: pdvR.pezziFullPlus, canone: 0 },
                { category: "flexSpecial", label: "Flex/Special/Data 10", pezzi: pdvR.pezziFlexSpecial, canone: 0 },
                { category: "fissoPIva", label: "Fisso P.IVA", pezzi: pdvR.pezziFissoPIva, canone: 0 },
                { category: "fritzBox", label: "FRITZ!Box", pezzi: pdvR.pezziFritzBox, canone: 0 },
                { category: "luceGas", label: "Luce/Gas Business", pezzi: pdvR.pezziLuceGas, canone: 0 },
                { category: "protezionePro", label: "Protezione Pro", pezzi: pdvR.pezziProtezionePro, canone: 0 },
                { category: "negozioProtetti", label: "Negozio Protetti", pezzi: pdvR.pezziNegozioProtetti, canone: 0 },
              ].filter(c => c.pezzi > 0),
            };
          })
        ).sort((a, b) => b.pezzi - a.pezzi);

        let egRsCalcBreakdown: typeof stats[0]["rsCalcBreakdown"] | undefined;
        if (isRSPerRS && extraGaraResults.length > 0) {
          egRsCalcBreakdown = new Map();
          let egTotalPremioProj = 0;
          for (const rsResult of extraGaraResults) {
            const projPunti = workdayInfo.elapsedWorkingDays > 0
              ? rsResult.puntiTotaliRS * workdayInfo.totalWorkingDays / workdayInfo.elapsedWorkingDays
              : rsResult.puntiTotaliRS;
            const projPezzi = workdayInfo.elapsedWorkingDays > 0
              ? Math.round(rsResult.pezziTotaliRS * workdayInfo.totalWorkingDays / workdayInfo.elapsedWorkingDays)
              : rsResult.pezziTotaliRS;
            let projSoglia = 0;
            if (rsResult.hasBPInRS && projPunti >= rsResult.soglie.s4) projSoglia = 4;
            else if (projPunti >= rsResult.soglie.s3) projSoglia = 3;
            else if (projPunti >= rsResult.soglie.s2) projSoglia = 2;
            else if (projPunti >= rsResult.soglie.s1) projSoglia = 1;

            let projPremio = 0;
            for (const pdvR of rsResult.pdvResults) {
              const clusterKey = pdvR.clusterPIva;
              if (clusterKey && effectivePremiExtraGara[clusterKey]) {
                const projPdvPezzi = workdayInfo.elapsedWorkingDays > 0
                  ? Math.round(pdvR.pezziTotali * workdayInfo.totalWorkingDays / workdayInfo.elapsedWorkingDays)
                  : pdvR.pezziTotali;
                projPremio += projPdvPezzi * (effectivePremiExtraGara[clusterKey][projSoglia] || 0);
              }
            }
            egTotalPremioProj += projPremio;

            egRsCalcBreakdown.set(normalizeRS(rsResult.ragioneSociale), {
              displayName: rsResult.ragioneSociale,
              premioAttuale: rsResult.premioTotaleRS,
              premioProiettato: projPremio,
              pezziAttuali: rsResult.pezziTotaliRS,
              pezziProiezione: projPezzi,
              sogliaAttuale: sogliaToLabel(rsResult.sogliaRaggiunta, 4),
              sogliaProiezione: sogliaToLabel(projSoglia, 4),
              puntiAttuali: rsResult.puntiTotaliRS,
              puntiProiezione: projPunti,
              soglieRef: rsResult.soglie,
            });
          }

          const bestSogliaProj = extraGaraResults.reduce((s, r) => {
            const pp = workdayInfo.elapsedWorkingDays > 0
              ? r.puntiTotaliRS * workdayInfo.totalWorkingDays / workdayInfo.elapsedWorkingDays : r.puntiTotaliRS;
            let ps = 0;
            if (r.hasBPInRS && pp >= r.soglie.s4) ps = 4;
            else if (pp >= r.soglie.s3) ps = 3;
            else if (pp >= r.soglie.s2) ps = 2;
            else if (pp >= r.soglie.s1) ps = 1;
            return Math.max(s, ps);
          }, 0);

          stats.push({
            pista, label: PISTA_CONFIG[pista].label,
            totalePezzi: totalPezzi, proiezionePezzi: proiezionePezziEG,
            calc: { premioStimato: totalPremio, puntiTotali: totalPunti, sogliaRaggiunta: bestSoglia, sogliaLabel: sogliaToLabel(bestSoglia, 4) },
            calcProiezione: { premioStimato: egTotalPremioProj, puntiTotali: proiezionePuntiEG, sogliaRaggiunta: bestSogliaProj, sogliaLabel: sogliaToLabel(bestSogliaProj, 4) },
            categories: egCategories, pdvBreakdown: egPdvBreakdown, rsCalcBreakdown: egRsCalcBreakdown,
          });
        } else {
          let projPremioNonRS = 0;
          let projSogliaNonRS = 0;
          for (const rsResult of extraGaraResults) {
            const projPuntiRS = workdayInfo.elapsedWorkingDays > 0
              ? rsResult.puntiTotaliRS * workdayInfo.totalWorkingDays / workdayInfo.elapsedWorkingDays
              : rsResult.puntiTotaliRS;
            let pSoglia = 0;
            if (rsResult.hasBPInRS && projPuntiRS >= rsResult.soglie.s4) pSoglia = 4;
            else if (projPuntiRS >= rsResult.soglie.s3) pSoglia = 3;
            else if (projPuntiRS >= rsResult.soglie.s2) pSoglia = 2;
            else if (projPuntiRS >= rsResult.soglie.s1) pSoglia = 1;
            if (pSoglia > projSogliaNonRS) projSogliaNonRS = pSoglia;

            for (const pdvR of rsResult.pdvResults) {
              const clusterKey = pdvR.clusterPIva;
              if (clusterKey && effectivePremiExtraGara[clusterKey]) {
                const projPdvPezzi = workdayInfo.elapsedWorkingDays > 0
                  ? Math.round(pdvR.pezziTotali * workdayInfo.totalWorkingDays / workdayInfo.elapsedWorkingDays)
                  : pdvR.pezziTotali;
                projPremioNonRS += projPdvPezzi * (effectivePremiExtraGara[clusterKey][pSoglia] || 0);
              }
            }
          }

          const egSoglieRefNonRS = extraGaraResults.length > 0 ? extraGaraResults[0].soglie : undefined;
          stats.push({
            pista, label: PISTA_CONFIG[pista].label,
            totalePezzi: totalPezzi, proiezionePezzi: proiezionePezziEG,
            calc: { premioStimato: totalPremio, puntiTotali: totalPunti, sogliaRaggiunta: bestSoglia, sogliaLabel: sogliaToLabel(bestSoglia, 4) },
            calcProiezione: { premioStimato: projPremioNonRS, puntiTotali: proiezionePuntiEG, sogliaRaggiunta: projSogliaNonRS, sogliaLabel: sogliaToLabel(projSogliaNonRS, 4) },
            categories: egCategories, pdvBreakdown: egPdvBreakdown,
            soglieRef: egSoglieRefNonRS,
          });
        }
        continue;
      }

      const pistaData = mappedData.totaliPerPista[pista];
      if (!pistaData) {
        stats.push({
          pista,
          label: PISTA_CONFIG[pista].label,
          totalePezzi: 0,
          proiezionePezzi: 0,
          calc: EMPTY_CALC,
          calcProiezione: EMPTY_CALC,
          categories: [],
          pdvBreakdown: [],
        });
        continue;
      }

      const baseCategories = Object.values(pistaData).map((cat: any) => {
        const proiezione = workdayInfo.elapsedWorkingDays > 0
          ? Math.round((cat.pezzi / workdayInfo.elapsedWorkingDays) * workdayInfo.totalWorkingDays)
          : cat.pezzi;
        return {
          category: cat.targetCategory,
          label: cat.targetLabel,
          pezzi: cat.pezzi,
          canone: cat.canone || 0,
          proiezione,
        };
      });
      const addonPistaData = mappedData.totaliAddonsPerPista?.[pista];
      const addonCategories = addonPistaData ? Object.values(addonPistaData).map((cat: any) => {
        const proiezione = workdayInfo.elapsedWorkingDays > 0
          ? Math.round((cat.occorrenze / workdayInfo.elapsedWorkingDays) * workdayInfo.totalWorkingDays)
          : cat.occorrenze;
        return {
          category: cat.targetCategory,
          label: cat.targetLabel,
          pezzi: cat.occorrenze,
          canone: cat.canone || 0,
          proiezione,
        };
      }) : [];
      const categories = [...baseCategories, ...addonCategories].sort((a, b) => b.pezzi - a.pezzi);

      const totalePezzi = pista === "mobile"
        ? categories.filter(c => SIM_CONSUMER_CORE.has(c.category) || SIM_PIVA_CORE.has(c.category)).reduce((sum, c) => sum + c.pezzi, 0)
        : pista === "fisso"
          ? categories.filter(c => FISSO_CONSUMER_CORE.has(c.category) || FISSO_BUSINESS_CORE.has(c.category)).reduce((sum, c) => sum + c.pezzi, 0)
          : categories.reduce((sum, c) => sum + c.pezzi, 0);
      const proiezionePezzi = workdayInfo.elapsedWorkingDays > 0
        ? Math.round((totalePezzi / workdayInfo.elapsedWorkingDays) * workdayInfo.totalWorkingDays)
        : totalePezzi;

      let aggregateCalc: PistaCalcResult = EMPTY_CALC;
      let aggregateCalcProiezione: PistaCalcResult = EMPTY_CALC;

      const pdvBreakdown = mappedData.pdvList
        .map((pdv) => {
          const pdvItems = pdv.items.filter((i) => i.pista === pista);
          const pdvPezzi = pista === "mobile"
            ? pdvItems.filter(i => SIM_CONSUMER_CORE.has(i.targetCategory) || SIM_PIVA_CORE.has(i.targetCategory)).reduce((s, i) => s + i.pezzi, 0)
            : pista === "fisso"
              ? pdvItems.filter(i => FISSO_CONSUMER_CORE.has(i.targetCategory) || FISSO_BUSINESS_CORE.has(i.targetCategory)).reduce((s, i) => s + i.pezzi, 0)
              : pdvItems.reduce((s, i) => s + i.pezzi, 0);
          const pdvProiezione = workdayInfo.elapsedWorkingDays > 0
            ? Math.round((pdvPezzi / workdayInfo.elapsedWorkingDays) * workdayInfo.totalWorkingDays)
            : pdvPezzi;

          const pdvConfig = puntiVendita.find((p) => p.codicePos === pdv.codicePos);
          const pdvCalendar = pdvConfig?.calendar || DEFAULT_CALENDAR;
          const pdvWorkday = getWorkdayInfoForMonth(selYear, selMonth - 1, pdvCalendar, new Date());

          let pdvCalc = EMPTY_CALC;
          const pdvRS = pdvConfig?.ragioneSociale || pdv.ragioneSociale;
          if (pista === "mobile") {
            const mConfig = getMobileConfigForPdv(pdv.codicePos, pdvRS);
            const clusterMobile = pdvConfig?.clusterMobile;
            pdvCalc = calcMobilePerPdv(pdvItems, mConfig, pdvCalendar, selYear, selMonth, effectiveMobileCategories, pdvWorkday, getMobileSoglieForCluster(clusterMobile), tcMobile?.moltiplicatoriCanone);
          } else if (pista === "fisso") {
            const fConfig = getFissoConfigForPdv(pdv.codicePos, pdvRS);
            const cluster = clusterToNumber(pdvConfig?.clusterFisso);
            pdvCalc = calcFissoPerPdv(pdvItems, fConfig, pdvCalendar, cluster, pdv.codicePos, selYear, selMonth, pdvWorkday, tcFisso?.gettoniContrattuali, getFissoSoglieForCluster(pdvConfig?.clusterFisso), tcFisso?.euroPerPezzo, pdv.addons);
          } else if (pista === "energia") {
            const isInGara = energiaPdvInGara.some((e) => (e.codicePos === pdv.codicePos || e.pdvId === pdv.codicePos) && e.isInGara);
            pdvCalc = calcEnergiaPerPdv(pdvItems, energiaConfig, pdv.codicePos, isInGara, numPdvInGaraEnergia, tcEnergia?.compensiBase, undefined, tcEnergia?.bonusPerContratto, tcEnergia?.pistaBase, tcEnergia?.pistaDa4);
          } else if (pista === "partnership") {
            const pCfg = getPartnershipConfigForPdv(pdv.codicePos, pdvRS);
            const prConfig: PartnershipRewardPosConfig | undefined = pCfg ? { posCode: pCfg.posCode, config: pCfg.config } : undefined;
            pdvCalc = calcPartnershipPerPdv(pdvItems, prConfig, pdvWorkday.elapsedWorkingDays, pdv.codicePos, tcPartnership, pdvConfig?.clusterCB);
          } else if (pista === "cb") {
            const cbAddons = (pdv.addons || []).filter(a => a.pista === 'cb');
            pdvCalc = calcCBFromItemsAndAddons(pdvItems, cbAddons, pdvConfig?.clusterCB);
          } else if (pista === "assicurazioni") {
            pdvCalc = assicCalcMap.get(pdv.codicePos) || EMPTY_CALC;
          } else if (pista === "protecta") {
            pdvCalc = protectaCalcMap.get(pdv.codicePos) || EMPTY_CALC;
          }

          const configuredRS = pdvConfig?.ragioneSociale || pdv.ragioneSociale;
          const normalizedConfiguredRS = normalizeRS(configuredRS);

          const pdvAddons = (pdv.addons || []).filter(a => a.pista === pista);
          const addonAsCats = pdvAddons.map(a => ({ category: a.targetCategory, label: a.targetLabel, pezzi: a.occorrenze, canone: a.canone || 0 }));
          return {
            codicePos: pdv.codicePos,
            nomeNegozio: pdv.nomeNegozio,
            ragioneSociale: configuredRS,
            normalizedRS: normalizedConfiguredRS,
            pezzi: pdvPezzi,
            proiezione: pdvProiezione,
            pdvCalc,
            categories: [
              ...pdvItems.map((i) => ({ category: i.targetCategory, label: i.targetLabel, pezzi: i.pezzi, canone: i.canone || 0 })),
              ...addonAsCats,
            ],
            addons: pdvAddons,
          };
        })
        .filter((p) => p.pezzi > 0 || (p.addons && p.addons.length > 0))
        .sort((a, b) => b.pezzi - a.pezzi);

      let rsCalcBreakdownMap: Map<string, { displayName: string; premioAttuale: number; premioProiettato: number; pezziAttuali: number; pezziProiezione: number; sogliaAttuale: string; sogliaProiezione: string; puntiAttuali: number; puntiProiezione: number; forecastTarget?: number; forecastGap?: number; soglieRef?: { s1: number; s2: number; s3: number; s4?: number; s5?: number } }> | undefined;

      if (pdvBreakdown.length > 0) {
        const useRSAggregation = isRSPerRS && (pista === "mobile" || pista === "fisso" || pista === "partnership" || pista === "cb" || pista === "energia" || pista === "assicurazioni");

        if (useRSAggregation) {
          const rsGroupMap = new Map<string, typeof pdvBreakdown>();
          for (const pdv of pdvBreakdown) {
            const rsKey = normalizeRS(pdv.ragioneSociale || 'Senza RS');
            if (!rsGroupMap.has(rsKey)) rsGroupMap.set(rsKey, []);
            rsGroupMap.get(rsKey)!.push(pdv);
          }

          let totalPremio = 0;
          let totalPunti = 0;
          let bestSoglia = 0;
          let totalPremioProj = 0;
          let totalPuntiProj = 0;
          let bestSogliaProj = 0;
          rsCalcBreakdownMap = new Map<string, { displayName: string; premioAttuale: number; premioProiettato: number; pezziAttuali: number; pezziProiezione: number; sogliaAttuale: string; sogliaProiezione: string; puntiAttuali: number; puntiProiezione: number; forecastTarget?: number; forecastGap?: number; soglieRef?: { s1: number; s2: number; s3: number; s4?: number; s5?: number } }>();

          rsGroupMap.forEach((rsPdvs, rs) => {
            const rsItems: AggregatedItem[] = [];
            const rsAddonsRaw: AddonItem[] = [];
            for (const pdv of rsPdvs) {
              const pdvItems2 = pdv.categories.map(c => ({ pista, targetCategory: c.category, targetLabel: c.label, pezzi: c.pezzi, canone: c.canone || 0 }));
              rsItems.push(...pdvItems2);
              if (pdv.addons) rsAddonsRaw.push(...pdv.addons);
            }
            const mergedItems = new Map<string, AggregatedItem>();
            for (const item of rsItems) {
              const key = item.targetCategory;
              if (mergedItems.has(key)) {
                mergedItems.get(key)!.pezzi += item.pezzi;
                mergedItems.get(key)!.canone += item.canone;
              } else {
                mergedItems.set(key, { ...item });
              }
            }
            const aggregatedRSItems = Array.from(mergedItems.values());
            const mergedAddons = new Map<string, AddonItem>();
            for (const addon of rsAddonsRaw) {
              const key = addon.targetCategory;
              if (mergedAddons.has(key)) {
                mergedAddons.get(key)!.occorrenze += addon.occorrenze;
                mergedAddons.get(key)!.canone += addon.canone;
              } else {
                mergedAddons.set(key, { ...addon });
              }
            }
            const aggregatedRSAddons = Array.from(mergedAddons.values());

            const rsPezziAttuali = pista === "mobile"
              ? aggregatedRSItems.filter(i => SIM_CONSUMER_CORE.has(i.targetCategory) || SIM_PIVA_CORE.has(i.targetCategory)).reduce((s, i) => s + i.pezzi, 0)
              : pista === "fisso"
                ? aggregatedRSItems.filter(i => FISSO_CONSUMER_CORE.has(i.targetCategory) || FISSO_BUSINESS_CORE.has(i.targetCategory)).reduce((s, i) => s + i.pezzi, 0)
                : aggregatedRSItems.reduce((s, i) => s + i.pezzi, 0);

            const firstPdvConfig = puntiVendita.find(p => p.codicePos === rsPdvs[0].codicePos);
            const rsCalendar = firstPdvConfig?.calendar || DEFAULT_CALENDAR;
            const rsWorkday = getWorkdayInfoForMonth(selYear, selMonth - 1, rsCalendar, new Date());

            const rsPezziProiezione = rsWorkday.elapsedWorkingDays > 0
              ? Math.round((rsPezziAttuali / rsWorkday.elapsedWorkingDays) * rsWorkday.totalWorkingDays)
              : rsPezziAttuali;

            let rsCalc = EMPTY_CALC;
            if (pista === "mobile") {
              const mConfig = getMobileConfigForPdv(rsPdvs[0].codicePos, rs);
              const rsClusterMobile = firstPdvConfig?.clusterMobile;
              rsCalc = calcMobilePerPdv(aggregatedRSItems, mConfig, rsCalendar, selYear, selMonth, effectiveMobileCategories, rsWorkday, getMobileSoglieForCluster(rsClusterMobile), tcMobile?.moltiplicatoriCanone);
            } else if (pista === "fisso") {
              const fConfig = getFissoConfigForPdv(rsPdvs[0].codicePos, rs);
              const cluster = clusterToNumber(firstPdvConfig?.clusterFisso);
              rsCalc = calcFissoPerPdv(aggregatedRSItems, fConfig, rsCalendar, cluster, rsPdvs[0].codicePos, selYear, selMonth, rsWorkday, tcFisso?.gettoniContrattuali, getFissoSoglieForCluster(firstPdvConfig?.clusterFisso), tcFisso?.euroPerPezzo, aggregatedRSAddons);
            } else if (pista === "partnership") {
              const pCfg = getPartnershipConfigForPdv(rsPdvs[0].codicePos, rs);
              const prConfig: PartnershipRewardPosConfig | undefined = pCfg ? { posCode: pCfg.posCode, config: pCfg.config } : undefined;
              rsCalc = calcPartnershipPerPdv(aggregatedRSItems, prConfig, rsWorkday.elapsedWorkingDays, rsPdvs[0].codicePos, tcPartnership, firstPdvConfig?.clusterCB);
            } else if (pista === "cb") {
              rsCalc = calcCBFromItems(aggregatedRSItems, firstPdvConfig?.clusterCB);
            } else if (pista === "energia") {
              const rsEConf = energiaRSConfigs.find(c => normalizeRS(c.ragioneSociale) === rs);
              const rsEnergiaConfig: EnergiaConfig | undefined = rsEConf ? {
                pdvInGara: rsEConf.pdvInGara,
                targetNoMalus: rsEConf.targetNoMalus,
                targetS1: rsEConf.targetS1,
                targetS2: rsEConf.targetS2,
                targetS3: rsEConf.targetS3,
                premio: rsEConf.premio,
                premioS1: rsEConf.premioS1,
                premioS2: rsEConf.premioS2,
                premioS3: rsEConf.premioS3,
                pistaSoglia_S1: rsEConf.pistaSoglia_S1,
                pistaSoglia_S2: rsEConf.pistaSoglia_S2,
                pistaSoglia_S3: rsEConf.pistaSoglia_S3,
                pistaSoglia_S4: rsEConf.pistaSoglia_S4,
                pistaSoglia_S5: rsEConf.pistaSoglia_S5,
              } : energiaConfig;
              const rsNumPdv = rsEConf?.pdvInGara || rsPdvs.filter(p => {
                const pc = puntiVendita.find(pv => pv.codicePos === p.codicePos);
                return pc?.abilitaEnergia;
              }).length || 1;
              rsCalc = calcEnergiaPerPdv(aggregatedRSItems, rsEnergiaConfig, rsPdvs[0].codicePos, true, rsNumPdv, tcEnergia?.compensiBase, undefined, tcEnergia?.bonusPerContratto, tcEnergia?.pistaBase, tcEnergia?.pistaDa4);
              if (rsCalc.sogliaRaggiunta >= 1) {
                const cfgE = rsEConf || energiaConfig;
                const premioPerPdv = rsCalc.sogliaRaggiunta >= 3
                  ? (cfgE?.premioS3 ?? cfgE?.premio ?? 1000)
                  : rsCalc.sogliaRaggiunta >= 2
                    ? (cfgE?.premioS2 ?? cfgE?.premio ?? 500)
                    : (cfgE?.premioS1 ?? cfgE?.premio ?? 250);
                rsCalc = { ...rsCalc, premioStimato: premioPerPdv * rsNumPdv };
              }
            } else if (pista === "assicurazioni") {
              const rsAConf = assicurazioniRSConfigs.find(c => normalizeRS(c.ragioneSociale) === rs);
              const rsAssicConfig: AssicurazioniConfig | undefined = rsAConf ? {
                pdvInGara: rsAConf.pdvInGara,
                targetNoMalus: rsAConf.targetNoMalus,
                targetS1: rsAConf.targetS1,
                targetS2: rsAConf.targetS2,
                premio: rsAConf.premio,
                premioS1: rsAConf.premioS1,
                premioS2: rsAConf.premioS2,
              } : assicConfig;
              if (rsAssicConfig) {
                let rsTotalPunti = 0;
                for (const pdv of rsPdvs) {
                  const pdvAssicCalc = assicCalcMap.get(pdv.codicePos);
                  if (pdvAssicCalc) rsTotalPunti += pdvAssicCalc.puntiTotali;
                }
                const rsNumPdvAssic = rsAConf?.pdvInGara || rsPdvs.filter(p => {
                  const pc = puntiVendita.find(pv => pv.codicePos === p.codicePos);
                  return pc?.abilitaAssicurazioni;
                }).length || 1;
                let rsSoglia = 0;
                let rsPremio = 0;
                const aS2Val = rsAssicConfig.premioS2 ?? rsAssicConfig.premio ?? 750;
                const aS1Val = rsAssicConfig.premioS1 ?? rsAssicConfig.premio ?? 500;
                if (rsTotalPunti >= rsAssicConfig.targetS2) { rsSoglia = 2; rsPremio = aS2Val * rsNumPdvAssic; }
                else if (rsTotalPunti >= rsAssicConfig.targetS1) { rsSoglia = 1; rsPremio = aS1Val * rsNumPdvAssic; }
                rsCalc = { premioStimato: rsPremio, puntiTotali: rsTotalPunti, sogliaRaggiunta: rsSoglia, sogliaLabel: sogliaToLabel(rsSoglia) };
              }
            }

            totalPremio += rsCalc.premioStimato;
            totalPunti += rsCalc.puntiTotali;
            if (rsCalc.sogliaRaggiunta > bestSoglia) bestSoglia = rsCalc.sogliaRaggiunta;

            const ratio = rsWorkday.elapsedWorkingDays > 0
              ? rsWorkday.totalWorkingDays / rsWorkday.elapsedWorkingDays
              : 1;
            const projectedRSItems = aggregatedRSItems.map(item => {
              return { ...item, pezzi: Math.round(item.pezzi * ratio), canone: item.canone * ratio };
            });
            const projectedRSAddons = aggregatedRSAddons.map(addon => ({
              ...addon, occorrenze: Math.round(addon.occorrenze * ratio), canone: addon.canone * ratio,
            }));

            let rsProjCalc = EMPTY_CALC;
            if (pista === "mobile") {
              const mConfig = getMobileConfigForPdv(rsPdvs[0].codicePos, rs);
              const rsClusterMobile2 = firstPdvConfig?.clusterMobile;
              rsProjCalc = calcMobilePerPdv(projectedRSItems, mConfig, rsCalendar, selYear, selMonth, effectiveMobileCategories, rsWorkday, getMobileSoglieForCluster(rsClusterMobile2), tcMobile?.moltiplicatoriCanone);
            } else if (pista === "fisso") {
              const fConfig = getFissoConfigForPdv(rsPdvs[0].codicePos, rs);
              const cluster = clusterToNumber(firstPdvConfig?.clusterFisso);
              rsProjCalc = calcFissoPerPdv(projectedRSItems, fConfig, rsCalendar, cluster, rsPdvs[0].codicePos, selYear, selMonth, rsWorkday, tcFisso?.gettoniContrattuali, getFissoSoglieForCluster(firstPdvConfig?.clusterFisso), tcFisso?.euroPerPezzo, projectedRSAddons);
            } else if (pista === "partnership") {
              const pCfg = getPartnershipConfigForPdv(rsPdvs[0].codicePos, rs);
              const prConfig: PartnershipRewardPosConfig | undefined = pCfg ? { posCode: pCfg.posCode, config: pCfg.config } : undefined;
              rsProjCalc = calcPartnershipPerPdv(projectedRSItems, prConfig, rsWorkday.totalWorkingDays, rsPdvs[0].codicePos, tcPartnership, firstPdvConfig?.clusterCB);
            } else if (pista === "cb") {
              rsProjCalc = calcCBFromItems(projectedRSItems, firstPdvConfig?.clusterCB);
            } else if (pista === "energia") {
              const rsEConf = energiaRSConfigs.find(c => normalizeRS(c.ragioneSociale) === rs);
              const rsEnergiaConfig: EnergiaConfig | undefined = rsEConf ? {
                pdvInGara: rsEConf.pdvInGara, targetNoMalus: rsEConf.targetNoMalus,
                targetS1: rsEConf.targetS1, targetS2: rsEConf.targetS2, targetS3: rsEConf.targetS3,
                premio: rsEConf.premio,
                premioS1: rsEConf.premioS1, premioS2: rsEConf.premioS2, premioS3: rsEConf.premioS3,
                pistaSoglia_S1: rsEConf.pistaSoglia_S1,
                pistaSoglia_S2: rsEConf.pistaSoglia_S2, pistaSoglia_S3: rsEConf.pistaSoglia_S3,
                pistaSoglia_S4: rsEConf.pistaSoglia_S4, pistaSoglia_S5: rsEConf.pistaSoglia_S5,
              } : energiaConfig;
              const rsNumPdv = rsEConf?.pdvInGara || rsPdvs.filter(p => {
                const pc = puntiVendita.find(pv => pv.codicePos === p.codicePos);
                return pc?.abilitaEnergia;
              }).length || 1;
              rsProjCalc = calcEnergiaPerPdv(projectedRSItems, rsEnergiaConfig, rsPdvs[0].codicePos, true, rsNumPdv, tcEnergia?.compensiBase, undefined, tcEnergia?.bonusPerContratto, tcEnergia?.pistaBase, tcEnergia?.pistaDa4);
              if (rsProjCalc.sogliaRaggiunta >= 1) {
                const cfgEProj = rsEConf || energiaConfig;
                const premioPerPdv = rsProjCalc.sogliaRaggiunta >= 3
                  ? (cfgEProj?.premioS3 ?? cfgEProj?.premio ?? 1000)
                  : rsProjCalc.sogliaRaggiunta >= 2
                    ? (cfgEProj?.premioS2 ?? cfgEProj?.premio ?? 500)
                    : (cfgEProj?.premioS1 ?? cfgEProj?.premio ?? 250);
                rsProjCalc = { ...rsProjCalc, premioStimato: premioPerPdv * rsNumPdv };
              }
            } else if (pista === "assicurazioni") {
              const rsAConfProj = assicurazioniRSConfigs.find(c => normalizeRS(c.ragioneSociale) === rs);
              const rsAssicConfigProj: AssicurazioniConfig | undefined = rsAConfProj ? {
                pdvInGara: rsAConfProj.pdvInGara, targetNoMalus: rsAConfProj.targetNoMalus,
                targetS1: rsAConfProj.targetS1, targetS2: rsAConfProj.targetS2,
                premio: rsAConfProj.premio, premioS1: rsAConfProj.premioS1, premioS2: rsAConfProj.premioS2,
              } : assicConfig;
              if (rsAssicConfigProj) {
                const totalPuntiProj2 = rsCalc.puntiTotali > 0 && rsWorkday.elapsedWorkingDays > 0
                  ? Math.round(rsCalc.puntiTotali * rsWorkday.totalWorkingDays / rsWorkday.elapsedWorkingDays) : rsCalc.puntiTotali;
                const rsNumPdvAssicProj = rsAConfProj?.pdvInGara || rsPdvs.filter(p => {
                  const pc = puntiVendita.find(pv => pv.codicePos === p.codicePos);
                  return pc?.abilitaAssicurazioni;
                }).length || 1;
                let projSoglia = 0;
                let projPremio = 0;
                const projAS2 = rsAssicConfigProj.premioS2 ?? rsAssicConfigProj.premio ?? 750;
                const projAS1 = rsAssicConfigProj.premioS1 ?? rsAssicConfigProj.premio ?? 500;
                if (totalPuntiProj2 >= rsAssicConfigProj.targetS2) { projSoglia = 2; projPremio = projAS2 * rsNumPdvAssicProj; }
                else if (totalPuntiProj2 >= rsAssicConfigProj.targetS1) { projSoglia = 1; projPremio = projAS1 * rsNumPdvAssicProj; }
                rsProjCalc = { premioStimato: projPremio, puntiTotali: totalPuntiProj2, sogliaRaggiunta: projSoglia, sogliaLabel: sogliaToLabel(projSoglia) };
              }
            }
            totalPremioProj += rsProjCalc.premioStimato;
            totalPuntiProj += rsProjCalc.puntiTotali;
            if (rsProjCalc.sogliaRaggiunta > bestSogliaProj) bestSogliaProj = rsProjCalc.sogliaRaggiunta;

            let rsSoglieRef: { s1: number; s2: number; s3: number; s4?: number; s5?: number } | undefined;
            if (pista === "mobile") {
              const mSoglie = garaCalcConfig.pistaMobileRSConfig?.sogliePerRS?.find(s => normalizeRS(s.ragioneSociale) === rs);
              if (mSoglie) rsSoglieRef = { s1: mSoglie.soglia1, s2: mSoglie.soglia2, s3: mSoglie.soglia3, s4: mSoglie.soglia4 };
            } else if (pista === "fisso") {
              const fSoglie = garaCalcConfig.pistaFissoRSConfig?.sogliePerRS?.find(s => normalizeRS(s.ragioneSociale) === rs);
              if (fSoglie) rsSoglieRef = { s1: fSoglie.soglia1, s2: fSoglie.soglia2, s3: fSoglie.soglia3, s4: fSoglie.soglia4, s5: fSoglie.soglia5 };
            } else if (pista === "energia") {
              const eConf = energiaRSConfigs.find(c => normalizeRS(c.ragioneSociale) === rs);
              if (eConf) rsSoglieRef = { s1: eConf.targetS1, s2: eConf.targetS2, s3: eConf.targetS3 };
            } else if (pista === "assicurazioni") {
              const aConf = assicurazioniRSConfigs.find(c => normalizeRS(c.ragioneSociale) === rs);
              if (aConf) rsSoglieRef = { s1: aConf.targetS1, s2: aConf.targetS2, s3: 0 };
            }

            rsCalcBreakdownMap!.set(rs, {
              displayName: rsPdvs[0].ragioneSociale || rs,
              premioAttuale: rsCalc.premioStimato,
              premioProiettato: rsProjCalc.premioStimato,
              pezziAttuali: rsPezziAttuali,
              pezziProiezione: rsPezziProiezione,
              sogliaAttuale: rsCalc.sogliaLabel,
              sogliaProiezione: rsProjCalc.sogliaLabel,
              puntiAttuali: rsCalc.puntiTotali,
              puntiProiezione: rsProjCalc.puntiTotali,
              forecastTarget: rsCalc.forecastTarget,
              forecastGap: rsCalc.forecastGap,
              soglieRef: rsSoglieRef,
            });
          });

          aggregateCalc = {
            premioStimato: totalPremio,
            puntiTotali: totalPunti,
            sogliaRaggiunta: bestSoglia,
            sogliaLabel: sogliaToLabel(bestSoglia),
          };
          aggregateCalcProiezione = {
            premioStimato: totalPremioProj,
            puntiTotali: totalPuntiProj,
            sogliaRaggiunta: bestSogliaProj,
            sogliaLabel: sogliaToLabel(bestSogliaProj),
          };
        } else {
          let totalPremio = 0;
          let totalPunti = 0;
          let bestSoglia = 0;
          let totalTarget = 0;
          let totalGap = 0;
          let hasTarget = false;
          for (const pdv of pdvBreakdown) {
            totalPremio += pdv.pdvCalc.premioStimato;
            totalPunti += pdv.pdvCalc.puntiTotali;
            if (pdv.pdvCalc.sogliaRaggiunta > bestSoglia) bestSoglia = pdv.pdvCalc.sogliaRaggiunta;
            if (pdv.pdvCalc.forecastTarget) {
              hasTarget = true;
              totalTarget += pdv.pdvCalc.forecastTarget;
              totalGap += pdv.pdvCalc.forecastGap ?? 0;
            }
          }

          if (pista === "energia" && energiaConfig) {
            let aggSoglia = 0;
            const eS1 = (energiaConfig.premioS1 ?? energiaConfig.premio ?? 250) * energiaConfig.pdvInGara;
            const eS2 = (energiaConfig.premioS2 ?? energiaConfig.premio ?? 500) * energiaConfig.pdvInGara;
            const eS3 = (energiaConfig.premioS3 ?? energiaConfig.premio ?? 1000) * energiaConfig.pdvInGara;
            if (totalPunti >= energiaConfig.targetS3) { aggSoglia = 3; totalPremio = eS3; }
            else if (totalPunti >= energiaConfig.targetS2) { aggSoglia = 2; totalPremio = eS2; }
            else if (totalPunti >= energiaConfig.targetS1) { aggSoglia = 1; totalPremio = eS1; }
            bestSoglia = aggSoglia;
          }
          if (pista === "assicurazioni" && assicConfig) {
            let aggSoglia = 0;
            const aS1 = (assicConfig.premioS1 ?? assicConfig.premio ?? 500) * assicConfig.pdvInGara;
            const aS2 = (assicConfig.premioS2 ?? assicConfig.premio ?? 750) * assicConfig.pdvInGara;
            if (totalPunti >= assicConfig.targetS2) { aggSoglia = 2; totalPremio = aS2; }
            else if (totalPunti >= assicConfig.targetS1) { aggSoglia = 1; totalPremio = aS1; }
            bestSoglia = aggSoglia;
          }

          aggregateCalc = {
            premioStimato: totalPremio,
            puntiTotali: totalPunti,
            sogliaRaggiunta: bestSoglia,
            sogliaLabel: sogliaToLabel(bestSoglia),
            forecastTarget: hasTarget ? totalTarget : undefined,
            forecastGap: hasTarget ? totalGap : undefined,
          };

          const projItems = pdvBreakdown.map((pdv) => {
            const pdvConfig2 = puntiVendita.find((p) => p.codicePos === pdv.codicePos);
            const pdvCal = pdvConfig2?.calendar || DEFAULT_CALENDAR;
            const pdvWd = getWorkdayInfoForMonth(selYear, selMonth - 1, pdvCal, new Date());
            const projRatio = pdvWd.elapsedWorkingDays > 0
              ? pdvWd.totalWorkingDays / pdvWd.elapsedWorkingDays
              : 1;
            const projectedItems: AggregatedItem[] = pdv.categories.map((c) => {
              return { pista, targetCategory: c.category, targetLabel: c.label, pezzi: Math.round(c.pezzi * projRatio), canone: (c.canone || 0) * projRatio };
            });
            const projectedAddons: AddonItem[] = (pdv.addons || []).map(a => ({
              ...a, occorrenze: Math.round(a.occorrenze * projRatio), canone: a.canone * projRatio,
            }));
            return { ...pdv, items: projectedItems, addons: projectedAddons };
          });

          let totalPremioProj = 0;
          let totalPuntiProj = 0;
          let bestSogliaProj = 0;
          for (const pdv of projItems) {
            const pdvConfig3 = puntiVendita.find((p) => p.codicePos === pdv.codicePos);
            const pdvCalendar3 = pdvConfig3?.calendar || DEFAULT_CALENDAR;
            const pdvWorkday3 = getWorkdayInfoForMonth(selYear, selMonth - 1, pdvCalendar3, new Date());
            let projCalc = EMPTY_CALC;
            const projRS = pdvConfig3?.ragioneSociale || pdv.ragioneSociale;
            if (pista === "mobile") {
              const mConfig = getMobileConfigForPdv(pdv.codicePos, projRS);
              const clusterMobile3 = pdvConfig3?.clusterMobile;
              projCalc = calcMobilePerPdv(pdv.items, mConfig, pdvCalendar3, selYear, selMonth, effectiveMobileCategories, pdvWorkday3, getMobileSoglieForCluster(clusterMobile3), tcMobile?.moltiplicatoriCanone);
            } else if (pista === "fisso") {
              const fConfig = getFissoConfigForPdv(pdv.codicePos, projRS);
              const cluster = clusterToNumber(pdvConfig3?.clusterFisso);
              projCalc = calcFissoPerPdv(pdv.items, fConfig, pdvCalendar3, cluster, pdv.codicePos, selYear, selMonth, pdvWorkday3, tcFisso?.gettoniContrattuali, getFissoSoglieForCluster(pdvConfig3?.clusterFisso), tcFisso?.euroPerPezzo, pdv.addons);
            } else if (pista === "energia") {
              const isInGara = energiaPdvInGara.some((e) => (e.codicePos === pdv.codicePos || e.pdvId === pdv.codicePos) && e.isInGara);
              projCalc = calcEnergiaPerPdv(pdv.items, energiaConfig, pdv.codicePos, isInGara, numPdvInGaraEnergia, tcEnergia?.compensiBase, undefined, tcEnergia?.bonusPerContratto, tcEnergia?.pistaBase, tcEnergia?.pistaDa4);
            } else if (pista === "partnership") {
              const pCfg = getPartnershipConfigForPdv(pdv.codicePos, projRS);
              const prConfig: PartnershipRewardPosConfig | undefined = pCfg ? { posCode: pCfg.posCode, config: pCfg.config } : undefined;
              projCalc = calcPartnershipPerPdv(pdv.items, prConfig, pdvWorkday3.totalWorkingDays, pdv.codicePos, tcPartnership, pdvConfig3?.clusterCB);
            } else if (pista === "cb") {
              projCalc = calcCBFromItems(pdv.items, pdvConfig3?.clusterCB);
            } else if (pista === "assicurazioni" || pista === "protecta") {
              projCalc = pdv.pdvCalc;
            }
            totalPremioProj += projCalc.premioStimato;
            totalPuntiProj += projCalc.puntiTotali;
            if (projCalc.sogliaRaggiunta > bestSogliaProj) bestSogliaProj = projCalc.sogliaRaggiunta;
          }

          if (pista === "energia" && energiaConfig) {
            let aggSogliaProj = 0;
            const projES1 = (energiaConfig.premioS1 ?? energiaConfig.premio ?? 250) * energiaConfig.pdvInGara;
            const projES2 = (energiaConfig.premioS2 ?? energiaConfig.premio ?? 500) * energiaConfig.pdvInGara;
            const projES3 = (energiaConfig.premioS3 ?? energiaConfig.premio ?? 1000) * energiaConfig.pdvInGara;
            totalPremioProj = 0;
            if (totalPuntiProj >= energiaConfig.targetS3) { aggSogliaProj = 3; totalPremioProj = projES3; }
            else if (totalPuntiProj >= energiaConfig.targetS2) { aggSogliaProj = 2; totalPremioProj = projES2; }
            else if (totalPuntiProj >= energiaConfig.targetS1) { aggSogliaProj = 1; totalPremioProj = projES1; }
            bestSogliaProj = aggSogliaProj;
          }
          if (pista === "assicurazioni" && assicConfig) {
            let aggSogliaProj = 0;
            const projAS1 = (assicConfig.premioS1 ?? assicConfig.premio ?? 500) * assicConfig.pdvInGara;
            const projAS2 = (assicConfig.premioS2 ?? assicConfig.premio ?? 750) * assicConfig.pdvInGara;
            totalPremioProj = 0;
            if (totalPuntiProj >= assicConfig.targetS2) { aggSogliaProj = 2; totalPremioProj = projAS2; }
            else if (totalPuntiProj >= assicConfig.targetS1) { aggSogliaProj = 1; totalPremioProj = projAS1; }
            bestSogliaProj = aggSogliaProj;
          }

          aggregateCalcProiezione = {
            premioStimato: totalPremioProj,
            puntiTotali: totalPuntiProj,
            sogliaRaggiunta: bestSogliaProj,
            sogliaLabel: sogliaToLabel(bestSogliaProj),
          };
        }
      }

      const rsCalcBreakdown = (rsCalcBreakdownMap && rsCalcBreakdownMap.size > 0) ? rsCalcBreakdownMap : undefined;

      let pistaSoglieRef: { s1: number; s2: number; s3: number; s4?: number; s5?: number } | undefined;
      if (!rsCalcBreakdown || rsCalcBreakdown.size <= 1) {
        if (pista === "mobile") {
          if (isRSPerRS) {
            const mSingleRS = garaCalcConfig.pistaMobileRSConfig?.sogliePerRS?.[0];
            if (mSingleRS) pistaSoglieRef = { s1: mSingleRS.soglia1, s2: mSingleRS.soglia2, s3: mSingleRS.soglia3, s4: mSingleRS.soglia4 };
          } else if (pdvBreakdown.length > 0) {
            const firstPdv = pdvBreakdown[0];
            const mCfg = getMobileConfigForPdv(firstPdv.codicePos, firstPdv.ragioneSociale);
            if (mCfg) pistaSoglieRef = { s1: mCfg.soglia1, s2: mCfg.soglia2, s3: mCfg.soglia3, s4: mCfg.soglia4 };
          }
        } else if (pista === "fisso") {
          if (isRSPerRS) {
            const fSingleRS = garaCalcConfig.pistaFissoRSConfig?.sogliePerRS?.[0];
            if (fSingleRS) pistaSoglieRef = { s1: fSingleRS.soglia1, s2: fSingleRS.soglia2, s3: fSingleRS.soglia3, s4: fSingleRS.soglia4, s5: fSingleRS.soglia5 };
          } else if (pdvBreakdown.length > 0) {
            const firstPdv = pdvBreakdown[0];
            const fCfg = getFissoConfigForPdv(firstPdv.codicePos, firstPdv.ragioneSociale);
            if (fCfg) pistaSoglieRef = { s1: fCfg.soglia1, s2: fCfg.soglia2, s3: fCfg.soglia3, s4: fCfg.soglia4, s5: fCfg.soglia5 };
          }
        } else if (pista === "energia" && energiaConfig) {
          pistaSoglieRef = { s1: energiaConfig.targetS1, s2: energiaConfig.targetS2, s3: energiaConfig.targetS3 };
        } else if (pista === "assicurazioni" && assicConfig) {
          pistaSoglieRef = { s1: assicConfig.targetS1, s2: assicConfig.targetS2, s3: 0 };
        }
      }

      stats.push({
        pista,
        label: PISTA_CONFIG[pista].label,
        totalePezzi,
        proiezionePezzi,
        calc: aggregateCalc,
        calcProiezione: aggregateCalcProiezione,
        categories,
        pdvBreakdown,
        rsCalcBreakdown,
        soglieRef: pistaSoglieRef,
      });
    }

    return stats;
  }, [mappedData, workdayInfo, garaCalcConfig, puntiVenditaFromGara, garaConfigMissing, selMonth, selYear, orgSystemTcDefaults]);

  const premioPerRS = useMemo(() => {
    if (!pistaStats.length || garaConfigMissing) return [] as Array<{ displayName: string; premioAttuale: number; premioProiettato: number; dettaglio: Array<{ pista: string; label: string; premioAttuale: number; premioProiettato: number }> }>;
    const isRSPerRS = garaCalcConfig.tipologiaGara === 'gara_operatore_rs' && garaCalcConfig.modalitaInserimentoRS === 'per_rs';
    if (!isRSPerRS) return [];

    const rsMap = new Map<string, { displayName: string; premioAttuale: number; premioProiettato: number; dettaglio: Array<{ pista: string; label: string; premioAttuale: number; premioProiettato: number }> }>();

    for (const pista of pistaStats) {
      if (!pista.rsCalcBreakdown) continue;

      pista.rsCalcBreakdown.forEach((rsData, rsKey) => {
        if (!rsMap.has(rsKey)) {
          rsMap.set(rsKey, { displayName: rsData.displayName, premioAttuale: 0, premioProiettato: 0, dettaglio: [] });
        }
        const entry = rsMap.get(rsKey)!;
        entry.premioAttuale += rsData.premioAttuale;
        entry.premioProiettato += rsData.premioProiettato;
        entry.dettaglio.push({
          pista: pista.pista,
          label: pista.label,
          premioAttuale: rsData.premioAttuale,
          premioProiettato: rsData.premioProiettato,
        });
      });
    }

    return Array.from(rsMap.values()).sort((a, b) => b.premioAttuale - a.premioAttuale);
  }, [pistaStats, garaCalcConfig, garaConfigMissing]);

  const isLoading = loadingMapped || loadingConfig;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900" data-testid="dashboard-gara-reale">
      <AppNavbar title="Incentive W3">
        <Select value={selectedPeriod} onValueChange={(v) => { setSelectedPeriod(v); setSelectedConfigId(""); }} data-testid="select-period">
          <SelectTrigger className="w-[140px] sm:w-[200px] text-xs sm:text-sm" data-testid="select-period-trigger">
            <Calendar className="h-4 w-4 mr-1 sm:mr-2 shrink-0" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {monthOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} data-testid={`select-period-${opt.value}`}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {configList && configList.length > 0 && (
          <Select value={effectiveConfigId} onValueChange={setSelectedConfigId} data-testid="select-config">
            <SelectTrigger className="w-[140px] sm:w-[220px] text-xs sm:text-sm" data-testid="select-config-trigger">
              <Settings className="h-4 w-4 mr-1 sm:mr-2 shrink-0" />
              <SelectValue placeholder="Config" />
            </SelectTrigger>
            <SelectContent>
              {configList.map((c) => (
                <SelectItem key={c.id} value={c.id} data-testid={`select-config-${c.id}`}>
                  {c.name || 'Senza nome'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={isRefreshing}
          data-testid="button-refresh-dashboard"
          onClick={async () => {
            setIsRefreshing(true);
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ["/api/admin/bisuite-mapped-sales", selMonth, selYear] }),
              queryClient.invalidateQueries({ queryKey: ["/api/gara-config", selMonth, selYear, effectiveConfigId] }),
              queryClient.invalidateQueries({ queryKey: ["/api/gara-config/list", selMonth, selYear] }),
            ]);
            const startDate = `${selYear}-${String(selMonth).padStart(2, "0")}-01`;
            const lastDay = new Date(selYear, selMonth, 0).getDate();
            const endDate = `${selYear}-${String(selMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
            fetch(apiUrl("/api/bisuite-fetch"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ start_date: startDate, end_date: endDate }),
            }).then(() => {
              queryClient.invalidateQueries({ queryKey: ["/api/admin/bisuite-mapped-sales", selMonth, selYear] });
            }).catch(() => {});
            setIsRefreshing(false);
          }}
        >
          <RefreshCw className={`h-4 w-4 mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Aggiorna</span>
        </Button>
      </AppNavbar>
      <div className="max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">

        {isLoading ? (
          <div className="flex items-center justify-center py-20" data-testid="loading-state">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            <span className="ml-3 text-gray-500">Caricamento dati...</span>
          </div>
        ) : garaConfigMissing ? (
          <Card data-testid="card-no-gara-config">
            <CardContent className="py-12 text-center">
              <Trophy className="h-12 w-12 mx-auto text-amber-500 mb-4" />
              <p className="text-lg font-medium">Configurazione Gara mancante</p>
              <p className="text-sm text-gray-500 mt-1 mb-4">
                Non esiste una configurazione gara per il mese selezionato. Configura i PDV, cluster e calendari per visualizzare la dashboard.
              </p>
              <Button
                onClick={() => setLocation('/configurazione-gara')}
                data-testid="button-goto-config-gara"
              >
                <Trophy className="h-4 w-4 mr-2" />
                Vai alla Configurazione Gara
              </Button>
            </CardContent>
          </Card>
        ) : !mappedData ? (
          <Card>
            <CardContent className="py-12 text-center">
              <AlertTriangle className="h-12 w-12 mx-auto text-amber-500 mb-4" />
              <p className="text-lg font-medium" data-testid="text-no-data">Nessun dato disponibile</p>
              <p className="text-sm text-gray-500 mt-1">Importa le vendite da BiSuite per visualizzare la dashboard</p>
            </CardContent>
          </Card>
        ) : (
          <>
            {mappedData.latestSaleDate && (
              <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1.5" data-testid="text-latest-sale-info">
                <BarChart3 className="h-4 w-4" />
                Dati aggiornati al: <span className="font-semibold text-gray-700 dark:text-gray-200">{new Date(mappedData.latestSaleDate).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
              </div>
            )}
            {mappedData.inGaraOnly && mappedData.calendarsAvailable && (
              <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5 -mt-1" data-testid="text-in-gara-info">
                <Calendar className="h-3.5 w-3.5" />
                <span>
                  Solo vendite in giorni di gara: <span className="font-semibold text-gray-700 dark:text-gray-200">{mappedData.totalSales.toLocaleString('it-IT')}</span>
                  {typeof mappedData.totalSalesUnfiltered === 'number' && (
                    <> / {mappedData.totalSalesUnfiltered.toLocaleString('it-IT')}</>
                  )}
                  {(mappedData.salesExcludedOutOfGara ?? 0) > 0 && (
                    <> — escluse <span className="font-semibold text-gray-700 dark:text-gray-200">{mappedData.salesExcludedOutOfGara!.toLocaleString('it-IT')}</span> fuori giornata gara</>
                  )}
                </span>
              </div>
            )}
            {mappedData.inGaraOnly && !mappedData.calendarsAvailable && (
              <div className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5 -mt-1" data-testid="text-no-calendar-info">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>Nessun calendario PDV configurato in gara — vengono mostrate tutte le vendite del mese.</span>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-4">
              <Card data-testid="card-total-sales">
                <CardContent className="p-3 sm:py-4 sm:px-6 text-center">
                  <div className="flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm text-gray-500 mb-1">
                    <BarChart3 className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
                    <span className="hidden sm:inline">Vendite Totali</span>
                    <span className="sm:hidden">Vendite</span>
                  </div>
                  <div className="text-xl sm:text-2xl font-bold" data-testid="text-total-sales">{mappedData.totalSales}</div>
                </CardContent>
              </Card>
              <Card data-testid="card-total-articoli">
                <CardContent className="p-3 sm:py-4 sm:px-6 text-center">
                  <div className="flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm text-gray-500 mb-1">
                    <Target className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
                    <span className="hidden sm:inline">Attivazioni Gara</span>
                    <span className="sm:hidden">Attivaz.</span>
                  </div>
                  <div className="text-xl sm:text-2xl font-bold" data-testid="text-total-articoli">{mappedData.totalMapped}</div>
                </CardContent>
              </Card>
              <Card className="col-span-2 sm:col-span-1" data-testid="card-pdv-active">
                <CardContent className="p-3 sm:py-4 sm:px-6 text-center">
                  <div className="flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm text-gray-500 mb-1">
                    <Store className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
                    PDV Attivi
                  </div>
                  <div className="text-xl sm:text-2xl font-bold" data-testid="text-pdv-active">{mappedData.pdvList.length}</div>
                </CardContent>
              </Card>
            </div>

            <Card data-testid="card-workday-info">
              <CardContent className="p-3 sm:py-3 sm:px-6">
                <div className="flex items-center gap-2 sm:gap-6 text-[11px] sm:text-sm flex-wrap">
                  <span className="flex items-center gap-1 sm:gap-1.5">
                    <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-gray-400 shrink-0" />
                    <span className="text-gray-500 hidden sm:inline">Giorni lavorativi:</span>
                    <span className="text-gray-500 sm:hidden">GG:</span>
                    <span className="font-medium" data-testid="text-elapsed-days">{workdayInfo.elapsedWorkingDays}</span>
                    <span className="text-gray-400">/ {workdayInfo.totalWorkingDays}</span>
                  </span>
                  <span className="flex items-center gap-1 sm:gap-1.5">
                    <span className="text-gray-500 hidden sm:inline">Rimanenti:</span>
                    <span className="text-gray-500 sm:hidden">Rim:</span>
                    <span className="font-medium" data-testid="text-remaining-days">{workdayInfo.remainingWorkingDays}</span>
                  </span>
                  <span className="flex items-center gap-1 sm:gap-1.5">
                    <Progress
                      value={workdayInfo.totalWorkingDays > 0 ? (workdayInfo.elapsedWorkingDays / workdayInfo.totalWorkingDays) * 100 : 0}
                      className="w-16 sm:w-24 h-2"
                    />
                    <span className="font-medium" data-testid="text-progress-pct">
                      {workdayInfo.totalWorkingDays > 0 ? Math.round((workdayInfo.elapsedWorkingDays / workdayInfo.totalWorkingDays) * 100) : 0}%
                    </span>
                  </span>
                </div>
              </CardContent>
            </Card>

            {(() => {
              const totalPremioAttuale = pistaStats.reduce((s, p) => s + p.calc.premioStimato, 0);
              const totalPremioProiettato = pistaStats.reduce((s, p) => s + p.calcProiezione.premioStimato, 0);
              if (totalPremioAttuale <= 0 && totalPremioProiettato <= 0) return null;
              return (
                <Card className="border-2 border-green-200 dark:border-green-800 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30" data-testid="card-premio-totale-summary">
                  <CardContent className="py-5">
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-green-100 dark:bg-green-900 rounded-full">
                          <Trophy className="h-6 w-6 text-green-600 dark:text-green-400" />
                        </div>
                        <div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">Premio Attuale</div>
                          <div className="text-2xl font-bold text-green-700 dark:text-green-400" data-testid="text-premio-totale-attuale">
                            {formatEuro(totalPremioAttuale)}
                          </div>
                        </div>
                      </div>
                      {totalPremioProiettato > 0 && (
                        <>
                          <div className="hidden sm:flex items-center">
                            <TrendingUp className="h-5 w-5 text-blue-400 mx-2" />
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="p-2.5 bg-blue-100 dark:bg-blue-900 rounded-full">
                              <TrendingUp className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                            </div>
                            <div>
                              <div className="text-sm text-gray-500 dark:text-gray-400">Premio Proiezione</div>
                              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400" data-testid="text-premio-totale-proiezione">
                                {formatEuro(totalPremioProiettato)}
                              </div>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })()}

            {premioPerRS.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="premio-per-rs-summary">
                {premioPerRS.map((rs) => (
                  <Card key={rs.displayName} className="border-l-4 border-l-green-500" data-testid={`card-premio-rs-${rs.displayName}`}>
                    <CardContent className="py-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Trophy className="h-4 w-4 text-amber-500" />
                          <span className="font-semibold text-sm">{rs.displayName}</span>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-bold text-green-700 dark:text-green-400" data-testid={`text-premio-totale-rs-${rs.displayName}`}>
                            {formatEuro(rs.premioAttuale)}
                          </div>
                          <div className="text-sm text-gray-500">Premio attuale</div>
                          {rs.premioProiettato > 0 && (
                            <div className="text-sm mt-0.5">
                              <TrendingUp className="h-3 w-3 inline mr-1 text-blue-500" />
                              <span className="font-semibold text-blue-600">{formatEuro(rs.premioProiettato)}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="space-y-1">
                        {rs.dettaglio.filter((d: { premioAttuale: number; premioProiettato: number }) => d.premioAttuale > 0 || d.premioProiettato > 0).map((d: { pista: string; label: string; premioAttuale: number; premioProiettato: number }) => (
                          <div key={d.pista} className="flex items-center justify-between text-sm">
                            <span className="text-gray-600 dark:text-gray-300">{d.label}</span>
                            <div className="text-right">
                              <span className="font-medium">{formatEuro(d.premioAttuale)}</span>
                              {d.premioProiettato > 0 && (
                                <span className="text-blue-500 font-medium ml-1">→ {formatEuro(d.premioProiettato)}</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {pistaStats.map((pista) => {
                const pistaConf = PISTA_CONFIG[pista.pista as keyof typeof PISTA_CONFIG];
                if (!pistaConf) return null;
                const Icon = pistaConf.icon;

                return (
                  <Card key={pista.pista} className="overflow-hidden" data-testid={`card-pista-${pista.pista}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base flex items-center gap-2">
                          <div className={`p-1.5 rounded ${pistaConf.color} text-white`}>
                            <Icon className="h-4 w-4" />
                          </div>
                          {pistaConf.label}
                        </CardTitle>
                        {pista.totalePezzi > 0 && (
                          <ProjectionBadge current={pista.totalePezzi} projected={pista.proiezionePezzi} label={pista.pista} />
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {pista.rsCalcBreakdown && pista.rsCalcBreakdown.size > 1 ? (
                        <div className="space-y-1">
                          {Array.from(pista.rsCalcBreakdown.entries()).map(([rsKey, rsData]) => (
                            <div key={rsKey} className="flex items-baseline justify-between">
                              <span className="text-sm text-gray-600 truncate mr-2">{rsData.displayName}</span>
                              <div className="flex items-baseline gap-1.5">
                                <span className="text-xl font-bold" data-testid={`text-pezzi-${pista.pista}-${rsKey}`}>{rsData.pezziAttuali}</span>
                                {rsData.pezziProiezione > rsData.pezziAttuali && (
                                  <span className="text-xs text-blue-500">→ {rsData.pezziProiezione}</span>
                                )}
                              </div>
                            </div>
                          ))}
                          <div className="flex items-baseline justify-between border-t pt-1 mt-1">
                            <span className="text-sm font-medium text-gray-700">Totale</span>
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-2xl font-bold" data-testid={`text-pezzi-${pista.pista}`}>{pista.totalePezzi}</span>
                              <span className="text-xs text-gray-500">pezzi</span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-baseline gap-2">
                          <span className="text-3xl font-bold" data-testid={`text-pezzi-${pista.pista}`}>{pista.totalePezzi}</span>
                          <span className="text-sm text-gray-500">pezzi attuali</span>
                        </div>
                      )}

                      {(() => {
                        if (pista.totalePezzi === 0) return null;
                        const isCB = pista.pista === 'cb';
                        const isPartnership = pista.pista === 'partnership';
                        const premioColorVal: 'green' | 'orange' = isCB ? 'orange' : 'green';
                        const hasRS = !!(pista.rsCalcBreakdown && pista.rsCalcBreakdown.size >= 1);
                        const isMobileFisso = pista.pista === 'mobile' || pista.pista === 'fisso';
                        const pdvList = pista.pdvBreakdown.filter(p => p.pezzi > 0);
                        const usePdv = !hasRS && isMobileFisso && pdvList.length >= 1;

                        type Row = { key: string; testIdSuffix: string; name: string; subtitle?: string; metrics: CompactRowMetrics; detail: React.ReactNode };
                        const rows: Row[] = [];

                        if (hasRS) {
                          for (const [rsKey, rsData] of pista.rsCalcBreakdown!.entries()) {
                            const metrics: CompactRowMetrics = isCB
                              ? { pezziAtt: rsData.pezziAttuali, pezziProi: rsData.pezziProiezione, premioAtt: rsData.premioAttuale, premioProi: rsData.premioProiettato }
                              : isPartnership
                              ? { puntiAtt: rsData.puntiAttuali, puntiProi: rsData.puntiProiezione, premioAtt: rsData.premioAttuale, premioProi: rsData.premioProiettato }
                              : { puntiAtt: rsData.puntiAttuali, puntiProi: rsData.puntiProiezione, sogliaAtt: rsData.sogliaAttuale, sogliaProi: rsData.sogliaProiezione, premioAtt: rsData.premioAttuale, premioProi: rsData.premioProiettato };
                            const detail = isCB ? (
                              <div className="grid grid-cols-2 gap-2">
                                <div className="text-center">
                                  <div className="text-xs text-gray-500">Pezzi</div>
                                  <span className="text-lg font-bold">{rsData.pezziAttuali}</span>
                                  {rsData.pezziProiezione > rsData.pezziAttuali && <div className="text-xs text-blue-500">→ {rsData.pezziProiezione}</div>}
                                </div>
                                <div className="text-center">
                                  <div className="text-xs text-gray-500">Gettoni €</div>
                                  <span className="text-lg font-bold text-orange-700 dark:text-orange-400">{formatEuro(rsData.premioAttuale)}</span>
                                  {rsData.premioProiettato > 0 && rsData.premioProiettato !== rsData.premioAttuale && (
                                    <div className="text-xs text-blue-500 flex items-center justify-center gap-0.5"><TrendingUp className="h-3 w-3" /> {formatEuro(rsData.premioProiettato)}</div>
                                  )}
                                </div>
                              </div>
                            ) : isPartnership ? (
                              <>
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="text-center">
                                    <div className="text-xs text-gray-500">Punti</div>
                                    <span className="text-lg font-bold">{rsData.puntiAttuali.toFixed(0)}</span>
                                    {rsData.puntiProiezione > rsData.puntiAttuali && <div className="text-xs text-blue-500">→ {rsData.puntiProiezione.toFixed(0)}</div>}
                                  </div>
                                  <div className="text-center">
                                    <div className="text-xs text-gray-500">Premio €</div>
                                    <span className="text-lg font-bold text-green-700 dark:text-green-400">{formatEuro(rsData.premioAttuale)}</span>
                                    {rsData.premioProiettato > 0 && rsData.premioProiettato !== rsData.premioAttuale && (
                                      <div className="text-xs text-blue-500 flex items-center justify-center gap-0.5"><TrendingUp className="h-3 w-3" /> {formatEuro(rsData.premioProiettato)}</div>
                                    )}
                                  </div>
                                </div>
                                {rsData.forecastTarget != null && rsData.forecastTarget > 0 && (
                                  <div className="space-y-1">
                                    <div className="flex items-center justify-between text-xs">
                                      <span className="text-gray-500 flex items-center gap-1"><Target className="h-3 w-3" /> Target</span>
                                      <span className="font-medium">{rsData.forecastTarget.toFixed(0)} pt</span>
                                    </div>
                                    <Progress value={Math.min((rsData.puntiAttuali / rsData.forecastTarget) * 100, 100)} className="h-1.5" />
                                    <div className="flex items-center justify-between text-xs">
                                      <span className={`font-medium ${(rsData.forecastGap ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>{(rsData.forecastGap ?? 0) >= 0 ? "+" : ""}{(rsData.forecastGap ?? 0).toFixed(0)} pt</span>
                                      <span className="text-gray-500">{Math.round((rsData.puntiAttuali / rsData.forecastTarget) * 100)}%</span>
                                    </div>
                                  </div>
                                )}
                              </>
                            ) : (
                              <>
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="text-center">
                                    <div className="text-xs text-gray-500">Soglia Att.</div>
                                    <Badge className={`text-sm ${getSogliaColor(rsData.sogliaAttuale)}`} variant="outline">{rsData.sogliaAttuale}</Badge>
                                    {rsData.puntiAttuali > 0 && <div className="text-xs text-gray-500 mt-0.5">{rsData.puntiAttuali.toFixed(1)} pt</div>}
                                  </div>
                                  <div className="text-center">
                                    <div className="text-xs text-gray-500">Proiezione</div>
                                    <Badge className={`text-sm ${getSogliaColor(rsData.sogliaProiezione)}`} variant="outline">{rsData.sogliaProiezione}</Badge>
                                    {rsData.puntiProiezione > 0 && <div className="text-xs text-gray-500 mt-0.5">{rsData.puntiProiezione.toFixed(1)} pt</div>}
                                  </div>
                                </div>
                                {rsData.soglieRef && (
                                  <div className="flex flex-wrap gap-1 justify-center mt-1">
                                    {[
                                      { label: "S1", value: rsData.soglieRef.s1 },
                                      { label: "S2", value: rsData.soglieRef.s2 },
                                      { label: "S3", value: rsData.soglieRef.s3 },
                                      ...(rsData.soglieRef.s4 != null && rsData.soglieRef.s4 > 0 ? [{ label: "S4", value: rsData.soglieRef.s4 }] : []),
                                      ...(rsData.soglieRef.s5 != null && rsData.soglieRef.s5 > 0 ? [{ label: "S5", value: rsData.soglieRef.s5 }] : []),
                                    ].map((s) => (
                                      <span key={s.label} className="text-[11px] text-gray-500 bg-gray-100 dark:bg-gray-800 rounded px-1.5 py-0.5">{s.label}:{s.value}</span>
                                    ))}
                                  </div>
                                )}
                                {rsData.forecastTarget != null && rsData.forecastTarget > 0 && (
                                  <div className="space-y-1">
                                    <div className="flex items-center justify-between text-xs">
                                      <span className="text-gray-500 flex items-center gap-1"><Target className="h-3 w-3" /> Obiettivo</span>
                                      <span className="font-medium">{rsData.forecastTarget.toFixed(0)} pt</span>
                                    </div>
                                    <Progress value={Math.min((rsData.puntiAttuali / rsData.forecastTarget) * 100, 100)} className="h-1.5" />
                                    <div className="flex items-center justify-between text-xs">
                                      <span className={`font-medium ${(rsData.forecastGap ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>{(rsData.forecastGap ?? 0) >= 0 ? "+" : ""}{(rsData.forecastGap ?? 0).toFixed(1)} pt</span>
                                      <span className="text-gray-500">{Math.round((rsData.puntiAttuali / rsData.forecastTarget) * 100)}%</span>
                                    </div>
                                  </div>
                                )}
                              </>
                            );
                            rows.push({ key: rsKey, testIdSuffix: rsKey, name: rsData.displayName, metrics, detail });
                          }
                        } else if (usePdv) {
                          for (const p of pdvList) {
                            const sogliaAtt = p.pdvCalc.sogliaLabel;
                            const metrics: CompactRowMetrics = { pezziAtt: p.pezzi, pezziProi: p.proiezione, puntiAtt: p.pdvCalc.puntiTotali, sogliaAtt, premioAtt: p.pdvCalc.premioStimato };
                            const detail = (
                              <>
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="text-center">
                                    <div className="text-xs text-gray-500">Soglia Att.</div>
                                    <Badge className={`text-sm ${getSogliaColor(sogliaAtt)}`} variant="outline">{sogliaAtt}</Badge>
                                    {p.pdvCalc.puntiTotali > 0 && <div className="text-xs text-gray-500 mt-0.5">{p.pdvCalc.puntiTotali.toFixed(1)} pt</div>}
                                  </div>
                                  <div className="text-center">
                                    <div className="text-xs text-gray-500">Premio €</div>
                                    <span className="text-base font-bold text-green-700 dark:text-green-400">{formatEuro(p.pdvCalc.premioStimato)}</span>
                                  </div>
                                </div>
                                {p.pdvCalc.forecastTarget != null && p.pdvCalc.forecastTarget > 0 && (
                                  <div className="space-y-1">
                                    <div className="flex items-center justify-between text-xs">
                                      <span className="text-gray-500 flex items-center gap-1"><Target className="h-3 w-3" /> Obiettivo</span>
                                      <span className="font-medium">{p.pdvCalc.forecastTarget.toFixed(0)} pt</span>
                                    </div>
                                    <Progress value={Math.min((p.pdvCalc.puntiTotali / p.pdvCalc.forecastTarget) * 100, 100)} className="h-1.5" />
                                    <div className="flex items-center justify-between text-xs">
                                      <span className={`font-medium ${(p.pdvCalc.forecastGap ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>{(p.pdvCalc.forecastGap ?? 0) >= 0 ? "+" : ""}{(p.pdvCalc.forecastGap ?? 0).toFixed(1)} pt</span>
                                      <span className="text-gray-500">{Math.round((p.pdvCalc.puntiTotali / p.pdvCalc.forecastTarget) * 100)}%</span>
                                    </div>
                                  </div>
                                )}
                              </>
                            );
                            rows.push({ key: p.codicePos, testIdSuffix: p.codicePos, name: p.nomeNegozio, subtitle: `${p.codicePos} · ${p.ragioneSociale}`, metrics, detail });
                          }
                        } else {
                          // Single aggregated "Totale" row
                          const sogliaAtt = pista.calc.sogliaLabel;
                          const sogliaProi = pista.calcProiezione.sogliaLabel;
                          const metrics: CompactRowMetrics = isCB
                            ? { pezziAtt: pista.totalePezzi, pezziProi: pista.proiezionePezzi, premioAtt: pista.calc.premioStimato, premioProi: pista.calcProiezione.premioStimato }
                            : isPartnership
                            ? { puntiAtt: pista.calc.puntiTotali, puntiProi: pista.calcProiezione.puntiTotali, premioAtt: pista.calc.premioStimato, premioProi: pista.calcProiezione.premioStimato }
                            : { puntiAtt: pista.calc.puntiTotali, puntiProi: pista.calcProiezione.puntiTotali, sogliaAtt, sogliaProi, premioAtt: pista.calc.premioStimato, premioProi: pista.calcProiezione.premioStimato };
                          const detail = (
                            <>
                              {!isCB && !isPartnership && sogliaAtt !== 'N/A' && (
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="text-center">
                                    <div className="text-xs text-gray-500">Soglia Att.</div>
                                    <Badge className={`text-sm ${getSogliaColor(sogliaAtt)}`} variant="outline" data-testid={`badge-soglia-${pista.pista}`}>{sogliaAtt}</Badge>
                                    {pista.calc.puntiTotali > 0 && <div className="text-xs text-gray-500 mt-0.5">{pista.calc.puntiTotali.toFixed(1)} pt</div>}
                                  </div>
                                  <div className="text-center">
                                    <div className="text-xs text-gray-500">Proiezione</div>
                                    <Badge className={`text-sm ${getSogliaColor(sogliaProi)}`} variant="outline" data-testid={`badge-soglia-proiezione-${pista.pista}`}>{sogliaProi}</Badge>
                                    {pista.calcProiezione.puntiTotali > 0 && <div className="text-xs text-gray-500 mt-0.5">{pista.calcProiezione.puntiTotali.toFixed(1)} pt</div>}
                                  </div>
                                </div>
                              )}
                              {pista.soglieRef && !isCB && !isPartnership && (
                                <div className="flex flex-wrap gap-1.5 justify-center">
                                  {[
                                    { label: "S1", value: pista.soglieRef.s1 },
                                    { label: "S2", value: pista.soglieRef.s2 },
                                    { label: "S3", value: pista.soglieRef.s3 },
                                    ...(pista.soglieRef.s4 != null && pista.soglieRef.s4 > 0 ? [{ label: "S4", value: pista.soglieRef.s4 }] : []),
                                    ...(pista.soglieRef.s5 != null && pista.soglieRef.s5 > 0 ? [{ label: "S5", value: pista.soglieRef.s5 }] : []),
                                  ].map((s) => (
                                    <span key={s.label} className="text-xs text-gray-500 bg-gray-100 dark:bg-gray-800 rounded px-1.5 py-0.5 font-medium">{s.label}:{s.value}</span>
                                  ))}
                                </div>
                              )}
                              {pista.calc.forecastTarget != null && pista.calc.forecastTarget > 0 && (
                                <div className="rounded-lg border p-2 space-y-1" data-testid={`objective-gap-${pista.pista}`}>
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="text-gray-500 flex items-center gap-1"><Target className="h-3 w-3" /> Obiettivo</span>
                                    <span className="font-medium">{pista.calc.forecastTarget.toFixed(0)} pt</span>
                                  </div>
                                  <Progress value={Math.min((pista.calc.puntiTotali / pista.calc.forecastTarget) * 100, 100)} className="h-1.5" />
                                  <div className="flex items-center justify-between text-xs">
                                    <span className={`font-medium ${(pista.calc.forecastGap ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>{(pista.calc.forecastGap ?? 0) >= 0 ? "+" : ""}{(pista.calc.forecastGap ?? 0).toFixed(1)} pt</span>
                                    <span className="text-gray-400">{Math.round((pista.calc.puntiTotali / pista.calc.forecastTarget) * 100)}%</span>
                                  </div>
                                </div>
                              )}
                              {(pista.calc.premioStimato > 0 || pista.calcProiezione.premioStimato > 0) && (
                                <div className={`rounded-lg border-2 ${isCB ? 'border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-900/20' : 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/20'} px-3 py-2 space-y-1`}>
                                  <div className="flex items-center justify-between text-sm">
                                    <span className="text-gray-500">Attuale</span>
                                    <span className={`font-bold ${isCB ? 'text-orange-700 dark:text-orange-400' : 'text-green-700 dark:text-green-400'}`}>{formatEuro(pista.calc.premioStimato)}</span>
                                  </div>
                                  {pista.calcProiezione.premioStimato > 0 && (
                                    <div className="flex items-center justify-between text-sm">
                                      <span className="text-gray-500 flex items-center gap-1"><TrendingUp className="h-3 w-3 text-blue-500" /> Proiezione</span>
                                      <span className="font-bold text-blue-600">{formatEuro(pista.calcProiezione.premioStimato)}</span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </>
                          );
                          rows.push({ key: 'totale', testIdSuffix: 'totale', name: 'Totale', metrics, detail });
                        }

                        return (
                          <div className="space-y-1.5">
                            {rows.map(r => {
                              const rowKey = `${pista.pista}::${r.testIdSuffix}`;
                              return (
                                <PistaCompactRow
                                  key={r.key}
                                  testId={`${pista.pista}-${r.testIdSuffix}`}
                                  expanded={expandedRsRows.has(rowKey)}
                                  onToggle={() => toggleRsRow(rowKey)}
                                  name={r.name}
                                  subtitle={r.subtitle}
                                  metrics={r.metrics}
                                  premioColor={premioColorVal}
                                >
                                  {r.detail}
                                </PistaCompactRow>
                              );
                            })}
                            {/* Footer aggregate Totale Premio */}
                            {rows.length > 1 && (
                              <div className={`rounded-lg border-2 ${isCB ? 'border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-900/20' : 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/20'} px-3 py-2 flex items-center justify-between flex-wrap gap-2`}>
                                <span className="text-sm font-medium text-gray-600">Totale Premio</span>
                                <div className="flex items-center gap-3 flex-wrap">
                                  <span className={`font-bold ${isCB ? 'text-orange-700 dark:text-orange-400' : 'text-green-700 dark:text-green-400'}`} data-testid={`text-premio-${pista.pista}`}>{formatEuro(pista.calc.premioStimato)}</span>
                                  {pista.calcProiezione.premioStimato > 0 && (
                                    <span className="font-bold text-blue-600 flex items-center gap-0.5" data-testid={`text-premio-proiezione-${pista.pista}`}>
                                      <TrendingUp className="h-3 w-3" /> {formatEuro(pista.calcProiezione.premioStimato)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                            {rows.length === 1 && (
                              <>
                                <span className="hidden" data-testid={`text-premio-${pista.pista}`}>{formatEuro(pista.calc.premioStimato)}</span>
                                {pista.calcProiezione.premioStimato > 0 && <span className="hidden" data-testid={`text-premio-proiezione-${pista.pista}`}>{formatEuro(pista.calcProiezione.premioStimato)}</span>}
                              </>
                            )}
                          </div>
                        );
                      })()}

                      {pista.totalePezzi === 0 ? (
                        <p className="text-sm text-gray-400 italic">Nessuna attivazione mappata</p>
                      ) : (pista.pista === "mobile" || pista.pista === "fisso") ? (
                        <>
                          <Separator />
                          <div className="space-y-3">
                            {(pista.pista === "mobile" ? groupMobileCategories(pista.categories) : groupFissoCategories(pista.categories)).map((group) => {
                              const expandedGroups = pista.pista === "mobile" ? expandedMobileGroups : expandedFissoGroups;
                              const setExpandedGroups = pista.pista === "mobile" ? setExpandedMobileGroups : setExpandedFissoGroups;
                              const groupExpanded = expandedGroups.has(group.groupKey);
                              return (
                                <div key={group.groupKey}>
                                  <button
                                    className="flex items-center justify-between w-full text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded px-1 py-0.5 -mx-1"
                                    onClick={() => setExpandedGroups(prev => {
                                      const next = new Set(prev);
                                      if (next.has(group.groupKey)) next.delete(group.groupKey);
                                      else next.add(group.groupKey);
                                      return next;
                                    })}
                                    data-testid={`btn-toggle-${pista.pista}-group-${group.groupKey}`}
                                  >
                                    <span className="font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-1">
                                      <span className="text-xs text-gray-400">{groupExpanded ? "▼" : "▶"}</span>
                                      {group.groupLabel}
                                    </span>
                                    <div className="flex items-center gap-2">
                                      <span className="font-bold">{group.totalPezzi}</span>
                                      <span className="text-gray-400 text-sm">→ {group.totalProiezione}</span>
                                    </div>
                                  </button>
                                  {groupExpanded && (
                                    <div className="ml-4 mt-1 space-y-1 border-l-2 border-gray-200 dark:border-gray-700 pl-2">
                                      {group.children.map((cat) => (
                                        <div key={cat.category} className="flex items-center justify-between text-sm">
                                          <span className="text-gray-500 dark:text-gray-400 truncate max-w-[55%]">
                                            {cat.label}
                                          </span>
                                          <div className="flex items-center gap-2">
                                            <span className="font-medium">{cat.pezzi}</span>
                                            <span className="text-gray-400">→ {cat.proiezione}</span>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </>
                      ) : (
                        <>
                          <Separator />
                          <div className="space-y-1.5">
                            {(expandedPistaCategories.has(pista.pista) ? pista.categories : pista.categories.slice(0, 6)).map((cat) => (
                              <div key={cat.category} className="flex items-center justify-between text-sm">
                                <span className="text-gray-600 dark:text-gray-300 truncate max-w-[60%]">{cat.label}</span>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{cat.pezzi}</span>
                                  <span className="text-gray-400">→ {cat.proiezione}</span>
                                </div>
                              </div>
                            ))}
                            {pista.categories.length > 6 && (
                              <button
                                className="text-sm text-primary hover:underline cursor-pointer mt-1"
                                onClick={() => setExpandedPistaCategories(prev => {
                                  const next = new Set(prev);
                                  if (next.has(pista.pista)) next.delete(pista.pista);
                                  else next.add(pista.pista);
                                  return next;
                                })}
                                data-testid={`btn-toggle-categories-${pista.pista}`}
                              >
                                {expandedPistaCategories.has(pista.pista)
                                  ? 'Mostra meno'
                                  : `+${pista.categories.length - 6} altre categorie`}
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {(() => {
              const kinds: { key: 'smartphone' | 'smartDevice' | 'internetDevice'; label: string }[] = [
                { key: 'smartphone', label: 'Smartphone' },
                { key: 'smartDevice', label: 'Smart Device' },
                { key: 'internetDevice', label: 'Internet Device' },
              ];
              type PdvBreakdownEntry = { codicePos: string; nome: string; ragioneSociale: string; totale: number; finanziato: number; rate: number; altro: number };
              type ModelloAgg = { totale: number; finanziato: number; rate: number; altro: number; perPdv: Map<string, PdvBreakdownEntry> };
              const aggByKind: Record<'smartphone' | 'smartDevice' | 'internetDevice', Map<string, ModelloAgg>> = {
                smartphone: new Map(),
                smartDevice: new Map(),
                internetDevice: new Map(),
              };
              for (const pdv of mappedData.pdvList) {
                const dev = pdv.devices;
                if (!dev) continue;
                const pdvConfig = puntiVenditaFromGara.find(p => p.codicePos === pdv.codicePos);
                const pdvRS = pdvConfig?.ragioneSociale || pdv.ragioneSociale || 'N/D';
                const pdvNome = pdv.nomeNegozio || pdv.codicePos;
                for (const kk of kinds) {
                  const k = dev[kk.key];
                  if (!k) continue;
                  const map = aggByKind[kk.key];
                  for (const modal of ['finanziato', 'rate', 'altro'] as const) {
                    for (const [desc, n] of Object.entries(k[modal].descriptions || {})) {
                      const cur = map.get(desc) || { totale: 0, finanziato: 0, rate: 0, altro: 0, perPdv: new Map<string, PdvBreakdownEntry>() };
                      cur.totale += n;
                      cur[modal] += n;
                      const pdvEntry = cur.perPdv.get(pdv.codicePos) || { codicePos: pdv.codicePos, nome: pdvNome, ragioneSociale: pdvRS, totale: 0, finanziato: 0, rate: 0, altro: 0 };
                      pdvEntry.totale += n;
                      pdvEntry[modal] += n;
                      cur.perPdv.set(pdv.codicePos, pdvEntry);
                      map.set(desc, cur);
                    }
                  }
                }
              }
              const totGlobal = kinds.reduce((s, kk) => {
                let t = 0;
                aggByKind[kk.key].forEach((v) => { t += v.totale; });
                return s + t;
              }, 0);
              if (totGlobal <= 0) return null;
              return (
                <Card data-testid="card-device-per-modello">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Smartphone className="h-5 w-5" />
                      Device per modello
                      <span className="text-sm text-gray-500 font-normal">({totGlobal} pezzi totali)</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {kinds.map((kk) => {
                        const map = aggByKind[kk.key];
                        const rows = Array.from(map.entries())
                          .map(([desc, agg]) => ({ desc, ...agg }))
                          .sort((a, b) => b.totale - a.totale);
                        const totKind = rows.reduce((s, r) => s + r.totale, 0);
                        return (
                          <div key={kk.key} className="rounded-lg border bg-violet-50/40 dark:bg-violet-900/10 border-violet-200 dark:border-violet-800 p-3" data-testid={`device-modello-kind-${kk.key}`}>
                            <div className="flex items-center justify-between mb-2 text-sm">
                              <span className="font-semibold text-violet-800 dark:text-violet-200">{kk.label}</span>
                              <span className="font-bold text-violet-800 dark:text-violet-200">{totKind}</span>
                            </div>
                            {rows.length === 0 ? (
                              <div className="text-xs text-gray-500 italic">Nessun pezzo</div>
                            ) : (
                              <div className="max-h-72 overflow-y-auto pr-1 space-y-1">
                                {rows.map((r) => {
                                  const tags: string[] = [];
                                  if (r.finanziato > 0) tags.push(`F:${r.finanziato}`);
                                  if (r.rate > 0) tags.push(`R:${r.rate}`);
                                  if (r.altro > 0) tags.push(`A:${r.altro}`);
                                  const drillKey = `${kk.key}|${r.desc}`;
                                  const open = expandedAggModelloDrills.has(drillKey);
                                  const mode = aggModelloDrillMode[drillKey] || 'pdv';
                                  const pdvEntries = Array.from(r.perPdv.values()).sort((a, b) => b.totale - a.totale);
                                  const rsMap = new Map<string, PdvBreakdownEntry>();
                                  for (const pe of pdvEntries) {
                                    const rsKey = normalizeRS(pe.ragioneSociale);
                                    const cur = rsMap.get(rsKey) || { codicePos: '', nome: pe.ragioneSociale, ragioneSociale: pe.ragioneSociale, totale: 0, finanziato: 0, rate: 0, altro: 0 };
                                    cur.totale += pe.totale;
                                    cur.finanziato += pe.finanziato;
                                    cur.rate += pe.rate;
                                    cur.altro += pe.altro;
                                    rsMap.set(rsKey, cur);
                                  }
                                  const rsEntries = Array.from(rsMap.values()).sort((a, b) => b.totale - a.totale);
                                  const drillEntries = mode === 'rs' ? rsEntries : pdvEntries;
                                  return (
                                    <div key={r.desc} data-testid={`device-modello-row-${kk.key}-${r.desc}`}>
                                      <button
                                        type="button"
                                        onClick={() => toggleAggModelloDrill(drillKey)}
                                        className="w-full flex items-center justify-between gap-2 text-xs text-gray-700 dark:text-gray-200 hover-elevate active-elevate-2 rounded px-1 py-0.5 cursor-pointer text-left"
                                        data-testid={`button-drill-agg-modello-${kk.key}-${r.desc}`}
                                      >
                                        <span className="truncate flex items-center gap-1" title={r.desc}>
                                          <span className="text-[10px] text-gray-400 w-2 inline-block">{open ? '▾' : '▸'}</span>
                                          <span className="truncate">{r.desc}</span>
                                        </span>
                                        <span className="shrink-0 font-medium">
                                          {r.totale}
                                          {tags.length > 0 && <span className="ml-1 text-gray-400">({tags.join(' · ')})</span>}
                                        </span>
                                      </button>
                                      {open && (
                                        <div className="mt-1 mb-1 pl-3 border-l-2 border-violet-300 dark:border-violet-700 space-y-1">
                                          <div className="flex items-center gap-1 text-[10px]">
                                            <button
                                              type="button"
                                              className={`px-1.5 py-0.5 rounded border ${mode === 'pdv' ? 'bg-violet-200 dark:bg-violet-800 border-violet-400' : 'bg-transparent border-violet-200 dark:border-violet-800'}`}
                                              onClick={() => setAggModelloDrillMode(prev => ({ ...prev, [drillKey]: 'pdv' }))}
                                              data-testid={`button-drill-mode-pdv-${kk.key}-${r.desc}`}
                                            >
                                              Per PDV ({pdvEntries.length})
                                            </button>
                                            <button
                                              type="button"
                                              className={`px-1.5 py-0.5 rounded border ${mode === 'rs' ? 'bg-violet-200 dark:bg-violet-800 border-violet-400' : 'bg-transparent border-violet-200 dark:border-violet-800'}`}
                                              onClick={() => setAggModelloDrillMode(prev => ({ ...prev, [drillKey]: 'rs' }))}
                                              data-testid={`button-drill-mode-rs-${kk.key}-${r.desc}`}
                                            >
                                              Per RS ({rsEntries.length})
                                            </button>
                                          </div>
                                          {drillEntries.map((e) => {
                                            const subTags: string[] = [];
                                            if (e.finanziato > 0) subTags.push(`F:${e.finanziato}`);
                                            if (e.rate > 0) subTags.push(`R:${e.rate}`);
                                            if (e.altro > 0) subTags.push(`A:${e.altro}`);
                                            const rowKey = mode === 'rs' ? e.ragioneSociale : e.codicePos;
                                            const label = mode === 'rs' ? e.ragioneSociale : `${e.nome}`;
                                            const subtitle = mode === 'rs' ? null : e.ragioneSociale;
                                            return (
                                              <div key={rowKey} className="flex items-center justify-between gap-2 text-[11px] text-gray-600 dark:text-gray-300" data-testid={`drill-agg-modello-${mode}-${kk.key}-${r.desc}-${rowKey}`}>
                                                <span className="truncate" title={subtitle ? `${label} · ${subtitle}` : label}>
                                                  {label}
                                                  {subtitle && <span className="text-gray-400"> · {subtitle}</span>}
                                                </span>
                                                <span className="shrink-0 font-medium">
                                                  {e.totale}
                                                  {subTags.length > 0 && <span className="ml-1 text-gray-400">({subTags.join(' · ')})</span>}
                                                </span>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-2 italic">F = Finanziato · R = Rate · A = Altro</div>
                  </CardContent>
                </Card>
              );
            })()}

            {(() => {
              const PDV_CHART_COLORS = [
                "#f97316", "#3b82f6", "#22c55e", "#a855f7", "#ec4899",
                "#14b8a6", "#eab308", "#6366f1", "#f43f5e", "#0ea5e9",
                "#84cc16", "#d946ef", "#f59e0b", "#06b6d4", "#8b5cf6",
              ];

              const pdvListWithRS = mappedData.pdvList.map(pdv => {
                const pdvConfig = puntiVenditaFromGara.find(p => p.codicePos === pdv.codicePos);
                const rs = pdvConfig?.ragioneSociale || pdv.ragioneSociale || "N/D";
                return { ...pdv, configuredRS: rs };
              });

              const isRSMode = garaCalcConfig.tipologiaGara === 'gara_operatore_rs' && garaCalcConfig.modalitaInserimentoRS === 'per_rs';

              const pdvSummaries = pdvListWithRS.map(pdv => {
                const corePezzi = pdv.items.filter(i => isCorePezziItem(i.pista, i.targetCategory)).reduce((s, i) => s + i.pezzi, 0);
                const pdvRS = normalizeRS(pdv.configuredRS);

                let pdvPremioTotale = 0;
                for (const stat of pistaStats) {
                  const match = stat.pdvBreakdown.find(b => b.codicePos === pdv.codicePos);
                  if (!match) continue;

                  if (isRSMode && stat.rsCalcBreakdown) {
                    const rsData = stat.rsCalcBreakdown.get(pdvRS);
                    if (rsData && rsData.premioAttuale > 0) {
                      const rsPdvs = stat.pdvBreakdown.filter(b => normalizeRS(b.ragioneSociale) === pdvRS);
                      const rsTotalPezzi = rsPdvs.reduce((s, b) => s + b.pezzi, 0);
                      pdvPremioTotale += rsTotalPezzi > 0
                        ? Math.round((match.pezzi / rsTotalPezzi) * rsData.premioAttuale * 100) / 100
                        : 0;
                    }
                  } else {
                    if (match.pdvCalc.premioStimato > 0) {
                      pdvPremioTotale += match.pdvCalc.premioStimato;
                    } else {
                      const aggPremio = stat.calc.premioStimato;
                      const totalPezziPista = stat.pdvBreakdown.reduce((s, b) => s + b.pezzi, 0);
                      pdvPremioTotale += totalPezziPista > 0
                        ? Math.round((match.pezzi / totalPezziPista) * aggPremio * 100) / 100
                        : 0;
                    }
                  }
                }

                return {
                  codicePos: pdv.codicePos,
                  nomeNegozio: pdv.nomeNegozio,
                  configuredRS: pdv.configuredRS,
                  corePezzi,
                  premioTotale: pdvPremioTotale,
                };
              }).filter(p => p.corePezzi > 0);

              const grandTotalPezzi = pdvSummaries.reduce((s, p) => s + p.corePezzi, 0);
              const grandTotalPremio = pdvSummaries.reduce((s, p) => s + p.premioTotale, 0);

              const pieData = pdvSummaries
                .sort((a, b) => b.premioTotale - a.premioTotale)
                .map((p, i) => ({
                  name: p.nomeNegozio,
                  value: Math.round(p.premioTotale * 100) / 100,
                  pezzi: p.corePezzi,
                  pct: grandTotalPremio > 0 ? Math.round((p.premioTotale / grandTotalPremio) * 1000) / 10 : 0,
                  color: PDV_CHART_COLORS[i % PDV_CHART_COLORS.length],
                }));

              const puntiByPdvByPista = new Map<string, Record<string, number>>();
              for (const pdv of pdvListWithRS) {
                const m: Record<string, number> = {};
                for (const stat of pistaStats) {
                  const match = stat.pdvBreakdown.find(b => b.codicePos === pdv.codicePos);
                  if (match) m[stat.pista] = match.pdvCalc.puntiTotali;
                }
                puntiByPdvByPista.set(pdv.codicePos, m);
              }
              const premioByPdv = new Map<string, number>();
              for (const s of pdvSummaries) premioByPdv.set(s.codicePos, s.premioTotale);

              const sortValue = (pdv: typeof pdvListWithRS[number]): number | string => {
                const punti = puntiByPdvByPista.get(pdv.codicePos) || {};
                switch (pdvSortKey) {
                  case 'premio': return premioByPdv.get(pdv.codicePos) || 0;
                  case 'smartphone': return pdvSmartphoneMobileCount(pdv) + pdvSmartphoneCBCount(pdv);
                  case 'accessori_pezzi': return pdv.accessori?.pezzi || 0;
                  case 'accessori_fatturato': return pdv.accessori?.importo || 0;
                  case 'servizi_fatturato': return pdv.servizi?.importo || 0;
                  case 'nome_az': return (pdv.nomeNegozio || '').toLowerCase();
                  case 'punti_mobile': return punti.mobile || 0;
                  case 'punti_fisso': return punti.fisso || 0;
                  case 'punti_cb': return punti.cb || 0;
                  case 'punti_energia': return punti.energia || 0;
                  case 'punti_assicurazioni': return punti.assicurazioni || 0;
                  case 'punti_protecta': return punti.protecta || 0;
                  case 'pezzi_default':
                  default:
                    return pdv.items.filter(i => isCorePezziItem(i.pista, i.targetCategory)).reduce((s, i) => s + i.pezzi, 0);
                }
              };
              const cmp = (a: typeof pdvListWithRS[number], b: typeof pdvListWithRS[number]) => {
                const va = sortValue(a); const vb = sortValue(b);
                if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb);
                return (Number(vb) || 0) - (Number(va) || 0);
              };

              const rsGroups = new Map<string, typeof pdvListWithRS>();
              for (const pdv of pdvListWithRS) {
                const key = pdv.configuredRS;
                if (!rsGroups.has(key)) rsGroups.set(key, []);
                rsGroups.get(key)!.push(pdv);
              }
              const groupByRS = pdvSortKey === 'pezzi_default';
              const sortedRSGroups = Array.from(rsGroups.entries())
                .map(([rs, pdvs]) => ({ rs, pdvs, totalPezzi: pdvs.reduce((s, p) => s + p.items.filter(i => isCorePezziItem(i.pista, i.targetCategory)).reduce((s2, i) => s2 + i.pezzi, 0), 0) }))
                .sort((a, b) => b.totalPezzi - a.totalPezzi);
              const sortedPdvList = groupByRS
                ? sortedRSGroups.flatMap(g => g.pdvs.slice().sort(cmp))
                : pdvListWithRS.slice().sort(cmp);
              const showRSHeaders = groupByRS && rsGroups.size > 1;

              const pdvColorMap = new Map<string, string>();
              pieData.forEach((p) => { pdvColorMap.set(p.name, p.color); });

              return (
                <Card data-testid="card-pdv-breakdown">
                  <CardHeader>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Store className="h-5 w-5" />
                        Dettaglio per PDV
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 shrink-0">Ordina per</span>
                        <Select value={pdvSortKey} onValueChange={(v) => setPdvSortKey(v as PdvSortKey)}>
                          <SelectTrigger className="h-8 w-[200px] text-xs" data-testid="select-pdv-sort">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PDV_SORT_OPTIONS.map((o) => (
                              <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {pieData.length > 1 && (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-center">
                        <div className="flex justify-center" data-testid="pdv-pie-chart">
                          <ResponsiveContainer width="100%" height={280}>
                            <PieChart>
                              <Pie
                                data={pieData}
                                dataKey="value"
                                nameKey="name"
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={110}
                                paddingAngle={2}
                                stroke="none"
                              >
                                {pieData.map((entry, index) => (
                                  <Cell key={entry.name} fill={entry.color} />
                                ))}
                              </Pie>
                              <RechartsTooltip
                                formatter={(value: number, name: string) => {
                                  const entry = pieData.find(p => p.name === name);
                                  return [`${formatEuro(value)} (${entry?.pct ?? 0}%) · ${entry?.pezzi ?? 0} pezzi`, name];
                                }}
                                contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "13px" }}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="space-y-1.5" data-testid="pdv-pie-legend">
                          {pieData.map((p) => (
                            <div key={p.name} className="flex items-center gap-2 text-sm">
                              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                              <span className="truncate flex-1 text-gray-700 dark:text-gray-300">{p.name}</span>
                              <span className="font-bold text-green-700 shrink-0">{formatEuro(p.value)}</span>
                              <span className="text-gray-500 shrink-0 w-14 text-right font-semibold">{p.pct}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <Accordion type="multiple" className="space-y-2">
                      {(() => {
                        let lastRS = "";
                        return sortedPdvList.map((pdv) => {
                          const rsHeader = showRSHeaders && pdv.configuredRS !== lastRS;
                          if (showRSHeaders) lastRS = pdv.configuredRS;
                        return (
                        <Fragment key={pdv.codicePos}>
                        {rsHeader && (
                          <div className="flex items-center gap-2 pt-3 pb-1 first:pt-0">
                            <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{pdv.configuredRS}</span>
                            <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                          </div>
                        )}
                        {(() => {
                          const totalPezzi = pdv.items.filter(i => isCorePezziItem(i.pista, i.targetCategory)).reduce((s, i) => s + i.pezzi, 0);
                          const proiezione = workdayInfo.elapsedWorkingDays > 0
                            ? Math.round((totalPezzi / workdayInfo.elapsedWorkingDays) * workdayInfo.totalWorkingDays)
                            : totalPezzi;
                          const pdvSummary = pdvSummaries.find(s => s.codicePos === pdv.codicePos);
                          const pdvPremioCalc = pdvSummary?.premioTotale ?? 0;
                          const pctContrib = grandTotalPremio > 0 ? Math.round((pdvPremioCalc / grandTotalPremio) * 1000) / 10 : 0;
                          const pdvChartColor = pdvColorMap.get(pdv.nomeNegozio) || "#9ca3af";

                          const byPista: Record<string, { pezzi: number; corePezzi: number; items: AggregatedItem[] }> = {};
                          for (const item of pdv.items) {
                            if (!byPista[item.pista]) byPista[item.pista] = { pezzi: 0, corePezzi: 0, items: [] };
                            byPista[item.pista].pezzi += item.pezzi;
                            if (isCorePezziItem(item.pista, item.targetCategory)) {
                              byPista[item.pista].corePezzi += item.pezzi;
                            }
                            byPista[item.pista].items.push(item);
                          }

                          const egStat = pistaStats.find(s => s.pista === "extra_gara_iva");
                          if (egStat) {
                            const egPdvMatch = egStat.pdvBreakdown.find(b => b.codicePos === pdv.codicePos);
                            if (egPdvMatch && egPdvMatch.pezzi > 0) {
                              byPista["extra_gara_iva"] = {
                                pezzi: egPdvMatch.pezzi,
                                corePezzi: egPdvMatch.pezzi,
                                items: egPdvMatch.categories.map(c => ({
                                  pista: "extra_gara_iva",
                                  targetCategory: c.category,
                                  targetLabel: c.label,
                                  pezzi: c.pezzi,
                                  canone: c.canone,
                                })),
                              };
                            }
                          }

                          const pdvCalcByPista: Record<string, PistaCalcResult> = {};
                          const pdvPremioByPista: Record<string, number> = {};
                          const pdvNormRS = normalizeRS(pdv.configuredRS);
                          for (const stat of pistaStats) {
                            const match = stat.pdvBreakdown.find((b) => b.codicePos === pdv.codicePos);
                            if (match) {
                              pdvCalcByPista[stat.pista] = match.pdvCalc;
                              if (isRSMode && stat.rsCalcBreakdown) {
                                const rsData = stat.rsCalcBreakdown.get(pdvNormRS);
                                if (rsData && rsData.premioAttuale > 0) {
                                  const rsPdvs = stat.pdvBreakdown.filter(b => normalizeRS(b.ragioneSociale) === pdvNormRS);
                                  const rsTotalPezzi = rsPdvs.reduce((s, b) => s + b.pezzi, 0);
                                  pdvPremioByPista[stat.pista] = rsTotalPezzi > 0
                                    ? Math.round((match.pezzi / rsTotalPezzi) * rsData.premioAttuale * 100) / 100
                                    : 0;
                                } else {
                                  pdvPremioByPista[stat.pista] = 0;
                                }
                              } else if (match.pdvCalc.premioStimato > 0) {
                                pdvPremioByPista[stat.pista] = match.pdvCalc.premioStimato;
                              } else {
                                const aggPremio = stat.calc.premioStimato;
                                const totalPezziPista = stat.pdvBreakdown.reduce((s, b) => s + b.pezzi, 0);
                                pdvPremioByPista[stat.pista] = totalPezziPista > 0
                                  ? Math.round((match.pezzi / totalPezziPista) * aggPremio * 100) / 100
                                  : 0;
                              }
                            }
                          }

                          const totalPremio = Object.values(pdvPremioByPista).reduce((s, v) => s + v, 0);

                          return (
                            <AccordionItem key={pdv.codicePos} value={pdv.codicePos} className="border rounded-lg px-2 sm:px-4" data-testid={`pdv-accordion-${pdv.codicePos}`}>
                              <AccordionTrigger className="hover:no-underline py-3">
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between w-full pr-4 gap-1 sm:gap-2">
                                  <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: pdvChartColor }} />
                                    <div className="text-left min-w-0">
                                      <div className="font-medium text-sm truncate">{pdv.nomeNegozio}</div>
                                      <div className="text-xs text-gray-500 truncate">{pdv.codicePos} · {pdv.ragioneSociale}</div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 sm:gap-4 text-sm flex-wrap pl-6 sm:pl-0">
                                    <Badge variant="outline" className="text-sm font-bold shrink-0" style={{ color: pdvChartColor, borderColor: pdvChartColor }}>
                                      {pctContrib}%
                                    </Badge>
                                    {totalPremio > 0 && (
                                      <Badge variant="outline" className="text-green-700 border-green-300 text-sm shrink-0" data-testid={`badge-pdv-premio-${pdv.codicePos}`}>
                                        {formatEuro(totalPremio)}
                                      </Badge>
                                    )}
                                    <div className="text-right shrink-0">
                                      <div className="font-bold">{totalPezzi} pezzi</div>
                                      <div className="text-sm text-gray-400">Proiezione: {proiezione}</div>
                                    </div>
                                  </div>
                                </div>
                              </AccordionTrigger>
                              <AccordionContent>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pb-3">
                                  {Object.entries(byPista).sort(([a], [b]) => pistaOrderRank(a) - pistaOrderRank(b)).map(([pistaKey, pistaData]) => {
                                    const conf = PISTA_CONFIG[pistaKey as keyof typeof PISTA_CONFIG];
                                    if (!conf) return null;
                                    const calc = pdvCalcByPista[pistaKey];
                                    const pistaAggPremio = pistaStats.find(s => s.pista === pistaKey)?.calc.premioStimato || 0;
                                    const pistaPdvPremio = pdvPremioByPista[pistaKey] ?? 0;
                                    const pistaPct = pistaAggPremio > 0 ? Math.round((pistaPdvPremio / pistaAggPremio) * 1000) / 10 : 0;
                                    return (
                                      <div key={pistaKey} className={`rounded-lg border p-3 ${conf.lightColor}`}>
                                        <div className="font-medium text-sm mb-2 flex items-center justify-between gap-2">
                                          <div className="flex items-center gap-2 min-w-0">
                                            <span className="truncate">{conf.label}</span>
                                            {pistaPdvPremio > 0 && (
                                              <span className="text-xs font-semibold text-green-700 dark:text-green-400 shrink-0" data-testid={`pdv-pista-premio-inline-${pdv.codicePos}-${pistaKey}`}>
                                                {formatEuro(pistaPdvPremio)}
                                              </span>
                                            )}
                                          </div>
                                          <div className="flex items-center gap-2 shrink-0">
                                            <span className="text-xs text-gray-500">{pistaPct}%</span>
                                            <span className="font-bold">{pistaData.corePezzi}</span>
                                          </div>
                                        </div>
                                        {pistaKey === 'fisso' && (() => {
                                          const elapsed = workdayInfo.elapsedWorkingDays;
                                          const total = workdayInfo.totalWorkingDays;
                                          const proj = (n: number) => elapsed > 0 ? Math.round((n / elapsed) * total) : n;
                                          const FISSO_BREAKDOWN: { label: string; cats: string[] }[] = [
                                            { label: 'Netflix', cats: ['NETFLIX_CON_ADV', 'NETFLIX_SENZA_ADV'] },
                                            { label: 'Linea Attiva', cats: ['LINEA_ATTIVA'] },
                                            { label: 'Convergenti', cats: ['CONVERGENZA'] },
                                            { label: 'Più Sicuri Casa/Ufficio', cats: ['PIU_SICURI_CASA_UFFICIO'] },
                                          ];
                                          const rows = FISSO_BREAKDOWN.map((b) => ({
                                            label: b.label,
                                            n: countByCats(pdv, 'fisso', new Set(b.cats)),
                                          }));
                                          if (rows.every((r) => r.n === 0)) return null;
                                          return (
                                            <div className="text-[11px] text-gray-700 dark:text-gray-200 mb-1.5 space-y-0.5" data-testid={`pdv-fisso-breakdown-${pdv.codicePos}`}>
                                              {rows.map((r) => (
                                                <div key={r.label} className="flex items-center gap-1 flex-wrap">
                                                  <span className="font-medium text-gray-600 dark:text-gray-300">{r.label}:</span>
                                                  <span>{r.n} pz</span>
                                                  {r.n > 0 && (
                                                    <>
                                                      <span className="text-gray-400">·</span>
                                                      <span className="text-gray-500">proiezione {proj(r.n)}</span>
                                                    </>
                                                  )}
                                                </div>
                                              ))}
                                            </div>
                                          );
                                        })()}
                                        {(pistaKey === 'mobile' || pistaKey === 'cb') && (() => {
                                          const split = pdvSmartphoneSplit(pdv, pistaKey as 'mobile' | 'cb');
                                          if (split.total <= 0) return null;
                                          const elapsed = workdayInfo.elapsedWorkingDays;
                                          const total = workdayInfo.totalWorkingDays;
                                          const proj = (n: number) => elapsed > 0 ? Math.round((n / elapsed) * total) : n;
                                          return (
                                            <div className="text-[11px] text-gray-700 dark:text-gray-200 mb-1.5 space-y-0.5" data-testid={`pdv-smartphone-${pdv.codicePos}-${pistaKey}`}>
                                              <div className="flex items-center gap-1 flex-wrap">
                                                <Smartphone className="h-3 w-3" />
                                                <span className="font-medium">Smartphone:</span>
                                                <span>{split.total} pz</span>
                                                <span className="text-gray-400">·</span>
                                                <span className="text-gray-500">proiezione {proj(split.total)}</span>
                                              </div>
                                              <div className="pl-4 text-gray-600 dark:text-gray-300 flex items-center gap-2 flex-wrap">
                                                <span>Finanziato: <span className="font-medium">{split.fin}</span></span>
                                                <span className="text-gray-400">·</span>
                                                <span>Rate: <span className="font-medium">{split.rate}</span></span>
                                              </div>
                                            </div>
                                          );
                                        })()}
                                        {(() => {
                                          const elapsed = workdayInfo.elapsedWorkingDays;
                                          const total = workdayInfo.totalWorkingDays;
                                          const projPezzi = elapsed > 0
                                            ? Math.round((pistaData.corePezzi / elapsed) * total)
                                            : pistaData.corePezzi;
                                          const projPunti = elapsed > 0 && calc
                                            ? (calc.puntiTotali * total) / elapsed
                                            : (calc?.puntiTotali ?? 0);
                                          return (
                                            <div className="text-[11px] text-gray-500 mb-1.5 space-y-0.5" data-testid={`pdv-pista-proiezione-${pdv.codicePos}-${pistaKey}`}>
                                              <div className="flex items-center gap-1 flex-wrap">
                                                <span className="font-medium text-gray-600 dark:text-gray-400">Attuali:</span>
                                                <span>{pistaData.corePezzi} pz</span>
                                                {(calc?.puntiTotali ?? 0) > 0 && (
                                                  <>
                                                    <span>·</span>
                                                    <span>{(calc?.puntiTotali ?? 0).toFixed(1)} pt</span>
                                                  </>
                                                )}
                                              </div>
                                              <div className="flex items-center gap-1 flex-wrap">
                                                <span className="font-medium text-gray-600 dark:text-gray-400">Proiezione:</span>
                                                <span>{projPezzi} pz</span>
                                                {(calc?.puntiTotali ?? 0) > 0 && (
                                                  <>
                                                    <span>·</span>
                                                    <span>{projPunti.toFixed(1)} pt</span>
                                                  </>
                                                )}
                                              </div>
                                            </div>
                                          );
                                        })()}
                                        {!isRSMode && calc && calc.sogliaLabel !== "N/A" && (
                                          <div className="space-y-1.5 mb-2">
                                            <div className="flex items-center gap-2 flex-wrap">
                                              <Badge className={`text-xs ${getSogliaColor(calc.sogliaLabel)}`} variant="outline">
                                                {calc.sogliaLabel}
                                              </Badge>
                                              {calc.puntiTotali > 0 && (
                                                <span className="text-xs text-gray-500" data-testid={`pdv-pista-punti-${pdv.codicePos}-${pistaKey}`}>{calc.puntiTotali.toFixed(1)} pt</span>
                                              )}
                                            </div>
                                            {(() => {
                                              const stat = pistaStats.find(s => s.pista === pistaKey);
                                              if (!stat) return null;
                                              let ref: { s1: number; s2: number; s3: number; s4?: number; s5?: number } | undefined;
                                              if (pistaKey === "mobile") {
                                                const mPdv = garaCalcConfig.pistaMobileConfig?.sogliePerPos?.find(s => s.posCode === pdv.codicePos);
                                                if (mPdv) ref = { s1: mPdv.soglia1, s2: mPdv.soglia2, s3: mPdv.soglia3, s4: mPdv.soglia4 };
                                              } else if (pistaKey === "fisso") {
                                                const fPdv = garaCalcConfig.pistaFissoConfig?.sogliePerPos?.find(s => s.posCode === pdv.codicePos);
                                                if (fPdv) ref = { s1: fPdv.soglia1, s2: fPdv.soglia2, s3: fPdv.soglia3, s4: fPdv.soglia4, s5: fPdv.soglia5 };
                                              } else if (pistaKey === "extra_gara_iva") {
                                                const egMatch = stat.pdvBreakdown.find(b => b.codicePos === pdv.codicePos);
                                                if (egMatch?.pdvCalc) {
                                                  ref = stat.soglieRef;
                                                }
                                              }
                                              if (!ref) ref = stat.soglieRef;
                                              if (!ref) return null;
                                              const items = [
                                                { label: "S1", value: ref.s1 },
                                                { label: "S2", value: ref.s2 },
                                                { label: "S3", value: ref.s3 },
                                                ...(ref.s4 != null && ref.s4 > 0 ? [{ label: "S4", value: ref.s4 }] : []),
                                                ...(ref.s5 != null && ref.s5 > 0 ? [{ label: "S5", value: ref.s5 }] : []),
                                              ];
                                              return (
                                                <div className="flex flex-wrap gap-0.5">
                                                  {items.map((s) => (
                                                    <span key={s.label} className="text-[11px] text-gray-500 bg-gray-100 dark:bg-gray-800 rounded px-1 py-0.5">
                                                      {s.label}:{s.value}
                                                    </span>
                                                  ))}
                                                </div>
                                              );
                                            })()}
                                          </div>
                                        )}
                                        {isRSMode && (pdvPremioByPista[pistaKey] ?? 0) > 0 && (
                                          <div className="mb-2">
                                            <span className="text-xs font-medium text-green-700">{formatEuro(pdvPremioByPista[pistaKey])}</span>
                                          </div>
                                        )}
                                        <div className="space-y-1">
                                          {(() => {
                                            const sortedItems = [...pistaData.items].sort((a, b) => b.pezzi - a.pezzi);
                                            let groupsConfig: { label: string; isMember: (cat: string) => boolean }[] | null = null;
                                            if (pistaKey === "mobile") {
                                              groupsConfig = [
                                                { label: "SIM Consumer", isMember: (cat) => !SIM_PIVA_CORE.has(cat) },
                                                { label: "SIM IVA", isMember: (cat) => SIM_PIVA_CORE.has(cat) },
                                              ];
                                            } else if (pistaKey === "fisso") {
                                              groupsConfig = [
                                                { label: "Consumer", isMember: (cat) => !FISSO_BUSINESS_CATEGORIES.has(cat) },
                                                { label: "Business", isMember: (cat) => FISSO_BUSINESS_CATEGORIES.has(cat) },
                                              ];
                                            }
                                            if (!groupsConfig) {
                                              return sortedItems.map((item) => (
                                                <div key={item.targetCategory} className="flex justify-between text-sm">
                                                  <span className="truncate max-w-[70%]">{item.targetLabel}</span>
                                                  <span className="font-medium">{item.pezzi}</span>
                                                </div>
                                              ));
                                            }
                                            return groupsConfig.map((g) => {
                                              const children = sortedItems.filter((it) => g.isMember(it.targetCategory));
                                              if (children.length === 0) return null;
                                              const total = children.reduce((s, c) => s + c.pezzi, 0);
                                              return (
                                                <div key={g.label} className="space-y-0.5">
                                                  <div className="flex justify-between text-sm font-semibold" data-testid={`group-header-${pistaKey}-${g.label}`}>
                                                    <span className="truncate max-w-[70%]">{g.label}</span>
                                                    <span>{total}</span>
                                                  </div>
                                                  {children.length > 0 && (
                                                    <div className="pl-3 space-y-0.5">
                                                      <div className="text-[11px] text-gray-500 italic">di cui:</div>
                                                      {children.flatMap((item) => {
                                                        if (item.targetCategory === "SIM_IVA" && item.descriptions && Object.keys(item.descriptions).length > 0) {
                                                          return Object.entries(item.descriptions)
                                                            .sort(([, a], [, b]) => b - a)
                                                            .map(([desc, count]) => (
                                                              <div key={`SIM_IVA-${desc}`} className="flex justify-between text-xs text-gray-700 dark:text-gray-300">
                                                                <span className="truncate max-w-[70%]" title={desc}>{desc}</span>
                                                                <span className="font-medium">{count}</span>
                                                              </div>
                                                            ));
                                                        }
                                                        const displayLabel = item.targetCategory === "SIM_IVA" ? "Altre SIM IVA" : item.targetLabel;
                                                        return [(
                                                          <div key={item.targetCategory} className="flex justify-between text-xs text-gray-700 dark:text-gray-300">
                                                            <span className="truncate max-w-[70%]">{displayLabel}</span>
                                                            <span className="font-medium">{item.pezzi}</span>
                                                          </div>
                                                        )];
                                                      })}
                                                    </div>
                                                  )}
                                                </div>
                                              );
                                            });
                                          })()}
                                        </div>
                                      </div>
                                    );
                                  })}
                                  {(() => {
                                    const elapsed = workdayInfo.elapsedWorkingDays;
                                    const total = workdayInfo.totalWorkingDays;
                                    const acc = pdv.accessori || { pezzi: 0, importo: 0 };
                                    const srv = pdv.servizi || { pezzi: 0, importo: 0 };
                                    const projAccPz = elapsed > 0 ? Math.round((acc.pezzi / elapsed) * total) : acc.pezzi;
                                    const projAccImp = elapsed > 0 ? (acc.importo / elapsed) * total : acc.importo;
                                    const projSrvPz = elapsed > 0 ? Math.round((srv.pezzi / elapsed) * total) : srv.pezzi;
                                    const projSrvImp = elapsed > 0 ? (srv.importo / elapsed) * total : srv.importo;
                                    return (
                                      <>
                                        <div className="rounded-lg border p-3 bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900/30 dark:text-slate-200" data-testid={`pdv-accessori-${pdv.codicePos}`}>
                                          <div className="font-medium text-sm mb-2 flex items-center justify-between">
                                            <span>Accessori</span>
                                            <span className="font-bold">{acc.pezzi}</span>
                                          </div>
                                          <div className="text-[11px] text-gray-600 dark:text-gray-300 space-y-0.5">
                                            <div className="flex items-center gap-1 flex-wrap">
                                              <span className="font-medium">Attuali:</span>
                                              <span>{acc.pezzi} pz</span>
                                              <span>·</span>
                                              <span>{formatEuro(acc.importo)}</span>
                                            </div>
                                            <div className="flex items-center gap-1 flex-wrap">
                                              <span className="font-medium">Proiezione:</span>
                                              <span>{projAccPz} pz</span>
                                              <span>·</span>
                                              <span>{formatEuro(projAccImp)}</span>
                                            </div>
                                          </div>
                                        </div>
                                        <div className="rounded-lg border p-3 bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-200" data-testid={`pdv-servizi-${pdv.codicePos}`}>
                                          <div className="font-medium text-sm mb-2 flex items-center justify-between">
                                            <span>Servizi</span>
                                            <span className="font-bold">{srv.pezzi}</span>
                                          </div>
                                          <div className="text-[11px] text-gray-600 dark:text-gray-300 space-y-0.5">
                                            <div className="flex items-center gap-1 flex-wrap">
                                              <span className="font-medium">Attuali:</span>
                                              <span>{srv.pezzi} pz</span>
                                              <span>·</span>
                                              <span>{formatEuro(srv.importo)}</span>
                                            </div>
                                            <div className="flex items-center gap-1 flex-wrap">
                                              <span className="font-medium">Proiezione:</span>
                                              <span>{projSrvPz} pz</span>
                                              <span>·</span>
                                              <span>{formatEuro(projSrvImp)}</span>
                                            </div>
                                            <div className="text-[10px] text-gray-500 italic">Spedizione, assistenza, garanteasy</div>
                                          </div>
                                        </div>
                                        {(() => {
                                          const dev = pdv.devices;
                                          const kinds: { key: 'smartphone' | 'smartDevice' | 'internetDevice'; label: string }[] = [
                                            { key: 'smartphone', label: 'Smartphone' },
                                            { key: 'smartDevice', label: 'Smart Device' },
                                            { key: 'internetDevice', label: 'Internet Device' },
                                          ];
                                          const totAll = kinds.reduce((s, k) => s + deviceKindTotal(dev?.[k.key]), 0);
                                          if (totAll <= 0) return null;
                                          return (
                                            <div className="rounded-lg border p-3 bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-900/30 dark:text-violet-200 sm:col-span-2 lg:col-span-3" data-testid={`pdv-devices-${pdv.codicePos}`}>
                                              <div className="font-medium text-sm mb-2 flex items-center justify-between">
                                                <span className="flex items-center gap-1.5"><Smartphone className="h-4 w-4" /> Device venduti</span>
                                                <span className="font-bold">{totAll}</span>
                                              </div>
                                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                                {kinds.map((kk) => {
                                                  const k = dev?.[kk.key] || EMPTY_DEVICE_KIND;
                                                  const tot = deviceKindTotal(k);
                                                  const drillKey = `${pdv.codicePos}|${kk.key}`;
                                                  const open = expandedDeviceDrills.has(drillKey);
                                                  const merged = mergedDescriptions(k);
                                                  const sortedAll = Object.entries(merged.all).sort(([, a], [, b]) => b - a);
                                                  return (
                                                    <div key={kk.key} className="rounded border bg-white/70 dark:bg-black/20 p-2 text-[12px] text-gray-700 dark:text-gray-200" data-testid={`pdv-device-kind-${pdv.codicePos}-${kk.key}`}>
                                                      <div className="flex items-center justify-between mb-1">
                                                        <span className="font-medium">{kk.label}</span>
                                                        <span className="font-bold">{tot}</span>
                                                      </div>
                                                      <div className="text-[11px] text-gray-600 dark:text-gray-300 space-y-0.5">
                                                        <div>Finanziato: <span className="font-medium">{k.finanziato.pezzi}</span></div>
                                                        <div>Rate: <span className="font-medium">{k.rate.pezzi}</span></div>
                                                        {k.altro.pezzi > 0 && (<div>Altro: <span className="font-medium">{k.altro.pezzi}</span></div>)}
                                                      </div>
                                                      {tot > 0 && (
                                                        <button
                                                          type="button"
                                                          className="mt-1.5 text-[11px] text-violet-700 dark:text-violet-300 hover:underline flex items-center gap-1"
                                                          onClick={() => toggleDeviceDrill(drillKey)}
                                                          data-testid={`button-drill-device-${pdv.codicePos}-${kk.key}`}
                                                        >
                                                          {open ? '▾' : '▸'} {open ? 'Nascondi pezzi' : 'Mostra pezzi'}
                                                        </button>
                                                      )}
                                                      {open && sortedAll.length > 0 && (
                                                        <div className="mt-1 pl-2 border-l border-violet-200 dark:border-violet-800 space-y-0.5">
                                                          {sortedAll.map(([desc, count]) => {
                                                            const fin = merged.fin[desc] || 0;
                                                            const rate = merged.rate[desc] || 0;
                                                            const altro = merged.altro[desc] || 0;
                                                            const tags: string[] = [];
                                                            if (fin > 0) tags.push(`F:${fin}`);
                                                            if (rate > 0) tags.push(`R:${rate}`);
                                                            if (altro > 0) tags.push(`A:${altro}`);
                                                            return (
                                                              <div key={desc} className="flex justify-between text-[11px] text-gray-700 dark:text-gray-300 gap-2">
                                                                <span className="truncate" title={desc}>{desc}</span>
                                                                <span className="shrink-0 font-medium">
                                                                  {count}
                                                                  {tags.length > 0 && <span className="ml-1 text-gray-400">({tags.join(' · ')})</span>}
                                                                </span>
                                                              </div>
                                                            );
                                                          })}
                                                        </div>
                                                      )}
                                                    </div>
                                                  );
                                                })}
                                              </div>
                                            </div>
                                          );
                                        })()}
                                      </>
                                    );
                                  })()}
                                </div>
                              </AccordionContent>
                            </AccordionItem>
                          );
                        })()}
                        </Fragment>
                        );
                        });
                      })()}
                    </Accordion>
                  </CardContent>
                </Card>
              );
            })()}

            <Card data-testid="card-rs-breakdown">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Handshake className="h-5 w-5" />
                  Dettaglio per Ragione Sociale
                </CardTitle>
              </CardHeader>
              <CardContent>
                <RsBreakdown pdvList={mappedData.pdvList} workdayInfo={workdayInfo} pistaStats={pistaStats} />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function RsBreakdown({ pdvList, workdayInfo, pistaStats }: { pdvList: PdvData[]; workdayInfo: WorkdayInfo; pistaStats: Array<{ pista: string; calc: PistaCalcResult; pdvBreakdown: Array<{ codicePos: string; pezzi: number; pdvCalc: PistaCalcResult }> }> }) {
  const rsByName = useMemo(() => {
    const grouped: Record<string, { ragioneSociale: string; pdvs: PdvData[]; totalPezzi: number }> = {};
    for (const pdv of pdvList) {
      const rs = pdv.ragioneSociale || "N/D";
      if (!grouped[rs]) grouped[rs] = { ragioneSociale: rs, pdvs: [], totalPezzi: 0 };
      grouped[rs].pdvs.push(pdv);
      grouped[rs].totalPezzi += pdv.items.reduce((s, i) => s + i.pezzi, 0);
    }
    return Object.values(grouped).sort((a, b) => b.totalPezzi - a.totalPezzi);
  }, [pdvList]);

  return (
    <Accordion type="multiple" className="space-y-2">
      {rsByName.map((rs) => {
        const proiezione = workdayInfo.elapsedWorkingDays > 0
          ? Math.round((rs.totalPezzi / workdayInfo.elapsedWorkingDays) * workdayInfo.totalWorkingDays)
          : rs.totalPezzi;

        const allItems: AggregatedItem[] = [];
        for (const pdv of rs.pdvs) {
          for (const item of pdv.items) {
            const existing = allItems.find((i) => i.pista === item.pista && i.targetCategory === item.targetCategory);
            if (existing) existing.pezzi += item.pezzi;
            else allItems.push({ ...item });
          }
        }

        const byPista: Record<string, number> = {};
        for (const item of allItems) {
          byPista[item.pista] = (byPista[item.pista] || 0) + item.pezzi;
        }

        const egStatRS = pistaStats.find(s => s.pista === "extra_gara_iva");
        if (egStatRS) {
          let egPezziRS = 0;
          for (const pdv of rs.pdvs) {
            const egMatch = egStatRS.pdvBreakdown.find(b => b.codicePos === pdv.codicePos);
            if (egMatch) egPezziRS += egMatch.pezzi;
          }
          if (egPezziRS > 0) byPista["extra_gara_iva"] = egPezziRS;
        }

        let rsPremioTotale = 0;
        for (const pdv of rs.pdvs) {
          for (const stat of pistaStats) {
            const match = stat.pdvBreakdown.find((b) => b.codicePos === pdv.codicePos);
            if (match) {
              const aggPremio = stat.calc.premioStimato;
              const totalPuntiPista = stat.pdvBreakdown.reduce((s, b) => s + b.pdvCalc.puntiTotali, 0);
              rsPremioTotale += totalPuntiPista > 0
                ? Math.round((match.pdvCalc.puntiTotali / totalPuntiPista) * aggPremio * 100) / 100
                : 0;
            }
          }
        }

        return (
          <AccordionItem key={rs.ragioneSociale} value={rs.ragioneSociale} className="border rounded-lg px-2 sm:px-4" data-testid={`rs-accordion-${rs.ragioneSociale}`}>
            <AccordionTrigger className="hover:no-underline py-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between w-full pr-4 gap-1 sm:gap-2">
                <div className="text-left min-w-0">
                  <div className="font-medium text-sm truncate">{rs.ragioneSociale}</div>
                  <div className="text-sm text-gray-500">{rs.pdvs.length} PDV</div>
                </div>
                <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                  {rsPremioTotale > 0 && (
                    <Badge variant="outline" className="text-green-700 border-green-300 text-sm shrink-0">
                      {formatEuro(rsPremioTotale)}
                    </Badge>
                  )}
                  <div className="text-right shrink-0">
                    <div className="font-bold text-sm">{rs.totalPezzi} pezzi</div>
                    <div className="text-sm text-gray-400">Proiezione: {proiezione}</div>
                  </div>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 pb-3">
                <div className="flex flex-wrap gap-2">
                  {Object.entries(byPista).sort(([a], [b]) => pistaOrderRank(a) - pistaOrderRank(b)).map(([pistaKey, pezzi]) => {
                    const conf = PISTA_CONFIG[pistaKey as keyof typeof PISTA_CONFIG];
                    if (!conf) return null;
                    return (
                      <Badge key={pistaKey} variant="outline" className={conf.lightColor}>
                        {conf.label}: {pezzi}
                      </Badge>
                    );
                  })}
                </div>
                {(() => {
                  const spMob = rs.pdvs.reduce((s, p) => s + pdvSmartphoneMobileCount(p), 0);
                  const spCB = rs.pdvs.reduce((s, p) => s + pdvSmartphoneCBCount(p), 0);
                  const accPz = rs.pdvs.reduce((s, p) => s + (p.accessori?.pezzi || 0), 0);
                  const accImp = rs.pdvs.reduce((s, p) => s + (p.accessori?.importo || 0), 0);
                  const srvPz = rs.pdvs.reduce((s, p) => s + (p.servizi?.pezzi || 0), 0);
                  const srvImp = rs.pdvs.reduce((s, p) => s + (p.servizi?.importo || 0), 0);
                  const elapsed = workdayInfo.elapsedWorkingDays;
                  const total = workdayInfo.totalWorkingDays;
                  const pj = (n: number) => elapsed > 0 ? Math.round((n / elapsed) * total) : n;
                  const pje = (n: number) => elapsed > 0 ? (n / elapsed) * total : n;
                  return (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                      <div className="rounded-lg border p-3 bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-200">
                        <div className="text-xs font-medium flex items-center gap-1"><Smartphone className="h-3 w-3" /> Smartphone Mobile</div>
                        <div className="text-lg font-bold">{spMob}</div>
                        <div className="text-[11px] text-gray-500">Proiezione: {pj(spMob)}</div>
                      </div>
                      <div className="rounded-lg border p-3 bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-200">
                        <div className="text-xs font-medium flex items-center gap-1"><Smartphone className="h-3 w-3" /> Smartphone CB</div>
                        <div className="text-lg font-bold">{spCB}</div>
                        <div className="text-[11px] text-gray-500">Proiezione: {pj(spCB)}</div>
                      </div>
                      <div className="rounded-lg border p-3 bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900/30 dark:text-slate-200" data-testid={`rs-accessori-${rs.ragioneSociale}`}>
                        <div className="text-xs font-medium">Accessori</div>
                        <div className="text-lg font-bold">{accPz} pz · {formatEuro(accImp)}</div>
                        <div className="text-[11px] text-gray-500">Proiezione: {pj(accPz)} pz · {formatEuro(pje(accImp))}</div>
                      </div>
                      <div className="rounded-lg border p-3 bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-200" data-testid={`rs-servizi-${rs.ragioneSociale}`}>
                        <div className="text-xs font-medium">Servizi</div>
                        <div className="text-lg font-bold">{srvPz} pz · {formatEuro(srvImp)}</div>
                        <div className="text-[11px] text-gray-500">Proiezione: {pj(srvPz)} pz · {formatEuro(pje(srvImp))}</div>
                      </div>
                    </div>
                  );
                })()}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {rs.pdvs.map((pdv) => {
                    const pdvPezzi = pdv.items.reduce((s, i) => s + i.pezzi, 0);
                    return (
                      <div key={pdv.codicePos} className="border rounded p-3 text-sm">
                        <div className="flex justify-between">
                          <span className="font-medium">{pdv.nomeNegozio}</span>
                          <div className="flex items-center gap-2">
                            <span className="font-bold">{pdvPezzi}</span>
                          </div>
                        </div>
                        <div className="text-sm text-gray-400">{pdv.codicePos}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}
