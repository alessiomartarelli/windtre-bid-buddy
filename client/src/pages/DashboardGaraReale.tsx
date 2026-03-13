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
import { getWorkdayInfoForMonth, type WorkdayInfo } from "@/lib/calcoloPistaFisso";
import type { StoreCalendar } from "@/types/preventivatore";

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

interface OrgConfigResponse {
  config: {
    puntiVendita?: Array<{
      id: string;
      codicePos: string;
      nome: string;
      ragioneSociale: string;
      calendar: StoreCalendar;
      clusterMobile?: string;
      clusterFisso?: string;
      abilitaEnergia?: boolean;
      abilitaAssicurazioni?: boolean;
    }>;
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
  weeklySchedule: { workingDays: [1, 2, 3, 4, 5, 6] as any },
  specialDays: [],
};

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

    const stats: Array<{
      pista: string;
      label: string;
      totalePezzi: number;
      proiezionePezzi: number;
      categories: Array<{ category: string; label: string; pezzi: number; proiezione: number }>;
      pdvBreakdown: Array<{
        codicePos: string;
        nomeNegozio: string;
        ragioneSociale: string;
        pezzi: number;
        proiezione: number;
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

      const pdvBreakdown = mappedData.pdvList
        .map((pdv) => {
          const pdvItems = pdv.items.filter((i) => i.pista === pista);
          const pdvPezzi = pdvItems.reduce((s, i) => s + i.pezzi, 0);
          const pdvProiezione = workdayInfo.elapsedWorkingDays > 0
            ? Math.round((pdvPezzi / workdayInfo.elapsedWorkingDays) * workdayInfo.totalWorkingDays)
            : pdvPezzi;
          return {
            codicePos: pdv.codicePos,
            nomeNegozio: pdv.nomeNegozio,
            ragioneSociale: pdv.ragioneSociale,
            pezzi: pdvPezzi,
            proiezione: pdvProiezione,
            categories: pdvItems.map((i) => ({ category: i.targetCategory, label: i.targetLabel, pezzi: i.pezzi })),
          };
        })
        .filter((p) => p.pezzi > 0)
        .sort((a, b) => b.pezzi - a.pezzi);

      stats.push({
        pista,
        label: PISTA_CONFIG[pista].label,
        totalePezzi,
        proiezionePezzi,
        categories,
        pdvBreakdown,
      });
    }

    return stats;
  }, [mappedData, workdayInfo]);

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
