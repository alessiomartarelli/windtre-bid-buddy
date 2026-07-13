import { useAuth } from "@/hooks/useAuth";
import { AppNavbar } from "@/components/AppNavbar";
import { Card, CardContent } from "@/components/ui/card";
import { Building2, Sparkles } from "lucide-react";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Buongiorno";
  if (h < 18) return "Buon pomeriggio";
  return "Buonasera";
}

function formatToday(): string {
  try {
    const s = new Intl.DateTimeFormat("it-IT", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date());
    return s.charAt(0).toUpperCase() + s.slice(1);
  } catch {
    return "";
  }
}

export default function Home() {
  const { profile, organization } = useAuth();

  const firstName = profile?.full_name?.trim().split(/\s+/)[0] || "";
  const orgName = organization?.name?.trim() || "";
  const today = formatToday();

  return (
    <div className="min-h-screen">
      <AppNavbar title="MyStoreDesk" />
      <main className="container mx-auto px-3 sm:px-6 py-10 sm:py-16">
        <div className="max-w-2xl mx-auto">
          <Card className="glass-panel border-0 overflow-hidden">
            <CardContent className="relative p-8 sm:p-12 text-center">
              <div
                className="absolute inset-x-0 -top-24 h-48 bg-gradient-to-br from-indigo-500/20 to-indigo-600/5 blur-3xl pointer-events-none"
                aria-hidden="true"
              />
              <div className="relative space-y-5">
                <div className="mx-auto flex items-center justify-center h-14 w-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 shadow-lg">
                  <Sparkles className="h-7 w-7 text-white" />
                </div>

                {today && (
                  <p
                    className="text-xs uppercase tracking-wider text-muted-foreground font-medium"
                    data-testid="text-home-date"
                  >
                    {today}
                  </p>
                )}

                <h1
                  className="text-3xl sm:text-4xl font-bold tracking-tight"
                  data-testid="text-home-title"
                >
                  {greeting()}
                  {firstName ? `, ${firstName}` : ""}
                </h1>

                {orgName && (
                  <div
                    className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/50 px-4 py-1.5 text-sm text-muted-foreground"
                    data-testid="text-home-org"
                  >
                    <Building2 className="h-4 w-4 text-primary" />
                    <span className="truncate max-w-[70vw] sm:max-w-none">{orgName}</span>
                  </div>
                )}

                <p className="text-sm sm:text-base text-muted-foreground max-w-md mx-auto pt-1">
                  Benvenuto in MyStoreDesk. Usa il menu in alto per accedere ai
                  tuoi strumenti e iniziare a lavorare.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
