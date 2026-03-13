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
  ArrowLeft,
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
} from "lucide-react";
import { apiUrl } from "@/lib/basePath";
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
  type StoreCalendar,
  type Weekday,
  MOBILE_CATEGORIES_CONFIG_DEFAULT,
  type MobileCategoryConfig,
  type PistaMobilePosConfig,
  type AttivatoMobileDettaglio,
  MobileActivationType,
} from "@/types/preventivatore";
import {
  type EnergiaCategory,
  type EnergiaConfig,
  type EnergiaAttivatoRiga,
  type EnergiaPdvInGara,
  ENERGIA_BASE_PAY,
} from "@/types/energia";

interface AggregatedItem {
  pista: string;
  targetCategory: string;
  targetLabel: string;
  pezzi: number;
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

  const result = calcolaPremioPistaMobilePerPos({
    configPos: mobileConfig,
    dettaglio,
    calendar,
    year,
    month: month - 1,
    mobileCategories,
    workdayInfoOverride: workdayInfo,
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

  const { data: orgConfig, isLoading: loadingConfig } = useQuery<OrgConfigResponse>({
    queryKey: ["/api/organization-config"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/organization-config"), { credentials: "include" });
      if (!res.ok) throw new Error("Errore config");
      return res.json();
    },
  });

  const workdayInfo = useMemo<WorkdayInfo>(() => {
    const calendar = orgConfig?.config?.puntiVendita?.[0]?.calendar || DEFAULT_CALENDAR;
    return getWorkdayInfoForMonth(selYear, selMonth - 1, calendar, new Date());
  }, [orgConfig, selMonth, selYear]);

  const pistaStats = useMemo(() => {
    if (!mappedData) return [];

    const cfg = orgConfig?.config;
    const puntiVendita = cfg?.puntiVendita || [];
    const mobileConfigs = cfg?.pistaMobileConfig?.sogliePerPos || [];
    const fissoConfigs = cfg?.pistaFissoConfig?.sogliePerPos || [];
    const energiaConfig = cfg?.energiaConfig;
    const energiaPdvInGara = cfg?.energiaPdvInGara || [];
    const mobileCategories = cfg?.mobileCategories || MOBILE_CATEGORIES_CONFIG_DEFAULT;
    const numPdvInGaraEnergia = energiaPdvInGara.filter((e) => e.isInGara).length || puntiVendita.length || 1;

    const stats: Array<{
      pista: string;
      label: string;
      totalePezzi: number;
      proiezionePezzi: number;
      calc: PistaCalcResult;
      calcProiezione: PistaCalcResult;
      categories: Array<{ category: string; label: string; pezzi: number; proiezione: number }>;
      pdvBreakdown: Array<{
        codicePos: string;
        nomeNegozio: string;
        ragioneSociale: string;
        pezzi: number;
        proiezione: number;
        pdvCalc: PistaCalcResult;
        categories: Array<{ category: string; label: string; pezzi: number }>;
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

      const categories = Object.values(pistaData).map((cat) => {
        const proiezione = workdayInfo.elapsedWorkingDays > 0
          ? Math.round((cat.pezzi / workdayInfo.elapsedWorkingDays) * workdayInfo.totalWorkingDays)
          : cat.pezzi;
        return {
          category: cat.targetCategory,
          label: cat.targetLabel,
          pezzi: cat.pezzi,
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
          if (pista === "mobile") {
            const mConfig = mobileConfigs.find((c) => c.posCode === pdv.codicePos) || mobileConfigs[0];
            pdvCalc = calcMobilePerPdv(pdvItems, mConfig, pdvCalendar, selYear, selMonth, mobileCategories, pdvWorkday);
          } else if (pista === "fisso") {
            const fConfig = fissoConfigs.find((c) => c.posCode === pdv.codicePos) || fissoConfigs[0];
            const cluster = clusterToNumber(pdvConfig?.clusterFisso);
            pdvCalc = calcFissoPerPdv(pdvItems, fConfig, pdvCalendar, cluster, pdv.codicePos, selYear, selMonth, pdvWorkday);
          } else if (pista === "energia") {
            const isInGara = energiaPdvInGara.some((e) => (e.codicePos === pdv.codicePos || e.pdvId === pdv.codicePos) && e.isInGara);
            pdvCalc = calcEnergiaPerPdv(pdvItems, energiaConfig, pdv.codicePos, isInGara, numPdvInGaraEnergia);
          }

          return {
            codicePos: pdv.codicePos,
            nomeNegozio: pdv.nomeNegozio,
            ragioneSociale: pdv.ragioneSociale,
            pezzi: pdvPezzi,
            proiezione: pdvProiezione,
            pdvCalc,
            categories: pdvItems.map((i) => ({ category: i.targetCategory, label: i.targetLabel, pezzi: i.pezzi })),
          };
        })
        .filter((p) => p.pezzi > 0)
        .sort((a, b) => b.pezzi - a.pezzi);

      if (pdvBreakdown.length > 0 && (pista === "mobile" || pista === "fisso" || pista === "energia")) {
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
        aggregateCalc = {
          premioStimato: totalPremio,
          puntiTotali: totalPunti,
          sogliaRaggiunta: bestSoglia,
          sogliaLabel: sogliaToLabel(bestSoglia, pista === "fisso" ? 5 : pista === "mobile" ? 4 : 3),
          forecastTarget: hasTarget ? totalTarget : undefined,
          forecastGap: hasTarget ? totalGap : undefined,
        };

        const projItems = pdvBreakdown.map((pdv) => {
          const pdvConfig2 = puntiVendita.find((p) => p.codicePos === pdv.codicePos);
          const pdvCal = pdvConfig2?.calendar || DEFAULT_CALENDAR;
          const pdvWd = getWorkdayInfoForMonth(selYear, selMonth - 1, pdvCal, new Date());
          const projectedItems: AggregatedItem[] = pdv.categories.map((c) => {
            const projPezzi = pdvWd.elapsedWorkingDays > 0
              ? Math.round((c.pezzi / pdvWd.elapsedWorkingDays) * pdvWd.totalWorkingDays)
              : c.pezzi;
            return { pista, targetCategory: c.category, targetLabel: c.label, pezzi: projPezzi };
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
          if (pista === "mobile") {
            const mConfig = mobileConfigs.find((c) => c.posCode === pdv.codicePos) || mobileConfigs[0];
            projCalc = calcMobilePerPdv(pdv.items, mConfig, pdvCalendar3, selYear, selMonth, mobileCategories, pdvWorkday3);
          } else if (pista === "fisso") {
            const fConfig = fissoConfigs.find((c) => c.posCode === pdv.codicePos) || fissoConfigs[0];
            const cluster = clusterToNumber(pdvConfig3?.clusterFisso);
            projCalc = calcFissoPerPdv(pdv.items, fConfig, pdvCalendar3, cluster, pdv.codicePos, selYear, selMonth, pdvWorkday3);
          } else if (pista === "energia") {
            const isInGara = energiaPdvInGara.some((e) => (e.codicePos === pdv.codicePos || e.pdvId === pdv.codicePos) && e.isInGara);
            projCalc = calcEnergiaPerPdv(pdv.items, energiaConfig, pdv.codicePos, isInGara, numPdvInGaraEnergia);
          }
          totalPremioProj += projCalc.premioStimato;
          totalPuntiProj += projCalc.puntiTotali;
          if (projCalc.sogliaRaggiunta > bestSogliaProj) bestSogliaProj = projCalc.sogliaRaggiunta;
        }
        aggregateCalcProiezione = {
          premioStimato: totalPremioProj,
          puntiTotali: totalPuntiProj,
          sogliaRaggiunta: bestSogliaProj,
          sogliaLabel: sogliaToLabel(bestSogliaProj, pista === "fisso" ? 5 : pista === "mobile" ? 4 : 3),
        };
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
  }, [mappedData, workdayInfo, orgConfig, selMonth, selYear]);

  const isLoading = loadingMapped || loadingConfig;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900" data-testid="dashboard-gara-reale">
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/")} data-testid="button-back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100" data-testid="text-page-title">Dashboard Gara Reale</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">Vendite reali da BiSuite con proiezione a fine mese</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
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
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20" data-testid="loading-state">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            <span className="ml-3 text-gray-500">Caricamento dati...</span>
          </div>
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

                      {pista.totalePezzi > 0 && (pista.pista === "mobile" || pista.pista === "fisso" || pista.pista === "energia") && (
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
                                return (
                                  <div key={pistaKey} className={`rounded-lg border p-3 ${conf.lightColor}`}>
                                    <div className="font-medium text-sm mb-2 flex items-center justify-between">
                                      <span>{conf.label}</span>
                                      <span className="font-bold">{pistaData.pezzi}</span>
                                    </div>
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
                <RsBreakdown pdvList={mappedData.pdvList} workdayInfo={workdayInfo} />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function RsBreakdown({ pdvList, workdayInfo }: { pdvList: PdvData[]; workdayInfo: WorkdayInfo }) {
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

        return (
          <AccordionItem key={rs.ragioneSociale} value={rs.ragioneSociale} className="border rounded-lg px-4" data-testid={`rs-accordion-${rs.ragioneSociale}`}>
            <AccordionTrigger className="hover:no-underline py-3">
              <div className="flex items-center justify-between w-full pr-4">
                <div className="text-left">
                  <div className="font-medium text-sm">{rs.ragioneSociale}</div>
                  <div className="text-xs text-gray-500">{rs.pdvs.length} PDV</div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-sm">{rs.totalPezzi} pezzi</div>
                  <div className="text-xs text-gray-400">Proiezione: {proiezione}</div>
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
                    return (
                      <div key={pdv.codicePos} className="border rounded p-2 text-sm">
                        <div className="flex justify-between">
                          <span className="font-medium">{pdv.nomeNegozio}</span>
                          <span className="font-bold">{pdvPezzi}</span>
                        </div>
                        <div className="text-xs text-gray-400">{pdv.codicePos}</div>
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
