/* =============================================================================
   TIPI DI BASE
============================================================================== */

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = domenica

export const WEEKDAY_LABELS: { value: Weekday; label: string }[] = [
  { value: 1, label: "Lunedì" },
  { value: 2, label: "Martedì" },
  { value: 3, label: "Mercoledì" },
  { value: 4, label: "Giovedì" },
  { value: 5, label: "Venerdì" },
  { value: 6, label: "Sabato" },
  { value: 0, label: "Domenica" },
];

export interface WeeklySchedule {
  workingDays: Weekday[];
}

export interface SpecialDay {
  date: string; // YYYY-MM-DD
  isOpen: boolean;
  note?: string;
}

export interface StoreCalendar {
  weeklySchedule: WeeklySchedule;
  specialDays?: SpecialDay[];
}

export type PuntoVenditaType = "centro_commerciale" | "strada" | "altro";

export type CanalePdv =
  | "franchising"
  | "retail"
  | "dealer"
  | "top_dealer"
  | "corner";

export type ClusterCode =
  | "CC1"
  | "CC2"
  | "CC3"
  | "strada_1"
  | "strada_2"
  | "strada_3"
  | "local_x";

export type ClusterPIvaCode =
  | "business_promoter_plus"
  | "business_promoter"
  | "senza_business_promoter";

export const CLUSTER_PIVA_OPTIONS: { value: ClusterPIvaCode; label: string }[] = [
  { value: "business_promoter_plus", label: "Business Promoter Plus+" },
  { value: "business_promoter", label: "Business Promoter" },
  { value: "senza_business_promoter", label: "Senza Business Promoter" },
];

export interface PuntoVendita {
  id: string;
  codicePos: string;
  nome: string;
  ragioneSociale: string;
  tipoPosizione: PuntoVenditaType;
  canale: CanalePdv;
  clusterMobile: ClusterCode | "";
  clusterFisso: ClusterCode | "";
  clusterCB: ClusterCode | "";
  clusterPIva: ClusterPIvaCode | "";
  abilitaEnergia: boolean;
  abilitaAssicurazioni: boolean;
  ruoloBusiness?: "none" | "local_promoter" | "local_promoter_plus";
  calendar: StoreCalendar;
}

/* =============================================================================
   PISTA MOBILE - TIPI, CATEGORIE, CONFIG
============================================================================== */

export enum MobileActivationType {
  SIM_CNS = "SIM_CNS",
  SIM_IVA = "SIM_IVA",
  PROFESSIONAL_FLEX = "PROFESSIONAL_FLEX",
  PROFESSIONAL_DATA_10 = "PROFESSIONAL_DATA_10",
  PROFESSIONAL_SPECIAL = "PROFESSIONAL_SPECIAL",
  PROFESSIONAL_STAFF = "PROFESSIONAL_STAFF",
  PROFESSIONAL_WORLD = "PROFESSIONAL_WORLD",
  ALTRE_SIM_IVA = "ALTRE_SIM_IVA",
  PHASE_IN_TIED = "PHASE_IN_TIED",
  WINBACK = "WINBACK",
  CONVERGENTE_SUPERFIBRA_MULTISERVICE = "CONVERGENTE_SUPERFIBRA_MULTISERVICE",
  TIED = "TIED",
  UNTIED = "UNTIED",
  TOURIST_FULL = "TOURIST_FULL",
  TOURIST_PASS = "TOURIST_PASS",
  TOURIST_XXL = "TOURIST_XXL",
  MNP = "MNP",
  MNP_MVNO = "MNP_MVNO",
  PIU_SICURI_MOBILE = "PIU_SICURI_MOBILE",
  PIU_SICURI_MOBILE_PRO = "PIU_SICURI_MOBILE_PRO",
  RELOAD_EXCHANGE = "RELOAD_EXCHANGE",
  DEVICE_1_FIN_SP_LT_200 = "DEVICE_1_FIN_SP_LT_200",
  DEVICE_1_FIN_SP_200_600 = "DEVICE_1_FIN_SP_200_600",
  DEVICE_1_FIN_SP_GTE_600 = "DEVICE_1_FIN_SP_GTE_600",
  DEVICE_VAR_SP_LT_200 = "DEVICE_VAR_SP_LT_200",
  DEVICE_VAR_SP_GTE_200 = "DEVICE_VAR_SP_GTE_200",
  DEVICE_2_FINANZIATO = "DEVICE_2_FINANZIATO",
}

export const MOBILE_CATEGORY_LABELS: { value: MobileActivationType; label: string }[] =
  [
    { value: MobileActivationType.SIM_CNS, label: "SIM Consumer" },
    { value: MobileActivationType.SIM_IVA, label: "SIM IVA" },
    { value: MobileActivationType.PROFESSIONAL_FLEX, label: "Professional Flex" },
    { value: MobileActivationType.PROFESSIONAL_DATA_10, label: "Professional Data 10" },
    { value: MobileActivationType.PROFESSIONAL_SPECIAL, label: "Professional Special" },
    { value: MobileActivationType.PROFESSIONAL_STAFF, label: "Professional Staff" },
    { value: MobileActivationType.PROFESSIONAL_WORLD, label: "Professional World" },
    { value: MobileActivationType.ALTRE_SIM_IVA, label: "Altre SIM IVA" },
    { value: MobileActivationType.PHASE_IN_TIED, label: "Phase In Tied" },
    { value: MobileActivationType.WINBACK, label: "WinBack" },
    {
      value: MobileActivationType.CONVERGENTE_SUPERFIBRA_MULTISERVICE,
      label: "Convergente Superfibra / Multiservice",
    },
    { value: MobileActivationType.TIED, label: "Tied" },
    { value: MobileActivationType.UNTIED, label: "Untied" },
    { value: MobileActivationType.TOURIST_FULL, label: "Tourist Full" },
    { value: MobileActivationType.TOURIST_PASS, label: "Tourist Pass" },
    { value: MobileActivationType.TOURIST_XXL, label: "Tourist XXL" },
    { value: MobileActivationType.MNP, label: "MNP" },
    { value: MobileActivationType.MNP_MVNO, label: "MNP da MVNO" },
    { value: MobileActivationType.PIU_SICURI_MOBILE, label: "Più Sicuri Mobile" },
    { value: MobileActivationType.PIU_SICURI_MOBILE_PRO, label: "Più Sicuri Mobile Pro" },
    { value: MobileActivationType.RELOAD_EXCHANGE, label: "Reload Exchange" },
    {
      value: MobileActivationType.DEVICE_1_FIN_SP_LT_200,
      label: "1° Device finanziato SP < 200€",
    },
    {
      value: MobileActivationType.DEVICE_1_FIN_SP_200_600,
      label: "1° Device finanziato 200–600€",
    },
    {
      value: MobileActivationType.DEVICE_1_FIN_SP_GTE_600,
      label: "1° Device finanziato ≥ 600€",
    },
    {
      value: MobileActivationType.DEVICE_VAR_SP_LT_200,
      label: "Device VAR < 200€",
    },
    {
      value: MobileActivationType.DEVICE_VAR_SP_GTE_200,
      label: "Device VAR ≥ 200€",
    },
    { value: MobileActivationType.DEVICE_2_FINANZIATO, label: "2° Device" },
  ];

export interface GettonePerSoglia {
  base: number;
  soglia1: number;
  soglia2: number;
  soglia3: number;
  soglia4: number;
}

export interface MobileCategoryConfig {
  type: MobileActivationType;
  punti: number;
  contaSuCanoneMedio: boolean;
  extraGettoneEuro?: number;
  gettonePerSoglia?: GettonePerSoglia;
}

export const MOBILE_CATEGORIES_CONFIG_DEFAULT: MobileCategoryConfig[] = [
  { type: MobileActivationType.SIM_CNS, punti: 1, contaSuCanoneMedio: true },
  { type: MobileActivationType.SIM_IVA, punti: 1, contaSuCanoneMedio: true },
  { type: MobileActivationType.PROFESSIONAL_FLEX, punti: 0.5, contaSuCanoneMedio: true },
  { type: MobileActivationType.PROFESSIONAL_DATA_10, punti: 0.5, contaSuCanoneMedio: true },
  { type: MobileActivationType.PROFESSIONAL_SPECIAL, punti: 0.5, contaSuCanoneMedio: true },
  { type: MobileActivationType.PROFESSIONAL_STAFF, punti: 1.25, contaSuCanoneMedio: true },
  { type: MobileActivationType.PROFESSIONAL_WORLD, punti: 0.75, contaSuCanoneMedio: true },
  { type: MobileActivationType.ALTRE_SIM_IVA, punti: 0.75, contaSuCanoneMedio: true },
  { type: MobileActivationType.PHASE_IN_TIED, punti: 0.5, contaSuCanoneMedio: true },
  { type: MobileActivationType.WINBACK, punti: 1.2, contaSuCanoneMedio: true },
  {
    type: MobileActivationType.CONVERGENTE_SUPERFIBRA_MULTISERVICE,
    punti: 1.5,
    contaSuCanoneMedio: true,
  },
  { type: MobileActivationType.TIED, punti: 0.75, contaSuCanoneMedio: true },
  { type: MobileActivationType.UNTIED, punti: 0.75, contaSuCanoneMedio: true },
  { type: MobileActivationType.TOURIST_FULL, punti: 1, contaSuCanoneMedio: true },
  { type: MobileActivationType.TOURIST_PASS, punti: 1, contaSuCanoneMedio: true },
  { type: MobileActivationType.TOURIST_XXL, punti: 1, contaSuCanoneMedio: true },
  { type: MobileActivationType.MNP, punti: 1.2, contaSuCanoneMedio: true },
  { type: MobileActivationType.MNP_MVNO, punti: 1, contaSuCanoneMedio: true },
  {
    type: MobileActivationType.PIU_SICURI_MOBILE,
    punti: 0.25,
    contaSuCanoneMedio: false,
    extraGettoneEuro: 0.5,
  },
  {
    type: MobileActivationType.PIU_SICURI_MOBILE_PRO,
    punti: 0.25,
    contaSuCanoneMedio: false,
    extraGettoneEuro: 5,
  },
  {
    type: MobileActivationType.RELOAD_EXCHANGE,
    punti: 0.5,
    contaSuCanoneMedio: false,
    extraGettoneEuro: 5,
  },
  {
    type: MobileActivationType.DEVICE_1_FIN_SP_LT_200,
    punti: 1.25,
    contaSuCanoneMedio: false,
    extraGettoneEuro: 20,
  },
  {
    type: MobileActivationType.DEVICE_1_FIN_SP_200_600,
    punti: 1.25,
    contaSuCanoneMedio: false,
    extraGettoneEuro: 25,
  },
  {
    type: MobileActivationType.DEVICE_1_FIN_SP_GTE_600,
    punti: 1.25,
    contaSuCanoneMedio: false,
    extraGettoneEuro: 40,
  },
  {
    type: MobileActivationType.DEVICE_VAR_SP_LT_200,
    punti: 0,
    contaSuCanoneMedio: false,
    extraGettoneEuro: 5,
  },
  {
    type: MobileActivationType.DEVICE_VAR_SP_GTE_200,
    punti: 0,
    contaSuCanoneMedio: false,
    extraGettoneEuro: 15,
  },
  {
    type: MobileActivationType.DEVICE_2_FINANZIATO,
    punti: 0,
    contaSuCanoneMedio: false,
    extraGettoneEuro: 15,
  },
];

export interface PistaMobilePosConfig {
  posCode: string;
  soglia1: number;
  soglia2: number;
  soglia3: number;
  soglia4?: number;
  multiplierSoglia1: number;
  multiplierSoglia2: number;
  multiplierSoglia3: number;
  multiplierSoglia4?: number;
  canoneMedio: number;
  forecastTargetPunti?: number;
  clusterPista?: 1 | 2 | 3;
}

export interface PistaMobileConfig {
  sogliePerPos: PistaMobilePosConfig[];
  applicaDecurtazione30SeNoFissoO8Piva: boolean;
}

export interface AttivatoMobileDettaglio {
  id: string;
  type?: MobileActivationType;
  pezzi: number;
}

export interface AggregateMobileResult {
  attivazioniValide: number;
  puntiTotali: number;
  extraGettoniEuro: number;
}

export interface WorkdayInfo {
  totalWorkingDays: number;
  elapsedWorkingDays: number;
  remainingWorkingDays: number;
}

export interface CalcoloPistaMobilePosResult {
  posCode: string;
  soglia: number;
  premio: number;
  forecastTargetPunti?: number;
  forecastRaggiungimentoPercent?: number;
  forecastGapPunti?: number;
  workdayInfo: WorkdayInfo;
  punti: number;
  attivazioni: number;
  runRateGiornalieroPunti: number;
  runRateGiornalieroAttivazioni: number;
}

/* =============================================================================
   TIPOLOGIA GARA
============================================================================== */

export type TipologiaGara = "gara_operatore" | "gara_operatore_rs" | "gara_addetto";

export const TIPOLOGIA_GARA_OPTIONS: { value: TipologiaGara; label: string }[] = [
  { value: "gara_operatore", label: "Gara operatore" },
  { value: "gara_operatore_rs", label: "Gara operatore RS" },
  { value: "gara_addetto", label: "Gara addetto" },
];

export interface ConfigGaraBase {
  nomeGara: string;
  haLetteraUfficiale: boolean;
  annoGara: number;
  meseGara: number;
  tipoPeriodo?: "mensile" | "bimestrale" | "trimestrale";
  tipologiaGara?: TipologiaGara;
}

export interface GaraPeriodoConfig {
  anno?: number;
  mese?: number;
  tipo?: "mensile" | "bimestrale" | "trimestrale";
}

export interface GaraConfigUpload {
  periodo?: GaraPeriodoConfig;
  mobileCategories?: MobileCategoryConfig[];
  pistaMobile?: {
    sogliePerPos?: Partial<PistaMobilePosConfig>[];
  };
}

export const CLUSTER_OPTIONS: { value: ClusterCode; label: string }[] = [
  { value: "CC1", label: "CC1" },
  { value: "CC2", label: "CC2" },
  { value: "CC3", label: "CC3" },
  { value: "strada_1", label: "Strada 1" },
  { value: "strada_2", label: "Strada 2" },
  { value: "strada_3", label: "Strada 3" },
  { value: "local_x", label: "Local X" },
];

/* =============================================================================
   SOGLIE PER RAGIONE SOCIALE (GARA OPERATORE RS)
============================================================================== */

// Soglie Mobile aggregate per Ragione Sociale
export interface SoglieMobileRS {
  ragioneSociale: string;
  soglia1: number;
  soglia2: number;
  soglia3: number;
  soglia4: number;
  canoneMedio: number;
  forecastTargetPunti?: number;
}

// Soglie Fisso aggregate per Ragione Sociale
export interface SoglieFissoRS {
  ragioneSociale: string;
  soglia1: number;
  soglia2: number;
  soglia3: number;
  soglia4: number;
  soglia5?: number;
  forecastTargetPunti?: number;
}

// Configurazione Pista Mobile per RS
export interface PistaMobileRSConfig {
  sogliePerRS: SoglieMobileRS[];
  applicaDecurtazione30SeNoFissoO8Piva: boolean;
}

// Configurazione Pista Fisso per RS
export interface PistaFissoRSConfig {
  sogliePerRS: SoglieFissoRS[];
}

// Configurazione Partnership Reward per Ragione Sociale
export interface PartnershipRewardRS {
  ragioneSociale: string;
  target100: number;
  target80: number;
  premio100: number;
  premio80: number;
}

export interface PartnershipRewardRSConfig {
  configPerRS: PartnershipRewardRS[];
}

/* =============================================================================
   MODALITÀ INSERIMENTO RS
============================================================================== */

export type ModalitaInserimentoRS = "per_rs" | "per_pdv" | null;
