import { Redirect } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";

const Index = () => {
  const { profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (profile?.role === "super_admin") {
    return <Redirect to="/super-admin" replace />;
  }

  if (profile?.role === "admin") {
    return <Redirect to="/dashboard-gara-reale" replace />;
  }

  return <Redirect to="/preventivatore" replace />;
};

export default Index;
