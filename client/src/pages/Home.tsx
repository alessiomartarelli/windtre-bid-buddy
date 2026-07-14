import { useAuth } from "@/hooks/useAuth";
import { useEnabledModules } from "@/hooks/useEnabledModules";
import { useLocation } from "wouter";
import { AppNavbar } from "@/components/AppNavbar";
import { Card, CardContent } from "@/components/ui/card";
import {
  Building2,
  Sparkles,
  BookOpen,
  BarChart3,
  LayoutDashboard,
  Trophy,
  ShoppingCart,
  Route,
  Medal,
  FileText,
  Table2,
  PackageOpen,
  CalendarClock,
} from "lucide-react";

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

interface ShortcutDef {
  key: string;
  path: string;
  label: string;
  description: string;
  icon: typeof Sparkles;
  adminOnly?: boolean;
  // Se assente, la scorciatoia è visibile quando `isEnabled(key)` è true.
  // Alcuni moduli condividono la stessa pagina (es. Amministrazione).
  enabledWhen?: (isEnabled: (k: string) => boolean) => boolean;
}

// Catalogo delle scorciatoie della Home hub. Le chiavi combaciano con i
// moduli di `shared/modules.ts` così che il gating (enabledModules + brand
// WindTre) e i ruoli restino allineati con la navbar. La Home NON è mai un
// modulo gated: mostra solo i link ai moduli effettivamente attivi.
const SHORTCUTS: ShortcutDef[] = [
  {
    key: "amministrazione",
    path: "/amministrazione",
    label: "Amministrazione",
    description: "Prima Nota IVA, BiSuite, Controllo di Gestione",
    icon: BookOpen,
    adminOnly: true,
    enabledWhen: (isEnabled) =>
      isEnabled("amministrazione") || isEnabled("controllo_gestione"),
  },
  {
    key: "drms_commissioning",
    path: "/drms-commissioning",
    label: "DRMS Commissioning",
    description: "Estratto conto provvigionale",
    icon: BarChart3,
    adminOnly: true,
  },
  {
    key: "gara_dashboard",
    path: "/dashboard-gara-reale",
    label: "Dashboard Gara",
    description: "Andamento gara e soglie",
    icon: LayoutDashboard,
  },
  {
    key: "gara_configurazione",
    path: "/configurazione-gara",
    label: "Configurazione Gara",
    description: "Target, cluster e incentivazione",
    icon: Trophy,
    adminOnly: true,
  },
  {
    key: "vendite_bisuite",
    path: "/vendite-bisuite",
    label: "Vendite BiSuite",
    description: "Vendite sincronizzate dal gestionale",
    icon: ShoppingCart,
  },
  {
    key: "customer_journey",
    path: "/customer-journey",
    label: "Customer Journey",
    description: "Cross-sell strutturato sui clienti",
    icon: Route,
  },
  {
    key: "incentivazione_interna",
    path: "/incentivazione-interna",
    label: "Incentivazione Interna",
    description: "Gare addetto e valenze",
    icon: Medal,
  },
  {
    key: "gestione_dts",
    path: "/gestione-dts",
    label: "Gestione DTS",
    description: "Lead drive-to-store e incidenza vendite",
    icon: CalendarClock,
  },
  {
    key: "simulatore",
    path: "/simulatore",
    label: "Simulatore Preventivi",
    description: "Crea e configura i preventivi",
    icon: FileText,
  },
  {
    key: "tabelle_calcolo",
    path: "/tabelle-calcolo",
    label: "Tabelle Calcolo",
    description: "Soglie e valori di calcolo",
    icon: Table2,
    adminOnly: true,
  },
];

export default function Home() {
  const { profile, organization } = useAuth();
  const { isEnabled } = useEnabledModules();
  const [, setLocation] = useLocation();

  const firstName = profile?.full_name?.trim().split(/\s+/)[0] || "";
  const orgName = organization?.name?.trim() || "";
  const today = formatToday();

  const isAdminOrSuper = ["super_admin", "admin"].includes(profile?.role || "");

  const shortcuts = SHORTCUTS.filter((s) => {
    if (s.adminOnly && !isAdminOrSuper) return false;
    return s.enabledWhen ? s.enabledWhen(isEnabled) : isEnabled(s.key);
  });

  return (
    <div className="min-h-screen">
      <AppNavbar title="MyStoreDesk" />
      <main className="container mx-auto px-3 sm:px-6 py-10 sm:py-16">
        <div className="max-w-3xl mx-auto space-y-8">
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
                  Benvenuto in MyStoreDesk. Scegli uno strumento qui sotto oppure
                  usa il menu in alto per iniziare a lavorare.
                </p>
              </div>
            </CardContent>
          </Card>

          <section aria-labelledby="home-shortcuts-title" data-testid="section-home-shortcuts">
            <h2
              id="home-shortcuts-title"
              className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3 px-1"
            >
              I tuoi strumenti
            </h2>

            {shortcuts.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {shortcuts.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setLocation(s.path)}
                    className="group text-left"
                    data-testid={`link-home-shortcut-${s.key}`}
                  >
                    <Card className="glass-panel border-0 h-full transition-shadow group-hover:shadow-md">
                      <CardContent className="flex items-start gap-3 p-4">
                        <div className="flex items-center justify-center h-10 w-10 shrink-0 rounded-xl bg-gradient-to-br from-indigo-500/15 to-indigo-600/5 text-primary">
                          <s.icon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate">{s.label}</p>
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {s.description}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  </button>
                ))}
              </div>
            ) : (
              <Card className="glass-panel border-0">
                <CardContent
                  className="flex flex-col items-center justify-center gap-2 py-10 text-center"
                  data-testid="text-home-no-modules"
                >
                  <div className="flex items-center justify-center h-12 w-12 rounded-2xl bg-muted/50 text-muted-foreground">
                    <PackageOpen className="h-6 w-6" />
                  </div>
                  <p className="font-semibold text-sm">Nessun modulo attivo</p>
                  <p className="text-xs text-muted-foreground max-w-sm">
                    Non ci sono ancora strumenti abilitati per la tua
                    organizzazione. Contatta l'amministratore per attivarli.
                  </p>
                </CardContent>
              </Card>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
