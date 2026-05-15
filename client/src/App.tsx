import { Switch, Route, Redirect, Router as WouterRouter } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { useEnabledModules } from "@/hooks/useEnabledModules";
import { BASE_PATH } from "@/lib/basePath";
import { Loader2 } from "lucide-react";
import { useEffect, lazy, Suspense } from "react";
import { useToast } from "@/hooks/use-toast";
import { PageLoadingSkeleton } from "@/components/skeletons";
import NotFound from "@/pages/not-found";
import Index from "@/pages/Index";
import Auth from "@/pages/auth";
import Profile from "@/pages/Profile";
import AdminPanel from "@/pages/AdminPanel";

// Pagine pesanti caricate on-demand (Task #137: code-splitting). Riducono il
// bundle di cold-start mantenendo le rotte leggere (Index, Auth, Profile)
// nello chunk principale per UX immediata. Ogni `lazy()` produce un chunk
// separato che viene scaricato solo quando l'utente naviga su quella rotta.
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Preventivatore = lazy(() => import("@/pages/Preventivatore"));
const SimulatoreHome = lazy(() => import("@/pages/SimulatoreHome"));
const SuperAdminPanel = lazy(() => import("@/pages/SuperAdminPanel"));
const TabelleCalcolo = lazy(() => import("@/pages/TabelleCalcolo"));
const VenditeBiSuite = lazy(() => import("@/pages/VenditeBiSuite"));
const MappaturaBiSuite = lazy(() => import("@/pages/MappaturaBiSuite"));
const DashboardGaraReale = lazy(() => import("@/pages/DashboardGaraReale"));
const ConfigurazioneGara = lazy(() => import("@/pages/ConfigurazioneGara"));
const Amministrazione = lazy(() => import("@/pages/Amministrazione"));
const DrmsCommissioning = lazy(() => import("@/pages/DrmsCommissioning"));

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/auth" />;
  }

  return <Component />;
}

function ModuleRoute({ component: Component, moduleKey }: { component: React.ComponentType; moduleKey: string | string[] }) {
  const { user, loading } = useAuth();
  const { isEnabled, loading: modLoading } = useEnabledModules();
  const { toast } = useToast();

  // moduleKey può essere singola chiave o array (any-of). Esempio: la pagina
  // /amministrazione è accessibile se è attivo `amministrazione` OPPURE
  // `controllo_gestione` (CdG vive come tab dentro Amministrazione).
  const keys = Array.isArray(moduleKey) ? moduleKey : [moduleKey];
  const blocked = !loading && !modLoading && !!user && !keys.some(k => isEnabled(k));

  useEffect(() => {
    if (blocked) {
      toast({
        title: 'Modulo non abilitato',
        description: 'Questo modulo non è attivo per la tua organizzazione.',
        variant: 'destructive',
      });
    }
  }, [blocked, toast]);

  if (loading || modLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <Redirect to="/auth" />;
  if (blocked) return <Redirect to="/" />;

  return <Component />;
}

function Router() {
  return (
    <Suspense fallback={<PageLoadingSkeleton />}>
      <Switch>
        <Route path="/auth" component={Auth} />
        <Route path="/">
          {() => <ProtectedRoute component={Index} />}
        </Route>
        <Route path="/dashboard">
          {() => <ModuleRoute component={Dashboard} moduleKey="simulatore" />}
        </Route>
        <Route path="/simulatore">
          {() => <ModuleRoute component={SimulatoreHome} moduleKey="simulatore" />}
        </Route>
        <Route path="/preventivatore">
          {() => <ModuleRoute component={Preventivatore} moduleKey="simulatore" />}
        </Route>
        <Route path="/profile">
          {() => <ProtectedRoute component={Profile} />}
        </Route>
        <Route path="/admin">
          {() => <ProtectedRoute component={AdminPanel} />}
        </Route>
        <Route path="/super-admin">
          {() => <ProtectedRoute component={SuperAdminPanel} />}
        </Route>
        <Route path="/tabelle-calcolo">
          {() => <ModuleRoute component={TabelleCalcolo} moduleKey="tabelle_calcolo" />}
        </Route>
        <Route path="/vendite-bisuite">
          {() => <ModuleRoute component={VenditeBiSuite} moduleKey="vendite_bisuite" />}
        </Route>
        <Route path="/mappatura-bisuite">
          {() => <ModuleRoute component={MappaturaBiSuite} moduleKey="mappatura_bisuite" />}
        </Route>
        <Route path="/dashboard-gara-reale">
          {() => <ModuleRoute component={DashboardGaraReale} moduleKey="gara_dashboard" />}
        </Route>
        <Route path="/configurazione-gara">
          {() => <ModuleRoute component={ConfigurazioneGara} moduleKey="gara_configurazione" />}
        </Route>
        <Route path="/amministrazione">
          {() => <ModuleRoute component={Amministrazione} moduleKey={["amministrazione", "controllo_gestione"]} />}
        </Route>
        <Route path="/controllo-gestione">
          {() => { window.location.replace(`${BASE_PATH}/amministrazione#controllo`); return null; }}
        </Route>
        <Route path="/drms-commissioning">
          {() => <ModuleRoute component={DrmsCommissioning} moduleKey="drms_commissioning" />}
        </Route>
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={BASE_PATH || undefined}>
          <Toaster />
          <Router />
        </WouterRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
