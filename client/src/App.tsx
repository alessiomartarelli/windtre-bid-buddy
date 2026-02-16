import { Switch, Route, Redirect, Router as WouterRouter } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { BASE_PATH } from "@/lib/basePath";
import { Loader2 } from "lucide-react";
import NotFound from "@/pages/not-found";
import Index from "@/pages/Index";
import Dashboard from "@/pages/Dashboard";
import Preventivatore from "@/pages/Preventivatore";
import Profile from "@/pages/Profile";
import AdminPanel from "@/pages/AdminPanel";
import SuperAdminPanel from "@/pages/SuperAdminPanel";
import TabelleCalcolo from "@/pages/TabelleCalcolo";
import Auth from "@/pages/auth";

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

function Router() {
  return (
    <Switch>
      <Route path="/auth" component={Auth} />
      <Route path="/">
        {() => <ProtectedRoute component={Index} />}
      </Route>
      <Route path="/dashboard">
        {() => <ProtectedRoute component={Dashboard} />}
      </Route>
      <Route path="/preventivatore">
        {() => <ProtectedRoute component={Preventivatore} />}
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
        {() => <ProtectedRoute component={TabelleCalcolo} />}
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
