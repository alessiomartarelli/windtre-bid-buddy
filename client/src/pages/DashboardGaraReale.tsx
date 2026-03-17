import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
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
} from "lucide-react";
import { apiUrl } from "@/lib/basePath";
import { AppNavbar } from "@/components/AppNavbar";
import { type GaraConfigRecord, type GaraConfigPdv } from "@/hooks/useGaraConfig";
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
import {
  calcolaProtecta,
} from "@/lib/calcoloProtecta";
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
} from "@/types/partnership-cb-events";
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
}

interface PdvData {
  codicePos: string;
  nomeNegozio: string;
  ragioneSociale: string;
  items: AggregatedItem[];
  unmapped: number;
  totalArticoli: number;
}

interface MappedSalesResponse {
  month: number;
  year: number;
  totalSales: number;
  totalArticoli: number;
  totalMapped: number;
  totalUnmapped: number;
  pdvList: PdvData[];
  totaliPerPista: Record<string, Record<string, { targetCategory: string; targetLabel: string; pezzi: number }>>;
}

interface OrgConfigPdv {
  id: string;
  codicePos: string;
  nome: string;
  ragioneSociale: string;
  calendar: StoreCalendar;
  clusterMobile?: string;
  clusterFisso?: string;
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

const PISTA_CONFIG = {
  mobile: { label: "Mobile", icon: Smartphone, color: "bg-blue-500", lightColor: "bg-blue-50 text-blue-700 border-blue-200" },
  fisso: { label: "Fisso", icon: Wifi, color: "bg-green-500", lightColor: "bg-green-50 text-green-700 border-green-200" },
  energia: { label: "Energia", icon: Zap, color: "bg-amber-500", lightColor: "bg-amber-50 text-amber-700 border-amber-200" },
  assicurazioni: { label: "Assicurazioni", icon: Shield, color: "bg-purple-500", lightColor: "bg-purple-50 text-purple-700 border-purple-200" },
  partnership: { label: "Partnership", icon: Handshake, color: "bg-cyan-500", lightColor: "bg-cyan-50 text-cyan-700 border-cyan-200" },
  protecta: { label: "Protecta", icon: Shield, color: "bg-rose-500", lightColor: "bg-rose-50 text-rose-700 border-rose-200" },
} as const;

const DEFAULT_CALENDAR: StoreCalendar = {
  weeklySchedule: { workingDays: [1, 2, 3, 4, 5, 6] as Weekday[] },
  specialDays: [],
};

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

  const result = calcolaPremioPistaMobilePerPos({
    configPos: mobileConfig,
    dettaglio,
    calendar,
    year,
    month: month - 1,
    mobileCategories,
    workdayInfoOverride: workdayInfo,
    valoreCanoniOverride: totalCanone,
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

function calcFissoPerPdv(
  pdvItems: AggregatedItem[],
  fissoConfig: PistaFissoPosConfig | undefined,
  calendar: StoreCalendar,
  clusterFisso: 1 | 2 | 3,
  posCode: string,
  year: number,
  month: number,
  workdayInfo: WorkdayInfo,
): PistaCalcResult {
  if (!fissoConfig || pdvItems.length === 0) return EMPTY_CALC;

  const VALID_FISSO_TYPES: Set<string> = new Set([
    "FISSO_FTTC","FISSO_FTTH","FISSO_FWA_OUT","FISSO_FWA_IND_2P","FRITZ_BOX",
    "NETFLIX_CON_ADV","NETFLIX_SENZA_ADV","CONVERGENZA","LINEA_ATTIVA",
    "FISSO_PIVA_1A_LINEA","FISSO_PIVA_2A_LINEA","CHIAMATE_ILLIMITATE",
    "BOLLETTINO_POSTALE","PIU_SICURI_CASA_UFFICIO","ASSICURAZIONI_PLUS_FULL","MIGRAZIONI_FTTH_FWA",
  ]);
  const validFissoItems = pdvItems.filter((item) => VALID_FISSO_TYPES.has(item.targetCategory));
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
  });

  return {
    premioStimato: result.premio,
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
  });

  return {
    premioStimato: result.premioTotale,
    puntiTotali: result.totalePezzi,
    sogliaRaggiunta: result.sogliaRaggiunta,
    sogliaLabel: sogliaToLabel(result.sogliaRaggiunta, 3),
  };
}

const CB_EVENT_LOOKUP = new Map(CB_EVENTS_CONFIG.map((c) => [c.type, c]));
const VALID_CB_TYPES = new Set(CB_EVENTS_CONFIG.map((c) => c.type as string));

function calcPartnershipPerPdv(
  pdvItems: AggregatedItem[],
  partnershipConfig: PartnershipRewardPosConfig | undefined,
  giorniLavorativi: number,
  posCode: string,
): PistaCalcResult {
  if (!partnershipConfig || pdvItems.length === 0) return EMPTY_CALC;

  const validItems = pdvItems.filter((item) => VALID_CB_TYPES.has(item.targetCategory));
  const attivato: AttivatoCBDettaglio[] = validItems.map((item) => {
    const eventConf = CB_EVENT_LOOKUP.get(item.targetCategory as CBEventType);
    return {
      eventType: item.targetCategory as CBEventType,
      pezzi: item.pezzi,
      gettoni: eventConf?.gettoni ?? 0,
      puntiPartnership: 1,
    };
  });

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

function calcAssicurazioniForAllPdv(
  mappedData: MappedSalesResponse,
  puntiVendita: OrgConfigPdv[],
  assicConfig: AssicurazioniConfig | undefined,
  pdvInGara: AssicurazioniPdvInGara[],
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
    clusterCB: "" as PuntoVendita["clusterCB"],
    clusterPIva: "" as PuntoVendita["clusterPIva"],
    ruoloBusiness: "none" as PuntoVendita["ruoloBusiness"],
    abilitaEnergia: p.abilitaEnergia ?? false,
    abilitaAssicurazioni: p.abilitaAssicurazioni ?? false,
  })) as PuntoVendita[];

  const results = calcoloAssicurazioniPerPos(pdvs, assicConfig, pdvInGara, attivatoByPos);
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
    clusterCB: "" as PuntoVendita["clusterCB"],
    clusterPIva: "" as PuntoVendita["clusterPIva"],
    ruoloBusiness: "none" as PuntoVendita["ruoloBusiness"],
    abilitaEnergia: p.abilitaEnergia ?? false,
    abilitaAssicurazioni: p.abilitaAssicurazioni ?? false,
  })) as PuntoVendita[];

  const results = calcolaProtecta(attivatoByPos, pdvs);
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
    <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${color}`} data-testid={`projection-badge-${label}`}>
      <TrendingUp className="h-3 w-3" />
      Proiezione: {projected}
    </div>
  );
}

export default function DashboardGaraReale() {
  const [, setLocation] = useLocation();
  const now = new Date();
  const [selectedPeriod, setSelectedPeriod] = useState(`${now.getFullYear()}-${now.getMonth() + 1}`);

  const [selMonth, selYear] = useMemo(() => {
    const parts = selectedPeriod.split("-");
    return [parseInt(parts[1]), parseInt(parts[0])];
  }, [selectedPeriod]);

  const monthOptions = useMemo(() => getMonthOptions(), []);

  const { data: mappedData, isLoading: loadingMapped } = useQuery<MappedSalesResponse>({
    queryKey: ["/api/admin/bisuite-mapped-sales", selMonth, selYear],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/admin/bisuite-mapped-sales?month=${selMonth}&year=${selYear}`), { credentials: "include" });
      if (!res.ok) throw new Error("Errore nel caricamento dati");
      return res.json();
    },
  });

  const { data: garaConfig, isLoading: loadingConfig } = useQuery<GaraConfigRecord | null>({
    queryKey: ["/api/gara-config", selMonth, selYear],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/gara-config?month=${selMonth}&year=${selYear}`), { credentials: "include" });
      if (!res.ok) throw new Error("Errore config gara");
      const data = await res.json();
      return data as GaraConfigRecord | null;
    },
  });

  const garaConfigMissing = !loadingConfig && !garaConfig;

  const garaPdvList: GaraConfigPdv[] = garaConfig?.config?.pdvList || [];

  const garaCalcConfig = useMemo(() => {
    const cfg = garaConfig?.config as Record<string, unknown> | null;
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
    const energiaPdvInGara = puntiVendita.filter(p => p.abilitaEnergia).map(p => ({ pdvId: p.codicePos, codicePos: p.codicePos, isInGara: true }));
    const mobileCategories = garaCalcConfig.mobileCategories || MOBILE_CATEGORIES_CONFIG_DEFAULT;
    const numPdvInGaraEnergia = energiaPdvInGara.length || puntiVendita.length || 1;
    const partnershipConfigs = garaCalcConfig.partnershipRewardConfig?.configPerPos || [];
    const assicConfig = garaCalcConfig.assicurazioniConfig;
    const assicPdvInGara = puntiVendita.filter(p => p.abilitaAssicurazioni).map(p => ({ pdvId: p.codicePos, codicePos: p.codicePos, nome: p.nome, isInGara: true }));

    const getMobileConfigForPdv = (codicePos: string, ragioneSociale: string): PistaMobilePosConfig | undefined => {
      if (isRSPerRS) {
        const rsConfig = mobileRSConfigs.find(c => c.ragioneSociale === ragioneSociale);
        if (rsConfig) {
          return {
            posCode: codicePos,
            soglia1: rsConfig.soglia1, soglia2: rsConfig.soglia2, soglia3: rsConfig.soglia3, soglia4: rsConfig.soglia4,
            multiplierSoglia1: (rsConfig as Record<string, unknown>).multiplierSoglia1 as number || 1,
            multiplierSoglia2: (rsConfig as Record<string, unknown>).multiplierSoglia2 as number || 1.2,
            multiplierSoglia3: (rsConfig as Record<string, unknown>).multiplierSoglia3 as number || 1.5,
            multiplierSoglia4: (rsConfig as Record<string, unknown>).multiplierSoglia4 as number || 2,
            forecastTargetPunti: rsConfig.forecastTargetPunti,
            clusterPista: rsConfig.clusterPista as 1 | 2 | 3 | undefined,
          };
        }
      }
      const found = mobileConfigs.find(c => c.posCode === codicePos) || mobileConfigs[0];
      if (found && !found.multiplierSoglia1) {
        return { ...found, multiplierSoglia1: 1, multiplierSoglia2: 1.2, multiplierSoglia3: 1.5, multiplierSoglia4: 2 };
      }
      return found;
    };

    const getFissoConfigForPdv = (codicePos: string, ragioneSociale: string): PistaFissoPosConfig | undefined => {
      if (isRSPerRS) {
        const rsConfig = fissoRSConfigs.find(c => c.ragioneSociale === ragioneSociale);
        if (rsConfig) {
          return {
            posCode: codicePos,
            soglia1: rsConfig.soglia1, soglia2: rsConfig.soglia2, soglia3: rsConfig.soglia3, soglia4: rsConfig.soglia4, soglia5: rsConfig.soglia5,
            multiplierSoglia1: (rsConfig as Record<string, unknown>).multiplierSoglia1 as number || 2,
            multiplierSoglia2: (rsConfig as Record<string, unknown>).multiplierSoglia2 as number || 3,
            multiplierSoglia3: (rsConfig as Record<string, unknown>).multiplierSoglia3 as number || 3.5,
            multiplierSoglia4: (rsConfig as Record<string, unknown>).multiplierSoglia4 as number || 4,
            multiplierSoglia5: (rsConfig as Record<string, unknown>).multiplierSoglia5 as number || 5,
            forecastTargetPunti: rsConfig.forecastTargetPunti,
          };
        }
      }
      const found = fissoConfigs.find(c => c.posCode === codicePos) || fissoConfigs[0];
      if (found && !(found as Record<string, unknown>).multiplierSoglia1) {
        return { ...found, multiplierSoglia1: 2, multiplierSoglia2: 3, multiplierSoglia3: 3.5, multiplierSoglia4: 4, multiplierSoglia5: 5 };
      }
      return found;
    };

    const getPartnershipConfigForPdv = (codicePos: string, ragioneSociale: string) => {
      if (isRSPerRS) {
        const rsConfig = partnershipRSConfigs.find(c => c.ragioneSociale === ragioneSociale);
        if (rsConfig) {
          return { posCode: codicePos, config: { target100: rsConfig.target100, target80: rsConfig.target80, premio100: rsConfig.premio100, premio80: rsConfig.premio80 } };
        }
      }
      return partnershipConfigs.find(c => c.posCode === codicePos);
    };

    const assicCalcMap = calcAssicurazioniForAllPdv(mappedData, puntiVendita, assicConfig, assicPdvInGara);
    const protectaCalcMap = calcProtectaForAllPdv(mappedData, puntiVendita);

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
        pezzi: number;
        proiezione: number;
        pdvCalc: PistaCalcResult;
        categories: Array<{ category: string; label: string; pezzi: number; canone: number }>;
      }>;
    }> = [];

    const pisteOrder: (keyof typeof PISTA_CONFIG)[] = ["mobile", "fisso", "energia", "assicurazioni", "partnership", "protecta"];

    for (const pista of pisteOrder) {
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

      const categories = Object.values(pistaData).map((cat: any) => {
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
      }).sort((a, b) => b.pezzi - a.pezzi);

      const totalePezzi = categories.reduce((sum, c) => sum + c.pezzi, 0);
      const proiezionePezzi = workdayInfo.elapsedWorkingDays > 0
        ? Math.round((totalePezzi / workdayInfo.elapsedWorkingDays) * workdayInfo.totalWorkingDays)
        : totalePezzi;

      let aggregateCalc: PistaCalcResult = EMPTY_CALC;
      let aggregateCalcProiezione: PistaCalcResult = EMPTY_CALC;

      const pdvBreakdown = mappedData.pdvList
        .map((pdv) => {
          const pdvItems = pdv.items.filter((i) => i.pista === pista);
          const pdvPezzi = pdvItems.reduce((s, i) => s + i.pezzi, 0);
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
            pdvCalc = calcMobilePerPdv(pdvItems, mConfig, pdvCalendar, selYear, selMonth, mobileCategories, pdvWorkday);
          } else if (pista === "fisso") {
            const fConfig = getFissoConfigForPdv(pdv.codicePos, pdvRS);
            const cluster = clusterToNumber(pdvConfig?.clusterFisso);
            pdvCalc = calcFissoPerPdv(pdvItems, fConfig, pdvCalendar, cluster, pdv.codicePos, selYear, selMonth, pdvWorkday);
          } else if (pista === "energia") {
            const isInGara = energiaPdvInGara.some((e) => (e.codicePos === pdv.codicePos || e.pdvId === pdv.codicePos) && e.isInGara);
            pdvCalc = calcEnergiaPerPdv(pdvItems, energiaConfig, pdv.codicePos, isInGara, numPdvInGaraEnergia);
          } else if (pista === "partnership") {
            const pCfg = getPartnershipConfigForPdv(pdv.codicePos, pdvRS);
            const prConfig: PartnershipRewardPosConfig | undefined = pCfg ? { posCode: pCfg.posCode, config: pCfg.config } : undefined;
            pdvCalc = calcPartnershipPerPdv(pdvItems, prConfig, pdvWorkday.elapsedWorkingDays, pdv.codicePos);
          } else if (pista === "assicurazioni") {
            pdvCalc = assicCalcMap.get(pdv.codicePos) || EMPTY_CALC;
          } else if (pista === "protecta") {
            pdvCalc = protectaCalcMap.get(pdv.codicePos) || EMPTY_CALC;
          }

          return {
            codicePos: pdv.codicePos,
            nomeNegozio: pdv.nomeNegozio,
            ragioneSociale: pdv.ragioneSociale,
            pezzi: pdvPezzi,
            proiezione: pdvProiezione,
            pdvCalc,
            categories: pdvItems.map((i) => ({ category: i.targetCategory, label: i.targetLabel, pezzi: i.pezzi, canone: i.canone || 0 })),
          };
        })
        .filter((p) => p.pezzi > 0)
        .sort((a, b) => b.pezzi - a.pezzi);

      if (pdvBreakdown.length > 0) {
        const useRSAggregation = isRSPerRS && (pista === "mobile" || pista === "fisso" || pista === "partnership");

        if (useRSAggregation) {
          const rsGroupMap = new Map<string, typeof pdvBreakdown>();
          for (const pdv of pdvBreakdown) {
            const rs = pdv.ragioneSociale || 'Senza RS';
            if (!rsGroupMap.has(rs)) rsGroupMap.set(rs, []);
            rsGroupMap.get(rs)!.push(pdv);
          }

          let totalPremio = 0;
          let totalPunti = 0;
          let bestSoglia = 0;
          let totalPremioProj = 0;
          let totalPuntiProj = 0;
          let bestSogliaProj = 0;

          rsGroupMap.forEach((rsPdvs, rs) => {
            const rsItems: AggregatedItem[] = [];
            for (const pdv of rsPdvs) {
              const pdvItems2 = pdv.categories.map(c => ({ pista, targetCategory: c.category, targetLabel: c.label, pezzi: c.pezzi, canone: c.canone || 0 }));
              rsItems.push(...pdvItems2);
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

            const firstPdvConfig = puntiVendita.find(p => p.codicePos === rsPdvs[0].codicePos);
            const rsCalendar = firstPdvConfig?.calendar || DEFAULT_CALENDAR;
            const rsWorkday = getWorkdayInfoForMonth(selYear, selMonth - 1, rsCalendar, new Date());

            let rsCalc = EMPTY_CALC;
            if (pista === "mobile") {
              const mConfig = getMobileConfigForPdv(rsPdvs[0].codicePos, rs);
              rsCalc = calcMobilePerPdv(aggregatedRSItems, mConfig, rsCalendar, selYear, selMonth, mobileCategories, rsWorkday);
            } else if (pista === "fisso") {
              const fConfig = getFissoConfigForPdv(rsPdvs[0].codicePos, rs);
              const cluster = clusterToNumber(firstPdvConfig?.clusterFisso);
              rsCalc = calcFissoPerPdv(aggregatedRSItems, fConfig, rsCalendar, cluster, rsPdvs[0].codicePos, selYear, selMonth, rsWorkday);
            } else if (pista === "partnership") {
              const pCfg = getPartnershipConfigForPdv(rsPdvs[0].codicePos, rs);
              const prConfig: PartnershipRewardPosConfig | undefined = pCfg ? { posCode: pCfg.posCode, config: pCfg.config } : undefined;
              rsCalc = calcPartnershipPerPdv(aggregatedRSItems, prConfig, rsWorkday.elapsedWorkingDays, rsPdvs[0].codicePos);
            }

            totalPremio += rsCalc.premioStimato;
            totalPunti += rsCalc.puntiTotali;
            if (rsCalc.sogliaRaggiunta > bestSoglia) bestSoglia = rsCalc.sogliaRaggiunta;

            for (const pdv of rsPdvs) {
              pdv.pdvCalc = rsCalc;
            }

            const projectedRSItems = aggregatedRSItems.map(item => {
              const ratio = rsWorkday.elapsedWorkingDays > 0
                ? rsWorkday.totalWorkingDays / rsWorkday.elapsedWorkingDays
                : 1;
              return { ...item, pezzi: Math.round(item.pezzi * ratio), canone: item.canone * ratio };
            });

            let rsProjCalc = EMPTY_CALC;
            if (pista === "mobile") {
              const mConfig = getMobileConfigForPdv(rsPdvs[0].codicePos, rs);
              rsProjCalc = calcMobilePerPdv(projectedRSItems, mConfig, rsCalendar, selYear, selMonth, mobileCategories, rsWorkday);
            } else if (pista === "fisso") {
              const fConfig = getFissoConfigForPdv(rsPdvs[0].codicePos, rs);
              const cluster = clusterToNumber(firstPdvConfig?.clusterFisso);
              rsProjCalc = calcFissoPerPdv(projectedRSItems, fConfig, rsCalendar, cluster, rsPdvs[0].codicePos, selYear, selMonth, rsWorkday);
            } else if (pista === "partnership") {
              const pCfg = getPartnershipConfigForPdv(rsPdvs[0].codicePos, rs);
              const prConfig: PartnershipRewardPosConfig | undefined = pCfg ? { posCode: pCfg.posCode, config: pCfg.config } : undefined;
              rsProjCalc = calcPartnershipPerPdv(projectedRSItems, prConfig, rsWorkday.totalWorkingDays, rsPdvs[0].codicePos);
            }
            totalPremioProj += rsProjCalc.premioStimato;
            totalPuntiProj += rsProjCalc.puntiTotali;
            if (rsProjCalc.sogliaRaggiunta > bestSogliaProj) bestSogliaProj = rsProjCalc.sogliaRaggiunta;
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
            const premioVal = energiaConfig.premio ?? 1000;
            if (totalPunti >= energiaConfig.targetS3) { aggSoglia = 3; totalPremio = premioVal; }
            else if (totalPunti >= energiaConfig.targetS2) { aggSoglia = 2; totalPremio = premioVal; }
            else if (totalPunti >= energiaConfig.targetS1) { aggSoglia = 1; totalPremio = premioVal; }
            bestSoglia = aggSoglia;
          }
          if (pista === "assicurazioni" && assicConfig) {
            let aggSoglia = 0;
            const premioVal = assicConfig.premio ?? 750;
            if (totalPunti >= assicConfig.targetS2) { aggSoglia = 2; totalPremio = premioVal; }
            else if (totalPunti >= assicConfig.targetS1) { aggSoglia = 1; totalPremio = premioVal; }
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
            const projectedItems: AggregatedItem[] = pdv.categories.map((c) => {
              const ratio = pdvWd.elapsedWorkingDays > 0
                ? pdvWd.totalWorkingDays / pdvWd.elapsedWorkingDays
                : 1;
              return { pista, targetCategory: c.category, targetLabel: c.label, pezzi: Math.round(c.pezzi * ratio), canone: (c.canone || 0) * ratio };
            });
            return { ...pdv, items: projectedItems };
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
              projCalc = calcMobilePerPdv(pdv.items, mConfig, pdvCalendar3, selYear, selMonth, mobileCategories, pdvWorkday3);
            } else if (pista === "fisso") {
              const fConfig = getFissoConfigForPdv(pdv.codicePos, projRS);
              const cluster = clusterToNumber(pdvConfig3?.clusterFisso);
              projCalc = calcFissoPerPdv(pdv.items, fConfig, pdvCalendar3, cluster, pdv.codicePos, selYear, selMonth, pdvWorkday3);
            } else if (pista === "energia") {
              const isInGara = energiaPdvInGara.some((e) => (e.codicePos === pdv.codicePos || e.pdvId === pdv.codicePos) && e.isInGara);
              projCalc = calcEnergiaPerPdv(pdv.items, energiaConfig, pdv.codicePos, isInGara, numPdvInGaraEnergia);
            } else if (pista === "partnership") {
              const pCfg = getPartnershipConfigForPdv(pdv.codicePos, projRS);
              const prConfig: PartnershipRewardPosConfig | undefined = pCfg ? { posCode: pCfg.posCode, config: pCfg.config } : undefined;
              projCalc = calcPartnershipPerPdv(pdv.items, prConfig, pdvWorkday3.totalWorkingDays, pdv.codicePos);
            } else if (pista === "assicurazioni" || pista === "protecta") {
              projCalc = pdv.pdvCalc;
            }
            totalPremioProj += projCalc.premioStimato;
            totalPuntiProj += projCalc.puntiTotali;
            if (projCalc.sogliaRaggiunta > bestSogliaProj) bestSogliaProj = projCalc.sogliaRaggiunta;
          }

          if (pista === "energia" && energiaConfig) {
            let aggSogliaProj = 0;
            const premioVal = energiaConfig.premio ?? 1000;
            totalPremioProj = 0;
            if (totalPuntiProj >= energiaConfig.targetS3) { aggSogliaProj = 3; totalPremioProj = premioVal; }
            else if (totalPuntiProj >= energiaConfig.targetS2) { aggSogliaProj = 2; totalPremioProj = premioVal; }
            else if (totalPuntiProj >= energiaConfig.targetS1) { aggSogliaProj = 1; totalPremioProj = premioVal; }
            bestSogliaProj = aggSogliaProj;
          }
          if (pista === "assicurazioni" && assicConfig) {
            let aggSogliaProj = 0;
            const premioVal = assicConfig.premio ?? 750;
            totalPremioProj = 0;
            if (totalPuntiProj >= assicConfig.targetS2) { aggSogliaProj = 2; totalPremioProj = premioVal; }
            else if (totalPuntiProj >= assicConfig.targetS1) { aggSogliaProj = 1; totalPremioProj = premioVal; }
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

      stats.push({
        pista,
        label: PISTA_CONFIG[pista].label,
        totalePezzi,
        proiezionePezzi,
        calc: aggregateCalc,
        calcProiezione: aggregateCalcProiezione,
        categories,
        pdvBreakdown,
      });
    }

    return stats;
  }, [mappedData, workdayInfo, garaCalcConfig, puntiVenditaFromGara, garaConfigMissing, selMonth, selYear]);

  const isLoading = loadingMapped || loadingConfig;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900" data-testid="dashboard-gara-reale">
      <AppNavbar title="Incentive W3">
        <Select value={selectedPeriod} onValueChange={setSelectedPeriod} data-testid="select-period">
          <SelectTrigger className="w-[200px]" data-testid="select-period-trigger">
            <Calendar className="h-4 w-4 mr-2" />
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
      </AppNavbar>
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">

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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card data-testid="card-total-sales">
                <CardContent className="py-4">
                  <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
                    <BarChart3 className="h-4 w-4" />
                    Vendite Totali
                  </div>
                  <div className="text-2xl font-bold" data-testid="text-total-sales">{mappedData.totalSales}</div>
                </CardContent>
              </Card>
              <Card data-testid="card-total-articoli">
                <CardContent className="py-4">
                  <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
                    <Target className="h-4 w-4" />
                    Articoli Totali
                  </div>
                  <div className="text-2xl font-bold" data-testid="text-total-articoli">{mappedData.totalArticoli}</div>
                </CardContent>
              </Card>
              <Card data-testid="card-mapped">
                <CardContent className="py-4">
                  <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
                    <Award className="h-4 w-4" />
                    Mappati
                  </div>
                  <div className="text-2xl font-bold text-green-600" data-testid="text-mapped">{mappedData.totalMapped}</div>
                  <div className="text-xs text-gray-400">
                    {mappedData.totalArticoli > 0 ? `${Math.round((mappedData.totalMapped / mappedData.totalArticoli) * 100)}%` : "0%"}
                  </div>
                </CardContent>
              </Card>
              <Card data-testid="card-unmapped">
                <CardContent className="py-4">
                  <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
                    <AlertTriangle className="h-4 w-4" />
                    Non Mappati
                  </div>
                  <div className="text-2xl font-bold text-amber-600" data-testid="text-unmapped">{mappedData.totalUnmapped}</div>
                  <div className="text-xs text-gray-400">
                    {mappedData.totalArticoli > 0 ? `${Math.round((mappedData.totalUnmapped / mappedData.totalArticoli) * 100)}%` : "0%"}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card data-testid="card-workday-info">
              <CardContent className="py-3">
                <div className="flex items-center gap-6 text-sm flex-wrap">
                  <span className="flex items-center gap-1.5">
                    <Calendar className="h-4 w-4 text-gray-400" />
                    <span className="text-gray-500">Giorni lavorativi:</span>
                    <span className="font-medium" data-testid="text-elapsed-days">{workdayInfo.elapsedWorkingDays}</span>
                    <span className="text-gray-400">/ {workdayInfo.totalWorkingDays}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-gray-500">Rimanenti:</span>
                    <span className="font-medium" data-testid="text-remaining-days">{workdayInfo.remainingWorkingDays}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-gray-500">Avanzamento:</span>
                    <Progress
                      value={workdayInfo.totalWorkingDays > 0 ? (workdayInfo.elapsedWorkingDays / workdayInfo.totalWorkingDays) * 100 : 0}
                      className="w-24 h-2"
                    />
                    <span className="font-medium" data-testid="text-progress-pct">
                      {workdayInfo.totalWorkingDays > 0 ? Math.round((workdayInfo.elapsedWorkingDays / workdayInfo.totalWorkingDays) * 100) : 0}%
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Store className="h-4 w-4 text-gray-400" />
                    <span className="text-gray-500">PDV attivi:</span>
                    <span className="font-medium" data-testid="text-pdv-count">{mappedData.pdvList.length}</span>
                  </span>
                </div>
              </CardContent>
            </Card>

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
                      <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-bold" data-testid={`text-pezzi-${pista.pista}`}>{pista.totalePezzi}</span>
                        <span className="text-sm text-gray-500">pezzi attuali</span>
                      </div>

                      {pista.totalePezzi > 0 && pista.calc.sogliaLabel !== "N/A" && (
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-lg border p-2 text-center">
                            <div className="text-xs text-gray-500 mb-0.5">Soglia Attuale</div>
                            <Badge className={`text-xs ${getSogliaColor(pista.calc.sogliaLabel)}`} variant="outline" data-testid={`badge-soglia-${pista.pista}`}>
                              {pista.calc.sogliaLabel}
                            </Badge>
                            {pista.calc.puntiTotali > 0 && (
                              <div className="text-xs text-gray-400 mt-0.5">{pista.calc.puntiTotali.toFixed(1)} pt</div>
                            )}
                          </div>
                          <div className="rounded-lg border p-2 text-center">
                            <div className="text-xs text-gray-500 mb-0.5">Proiezione Soglia</div>
                            <Badge className={`text-xs ${getSogliaColor(pista.calcProiezione.sogliaLabel)}`} variant="outline" data-testid={`badge-soglia-proiezione-${pista.pista}`}>
                              {pista.calcProiezione.sogliaLabel}
                            </Badge>
                            {pista.calcProiezione.puntiTotali > 0 && (
                              <div className="text-xs text-gray-400 mt-0.5">{pista.calcProiezione.puntiTotali.toFixed(1)} pt</div>
                            )}
                          </div>
                        </div>
                      )}

                      {pista.totalePezzi > 0 && pista.calc.forecastTarget != null && pista.calc.forecastTarget > 0 && (
                        <div className="rounded-lg border p-2 space-y-1" data-testid={`objective-gap-${pista.pista}`}>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-gray-500 flex items-center gap-1"><Target className="h-3 w-3" /> Obiettivo</span>
                            <span className="font-medium">{pista.calc.forecastTarget.toFixed(0)} pt</span>
                          </div>
                          <Progress
                            value={Math.min((pista.calc.puntiTotali / pista.calc.forecastTarget) * 100, 100)}
                            className="h-1.5"
                          />
                          <div className="flex items-center justify-between text-xs">
                            <span className={`font-medium ${(pista.calc.forecastGap ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                              {(pista.calc.forecastGap ?? 0) >= 0 ? "+" : ""}{(pista.calc.forecastGap ?? 0).toFixed(1)} pt
                            </span>
                            <span className="text-gray-400">{Math.round((pista.calc.puntiTotali / pista.calc.forecastTarget) * 100)}%</span>
                          </div>
                        </div>
                      )}

                      {pista.totalePezzi > 0 && pista.calc.premioStimato > 0 && (
                        <div className="flex items-center justify-between text-sm bg-green-50 dark:bg-green-900/20 rounded-lg px-3 py-2">
                          <span className="text-gray-600 dark:text-gray-300">Premio stimato</span>
                          <span className="font-bold text-green-700 dark:text-green-400" data-testid={`text-premio-${pista.pista}`}>
                            {formatEuro(pista.calc.premioStimato)}
                          </span>
                        </div>
                      )}

                      {pista.totalePezzi === 0 ? (
                        <p className="text-sm text-gray-400 italic">Nessuna attivazione mappata</p>
                      ) : (
                        <>
                          <Separator />
                          <div className="space-y-1.5">
                            {pista.categories.slice(0, 6).map((cat) => (
                              <div key={cat.category} className="flex items-center justify-between text-sm">
                                <span className="text-gray-600 dark:text-gray-300 truncate max-w-[60%]">{cat.label}</span>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{cat.pezzi}</span>
                                  <span className="text-gray-400 text-xs">→ {cat.proiezione}</span>
                                </div>
                              </div>
                            ))}
                            {pista.categories.length > 6 && (
                              <p className="text-xs text-gray-400">+{pista.categories.length - 6} altre categorie</p>
                            )}
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <Card data-testid="card-pdv-breakdown">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Store className="h-5 w-5" />
                  Dettaglio per PDV
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Accordion type="multiple" className="space-y-2">
                  {mappedData.pdvList
                    .sort((a, b) => {
                      const aPezzi = a.items.reduce((s, i) => s + i.pezzi, 0);
                      const bPezzi = b.items.reduce((s, i) => s + i.pezzi, 0);
                      return bPezzi - aPezzi;
                    })
                    .map((pdv) => {
                      const totalPezzi = pdv.items.reduce((s, i) => s + i.pezzi, 0);
                      const proiezione = workdayInfo.elapsedWorkingDays > 0
                        ? Math.round((totalPezzi / workdayInfo.elapsedWorkingDays) * workdayInfo.totalWorkingDays)
                        : totalPezzi;

                      const byPista: Record<string, { pezzi: number; items: AggregatedItem[] }> = {};
                      for (const item of pdv.items) {
                        if (!byPista[item.pista]) byPista[item.pista] = { pezzi: 0, items: [] };
                        byPista[item.pista].pezzi += item.pezzi;
                        byPista[item.pista].items.push(item);
                      }

                      const pdvCalcByPista: Record<string, PistaCalcResult> = {};
                      for (const stat of pistaStats) {
                        const match = stat.pdvBreakdown.find((b) => b.codicePos === pdv.codicePos);
                        if (match) pdvCalcByPista[stat.pista] = match.pdvCalc;
                      }

                      const totalPremio = Object.values(pdvCalcByPista).reduce((s, c) => s + c.premioStimato, 0);

                      return (
                        <AccordionItem key={pdv.codicePos} value={pdv.codicePos} className="border rounded-lg px-4" data-testid={`pdv-accordion-${pdv.codicePos}`}>
                          <AccordionTrigger className="hover:no-underline py-3">
                            <div className="flex items-center justify-between w-full pr-4">
                              <div className="flex items-center gap-3">
                                <Store className="h-4 w-4 text-gray-400" />
                                <div className="text-left">
                                  <div className="font-medium text-sm">{pdv.nomeNegozio}</div>
                                  <div className="text-xs text-gray-500">{pdv.codicePos} · {pdv.ragioneSociale}</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-4 text-sm">
                                {totalPremio > 0 && (
                                  <Badge variant="outline" className="text-green-700 border-green-300 text-xs" data-testid={`badge-pdv-premio-${pdv.codicePos}`}>
                                    {formatEuro(totalPremio)}
                                  </Badge>
                                )}
                                <div className="text-right">
                                  <div className="font-bold">{totalPezzi} pezzi</div>
                                  <div className="text-xs text-gray-400">Proiezione: {proiezione}</div>
                                </div>
                                {pdv.unmapped > 0 && (
                                  <Badge variant="outline" className="text-amber-600 border-amber-300 text-xs">
                                    {pdv.unmapped} non mappati
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pb-3">
                              {Object.entries(byPista).sort(([, a], [, b]) => b.pezzi - a.pezzi).map(([pistaKey, pistaData]) => {
                                const conf = PISTA_CONFIG[pistaKey as keyof typeof PISTA_CONFIG];
                                if (!conf) return null;
                                const calc = pdvCalcByPista[pistaKey];
                                return (
                                  <div key={pistaKey} className={`rounded-lg border p-3 ${conf.lightColor}`}>
                                    <div className="font-medium text-sm mb-2 flex items-center justify-between">
                                      <span>{conf.label}</span>
                                      <span className="font-bold">{pistaData.pezzi}</span>
                                    </div>
                                    {calc && calc.sogliaLabel !== "N/A" && (
                                      <div className="flex items-center gap-2 mb-2">
                                        <Badge className={`text-[10px] ${getSogliaColor(calc.sogliaLabel)}`} variant="outline">
                                          {calc.sogliaLabel}
                                        </Badge>
                                        {calc.puntiTotali > 0 && (
                                          <span className="text-[10px] text-gray-500">{calc.puntiTotali.toFixed(1)} pt</span>
                                        )}
                                        {calc.premioStimato > 0 && (
                                          <span className="text-[10px] font-medium text-green-700">{formatEuro(calc.premioStimato)}</span>
                                        )}
                                      </div>
                                    )}
                                    <div className="space-y-1">
                                      {pistaData.items.sort((a, b) => b.pezzi - a.pezzi).map((item) => (
                                        <div key={item.targetCategory} className="flex justify-between text-xs">
                                          <span className="truncate max-w-[70%]">{item.targetLabel}</span>
                                          <span className="font-medium">{item.pezzi}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                </Accordion>
              </CardContent>
            </Card>

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

function RsBreakdown({ pdvList, workdayInfo, pistaStats }: { pdvList: PdvData[]; workdayInfo: WorkdayInfo; pistaStats: Array<{ pista: string; pdvBreakdown: Array<{ codicePos: string; pdvCalc: PistaCalcResult }> }> }) {
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

        let rsPremioTotale = 0;
        for (const pdv of rs.pdvs) {
          for (const stat of pistaStats) {
            const match = stat.pdvBreakdown.find((b) => b.codicePos === pdv.codicePos);
            if (match) rsPremioTotale += match.pdvCalc.premioStimato;
          }
        }

        return (
          <AccordionItem key={rs.ragioneSociale} value={rs.ragioneSociale} className="border rounded-lg px-4" data-testid={`rs-accordion-${rs.ragioneSociale}`}>
            <AccordionTrigger className="hover:no-underline py-3">
              <div className="flex items-center justify-between w-full pr-4">
                <div className="text-left">
                  <div className="font-medium text-sm">{rs.ragioneSociale}</div>
                  <div className="text-xs text-gray-500">{rs.pdvs.length} PDV</div>
                </div>
                <div className="flex items-center gap-3">
                  {rsPremioTotale > 0 && (
                    <Badge variant="outline" className="text-green-700 border-green-300 text-xs">
                      {formatEuro(rsPremioTotale)}
                    </Badge>
                  )}
                  <div className="text-right">
                    <div className="font-bold text-sm">{rs.totalPezzi} pezzi</div>
                    <div className="text-xs text-gray-400">Proiezione: {proiezione}</div>
                  </div>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 pb-3">
                <div className="flex flex-wrap gap-2">
                  {Object.entries(byPista).sort(([, a], [, b]) => b - a).map(([pistaKey, pezzi]) => {
                    const conf = PISTA_CONFIG[pistaKey as keyof typeof PISTA_CONFIG];
                    if (!conf) return null;
                    return (
                      <Badge key={pistaKey} variant="outline" className={conf.lightColor}>
                        {conf.label}: {pezzi}
                      </Badge>
                    );
                  })}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {rs.pdvs.map((pdv) => {
                    const pdvPezzi = pdv.items.reduce((s, i) => s + i.pezzi, 0);
                    let pdvPremio = 0;
                    const pdvSoglie: string[] = [];
                    for (const stat of pistaStats) {
                      const match = stat.pdvBreakdown.find((b) => b.codicePos === pdv.codicePos);
                      if (match) {
                        pdvPremio += match.pdvCalc.premioStimato;
                        if (match.pdvCalc.sogliaLabel !== "N/A" && match.pdvCalc.sogliaLabel !== "Nessuna") {
                          pdvSoglie.push(`${PISTA_CONFIG[stat.pista as keyof typeof PISTA_CONFIG]?.label || stat.pista}: ${match.pdvCalc.sogliaLabel}`);
                        }
                      }
                    }
                    return (
                      <div key={pdv.codicePos} className="border rounded p-2 text-sm">
                        <div className="flex justify-between">
                          <span className="font-medium">{pdv.nomeNegozio}</span>
                          <div className="flex items-center gap-2">
                            {pdvPremio > 0 && (
                              <span className="text-xs font-medium text-green-700">{formatEuro(pdvPremio)}</span>
                            )}
                            <span className="font-bold">{pdvPezzi}</span>
                          </div>
                        </div>
                        <div className="text-xs text-gray-400">{pdv.codicePos}</div>
                        {pdvSoglie.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {pdvSoglie.map((s) => (
                              <Badge key={s} variant="outline" className="text-[10px] py-0">{s}</Badge>
                            ))}
                          </div>
                        )}
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
