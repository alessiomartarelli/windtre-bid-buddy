import { Switch, Route, Redirect, Router as WouterRouter } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { useEnabledModules } from "@/hooks/useEnabledModules";
import { BASE_PATH } from "@/lib/basePath";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import NotFound from "@/pages/not-found";
import Index from "@/pages/Index";
import Dashboard from "@/pages/Dashboard";
import Preventivatore from "@/pages/Preventivatore";
import SimulatoreHome from "@/pages/SimulatoreHome";
import Profile from "@/pages/Profile";
import AdminPanel from "@/pages/AdminPanel";
import SuperAdminPanel from "@/pages/SuperAdminPanel";
import TabelleCalcolo from "@/pages/TabelleCalcolo";
import Auth from "@/pages/auth";
import VenditeBiSuite from "@/pages/VenditeBiSuite";
import MappaturaBiSuite from "@/pages/MappaturaBiSuite";
import DashboardGaraReale from "@/pages/DashboardGaraReale";
import ConfigurazioneGara from "@/pages/ConfigurazioneGara";
import Amministrazione from "@/pages/Amministrazione";
import DrmsCommissioning from "@/pages/DrmsCommissioning";

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

function ModuleRoute({ component: Component, moduleKey }: { component: React.ComponentType; moduleKey: string }) {
  const { user, loading } = useAuth();
  const { isEnabled, loading: modLoading } = useEnabledModules();
  const { toast } = useToast();

  const blocked = !loading && !modLoading && !!user && !isEnabled(moduleKey);

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
        {() => <ModuleRoute component={Amministrazione} moduleKey="amministrazione" />}
      </Route>
      <Route path="/drms-commissioning">
        {() => <ModuleRoute component={DrmsCommissioning} moduleKey="drms_commissioning" />}
      </Route>
      <Route component={NotFound} />
    </Switch>
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
