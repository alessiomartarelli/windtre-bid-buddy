import { Redirect } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";
import Home from "@/pages/Home";

const Index = () => {
  const { profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // super_admin conserva il suo ingresso dedicato. Tutti gli altri (admin e
  // operatore) atterrano sulla Home hub, sempre disponibile a prescindere dai
  // moduli attivi: niente più redirect verso moduli potenzialmente disabilitati.
  if (profile?.role === "super_admin") {
    return <Redirect to="/super-admin" replace />;
  }

  return <Home />;
};

export default Index;
