import { useEffect, useMemo, useState, type ComponentType } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LineChart, BarChart3, Wallet, Target, TrendingUp, Briefcase, Users, FileText, Settings, Star, Filter } from "lucide-react";
import { useFinplanData, useFinplanMutation } from "@/hooks/useFinplan";
import { Overview } from "./sections/Overview";
import { CostiIncassi } from "./sections/CostiIncassi";

interface FinplanAppProps {
  orgId: string;
}

// Etichette di default allineate al tool standalone
// (`client/public/finplan/index.html` ~riga 846).
const DEFAULT_COMPANY_NAMES = ["EASY DIGITAL GROUP", "CMS", "CMS EVO", "PHONE & PHONE", "SCT"];
const COMPANY_COLORS = ["#00D4AA", "#3B82F6", "#8B5CF6", "#F59E0B", "#EF4444"];
const CONSOLIDATO_INDEX = 5;
const CONSOLIDATO_COLOR = "#F59E0B";

type SectionKey =
  | "overview"
  | "costifissi"
  | "transazioni"
  | "mensile"
  | "iva"
  | "obiettivi"
  | "debiti"
  | "personale"
  | "partitari"
  | "scenari";

const SECTIONS: { key: SectionKey; label: string; icon: ComponentType<{ className?: string }>; active: boolean }[] = [
  { key: "overview",    label: "Overview",        icon: LineChart, active: true  },
  { key: "costifissi",  label: "Costi & Incassi", icon: Filter,    active: true  },
  { key: "transazioni", label: "Transazioni",     icon: BarChart3, active: false },
  { key: "mensile",     label: "Mensile",         icon: BarChart3, active: false },
  { key: "iva",         label: "IVA",             icon: FileText,  active: false },
  { key: "obiettivi",   label: "Obiettivi",       icon: Target,    active: false },
  { key: "debiti",      label: "Debiti",          icon: Wallet,    active: false },
  { key: "personale",   label: "Personale",       icon: Users,     active: false },
  { key: "partitari",   label: "Partitari",       icon: FileText,  active: false },
  { key: "scenari",     label: "Scenari",         icon: TrendingUp, active: false },
];

function persistKey(orgId: string) {
  return `finplan_react_active__org_${orgId}`;
}

interface PersistedState { co: number; sec: SectionKey }

function loadPersisted(orgId: string): PersistedState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(persistKey(orgId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.co === "number" &&
      parsed.co >= 0 && parsed.co <= CONSOLIDATO_INDEX &&
      typeof parsed?.sec === "string" &&
      SECTIONS.some(s => s.key === parsed.sec)
    ) {
      return { co: parsed.co, sec: parsed.sec as SectionKey };
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Shell React di FinPlan Studio (work in progress — Task #142/#143+).
 *
 * Sostituirà l'iframe legacy (`client/public/finplan/index.html`).
 * Per ora gated dietro `?finplanReact=1` su Amministrazione → Analisi.
 * - Task #142: shell + tabs placeholder.
 * - Task #143: CompanyNav (5 RS + Consolidato), Overview con KPI/donut/line,
 *   sezione Costi & Incassi (cfExclude). Sezioni rimanenti: #144-#147.
 */
export default function FinplanApp({ orgId }: FinplanAppProps) {
  const persisted = useMemo(() => loadPersisted(orgId), [orgId]);
  const [activeCo, setActiveCo] = useState<number>(persisted?.co ?? 0);
  const [activeSec, setActiveSec] = useState<SectionKey>(persisted?.sec ?? "overview");

  const { snapshot, parsed, updatedAt, isLoading, isError } = useFinplanData(orgId);
  const { scheduleSave, isSaving } = useFinplanMutation(orgId);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(persistKey(orgId), JSON.stringify({ co: activeCo, sec: activeSec }));
    } catch { /* ignore */ }
  }, [orgId, activeCo, activeSec]);

  const companies = parsed?.data ?? snapshot?.data ?? [];
  const companyName = (i: number) =>
    (companies[i]?.name && String(companies[i]!.name)) || DEFAULT_COMPANY_NAMES[i] || `Società ${i + 1}`;

  const isConsolidato = activeCo === CONSOLIDATO_INDEX;
  const currentCompany = isConsolidato ? undefined : companies[activeCo];
  const currentColor = isConsolidato ? CONSOLIDATO_COLOR : (COMPANY_COLORS[activeCo] ?? "#00D4AA");

  return (
    <div className="space-y-3" data-testid="finplan-react-app">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3 gap-2 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <CardTitle className="text-lg">FinPlan Studio</CardTitle>
            <Badge variant="outline" data-testid="badge-finplan-react">React (preview)</Badge>
            {isLoading ? (
              <Badge variant="secondary">Caricamento…</Badge>
            ) : isError ? (
              <Badge variant="destructive">Errore di rete</Badge>
            ) : isSaving ? (
              <Badge variant="secondary" data-testid="badge-finplan-saving">Salvataggio…</Badge>
            ) : updatedAt ? (
              <span className="text-xs text-muted-foreground" data-testid="text-finplan-updated-at">
                Ultimo salvataggio: {new Date(updatedAt).toLocaleString("it-IT")}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">Nessun salvataggio</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Settings className="h-4 w-4" />
            <span data-testid="text-finplan-companies-count">{companies.length} ragioni sociali</span>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {/* COMPANY NAV: 5 RS + Consolidato */}
          <div className="border-b overflow-x-auto">
            <div className="flex gap-1 min-w-max">
              {DEFAULT_COMPANY_NAMES.map((_, i) => {
                const active = activeCo === i;
                return (
                  <Button
                    key={i}
                    variant="ghost"
                    size="sm"
                    onClick={() => setActiveCo(i)}
                    className={`rounded-none border-b-2 text-xs font-bold tracking-wide uppercase ${
                      active ? "border-primary text-foreground" : "border-transparent text-muted-foreground"
                    }`}
                    style={active ? { borderBottomColor: COMPANY_COLORS[i] } : undefined}
                    data-testid={`tab-co-${i}`}
                  >
                    {companyName(i)}
                  </Button>
                );
              })}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActiveCo(CONSOLIDATO_INDEX)}
                className={`rounded-none border-b-2 text-xs font-bold tracking-wide uppercase ${
                  isConsolidato ? "border-primary" : "border-transparent text-muted-foreground"
                }`}
                style={isConsolidato ? { borderBottomColor: CONSOLIDATO_COLOR, color: CONSOLIDATO_COLOR } : { color: CONSOLIDATO_COLOR }}
                data-testid={`tab-co-${CONSOLIDATO_INDEX}`}
              >
                <Star className="h-3 w-3 mr-1" />
                Consolidato
              </Button>
            </div>
          </div>

          {isConsolidato ? (
            <ConsolidatoPlaceholder loading={isLoading} />
          ) : (
            <Tabs value={activeSec} onValueChange={(v) => setActiveSec(v as SectionKey)}>
              <TabsList className="flex flex-wrap h-auto justify-start gap-1">
                {SECTIONS.map(({ key, label, icon: Icon, active }) => (
                  <TabsTrigger
                    key={key}
                    value={key}
                    data-testid={`tab-finplan-${key}`}
                    className="text-xs"
                  >
                    <Icon className="h-3.5 w-3.5 mr-1.5" />
                    {label}
                    {!active && <span className="ml-1 text-[9px] text-muted-foreground">(soon)</span>}
                  </TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value="overview" className="mt-4">
                {isLoading ? (
                  <SectionLoading />
                ) : (
                  <Overview company={currentCompany} companyColor={currentColor} />
                )}
              </TabsContent>

              <TabsContent value="costifissi" className="mt-4">
                {isLoading ? (
                  <SectionLoading />
                ) : (
                  <CostiIncassi
                    snapshot={snapshot}
                    companyIndex={activeCo}
                    scheduleSave={scheduleSave}
                  />
                )}
              </TabsContent>

              {SECTIONS.filter(s => !s.active).map(s => (
                <TabsContent key={s.key} value={s.key} className="mt-4">
                  <SectionPlaceholder title={s.label} />
                </TabsContent>
              ))}
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SectionLoading() {
  return (
    <div className="space-y-3" data-testid="finplan-section-loading">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function SectionPlaceholder({ title }: { title: string }) {
  return (
    <div
      className="rounded-md border border-dashed p-8 text-center text-muted-foreground"
      data-testid={`finplan-section-placeholder-${title.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <p className="text-sm font-medium mb-1">Sezione “{title}” in arrivo</p>
      <p className="text-xs">
        Migrazione in corso (task successivi). Per usare la versione attuale, rimuovi
        <code className="mx-1">?finplanReact=1</code> dall'URL.
      </p>
    </div>
  );
}

function ConsolidatoPlaceholder({ loading }: { loading: boolean }) {
  if (loading) return <SectionLoading />;
  return (
    <div
      className="rounded-md border border-dashed p-12 text-center text-muted-foreground"
      data-testid="finplan-consolidato-placeholder"
    >
      <Star className="h-8 w-8 mx-auto mb-3 text-amber-500" />
      <p className="text-sm font-medium mb-1">Consolidato gruppo in arrivo</p>
      <p className="text-xs">
        Aggregazioni cross-Ragione Sociale verranno aggiunte in un task dedicato (#147).
      </p>
    </div>
  );
}
