import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { LineChart, BarChart3, Wallet, Target, TrendingUp, Briefcase, Users, FileText, Settings } from "lucide-react";
import { useFinplanData } from "@/hooks/useFinplan";

interface FinplanAppProps {
  orgId: string;
}

type FinplanTab =
  | "overview"
  | "transazioni"
  | "obiettivi"
  | "debiti"
  | "personale"
  | "partitari"
  | "consolidato"
  | "scenari";

const TABS: { key: FinplanTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "overview",     label: "Overview",     icon: LineChart },
  { key: "transazioni",  label: "Transazioni",  icon: BarChart3 },
  { key: "obiettivi",    label: "Obiettivi",    icon: Target },
  { key: "debiti",       label: "Debiti",       icon: Wallet },
  { key: "personale",    label: "Personale",    icon: Users },
  { key: "partitari",    label: "Partitari",    icon: FileText },
  { key: "consolidato",  label: "Consolidato",  icon: Briefcase },
  { key: "scenari",      label: "Scenari",      icon: TrendingUp },
];

/**
 * Shell React di FinPlan Studio (work in progress — Task #142).
 *
 * Questo componente è il futuro sostituto dell'iframe legacy
 * (`client/public/finplan/index.html`). Per ora è gated dietro la
 * query string `?finplanReact=1` su Amministrazione → tab Analisi:
 * gli utenti reali continuano a vedere l'iframe finché tutte le
 * sezioni (#143-#147) non sono pronte. La rimozione dell'iframe è
 * pianificata in Task #148.
 */
export default function FinplanApp({ orgId }: FinplanAppProps) {
  const [tab, setTab] = useState<FinplanTab>("overview");
  const { snapshot, updatedAt, isLoading, isError } = useFinplanData(orgId);

  const numCompanies = snapshot?.data?.length ?? 0;

  return (
    <div className="space-y-4" data-testid="finplan-react-app">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <div className="flex items-center gap-3">
            <CardTitle className="text-lg">FinPlan Studio</CardTitle>
            <Badge variant="outline" data-testid="badge-finplan-react">React (preview)</Badge>
            {isLoading ? (
              <Badge variant="secondary">Caricamento…</Badge>
            ) : isError ? (
              <Badge variant="destructive">Errore di rete</Badge>
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
            <span data-testid="text-finplan-companies-count">{numCompanies} ragioni sociali</span>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={tab} onValueChange={(v) => setTab(v as FinplanTab)}>
            <TabsList className="flex flex-wrap h-auto justify-start gap-1">
              {TABS.map(({ key, label, icon: Icon }) => (
                <TabsTrigger key={key} value={key} data-testid={`tab-finplan-${key}`}>
                  <Icon className="h-4 w-4 mr-2" />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>

            {TABS.map(({ key, label }) => (
              <TabsContent key={key} value={key} className="mt-4">
                <SectionPlaceholder title={label} loading={isLoading} />
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function SectionPlaceholder({ title, loading }: { title: string; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-3" data-testid="finplan-section-loading">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  return (
    <div
      className="rounded-md border border-dashed p-8 text-center text-muted-foreground"
      data-testid={`finplan-section-placeholder-${title.toLowerCase()}`}
    >
      <p className="text-sm font-medium mb-1">Sezione “{title}” in arrivo</p>
      <p className="text-xs">
        Migrazione in corso. Per usare la versione attuale, rimuovi
        <code className="mx-1">?finplanReact=1</code> dall'URL.
      </p>
    </div>
  );
}
