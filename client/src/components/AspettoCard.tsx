// Sezione "Aspetto" del profilo (Task #407): scelta tema chiaro/scuro/sistema
// e palette brand (preset o colore libero), con applicazione immediata e
// persistenza per-utente sul server.
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useTheme, type Theme } from "@/hooks/useTheme";
import { ACCENT_PRESETS, type AccentChoice, accentEquals, hexToHsl } from "@/lib/appearance";
import { Palette, Sun, Moon, Monitor, Check, Sparkles, Waves } from "lucide-react";

type AppearanceMode = Theme | "prisma-light" | "midnight-violet";

const THEME_OPTIONS: { value: AppearanceMode; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Chiaro", Icon: Sun },
  { value: "dark", label: "Scuro", Icon: Moon },
  { value: "system", label: "Sistema", Icon: Monitor },
  // Task #453 — variante editoriale "Prisma Light" della Dashboard Gara Reale.
  { value: "prisma-light", label: "Prisma Light", Icon: Sparkles },
  { value: "midnight-violet", label: "Midnight Violet", Icon: Waves },
];

export function AspettoCard() {
  const {
    theme,
    setTheme,
    accent,
    setAccent,
    dashboardStyle,
    setDashboardStyle,
    salesStyle,
    setSalesStyle,
  } = useTheme();
  const [customHex, setCustomHex] = useState(accent.type === "custom" ? accent.hex : "#6366f1");

  // La persistenza server è gestita dal ThemeProvider (fire-and-forget su
  // ogni setTheme/setAccent), quindi qui basta applicare la scelta.
  const chooseTheme = (mode: AppearanceMode) => {
    if (mode === "prisma-light") {
      setDashboardStyle("prisma-light");
      setSalesStyle("standard");
      return;
    }
    if (mode === "midnight-violet") {
      setDashboardStyle("standard");
      setSalesStyle("midnight-violet");
      return;
    }
    setDashboardStyle("standard");
    setSalesStyle("standard");
    setTheme(mode);
  };
  const chooseAccent = (a: AccentChoice) => setAccent(a);

  return (
    <Card data-testid="card-aspetto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="h-5 w-5" />
          Aspetto
        </CardTitle>
        <CardDescription>
          Personalizza tema e colori della piattaforma. Le scelte si applicano subito e vengono ricordate sul tuo account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <Label className="text-sm">Tema</Label>
          <div className="flex flex-wrap rounded-md border overflow-hidden mt-1.5 w-full sm:w-fit" data-testid="toggle-theme">
            {THEME_OPTIONS.map(({ value, label, Icon }, i) => (
              <button
                key={value}
                type="button"
                onClick={() => chooseTheme(value)}
                className={`h-10 flex-1 sm:flex-none px-3 sm:px-4 text-sm font-medium flex items-center justify-center gap-2 border-b sm:border-b-0 ${i > 0 ? "border-l" : ""} ${
                  (value === "prisma-light"
                    ? dashboardStyle === "prisma-light"
                    : value === "midnight-violet"
                      ? salesStyle === "midnight-violet"
                      : dashboardStyle === "standard" && salesStyle === "standard" && theme === value)
                    ? "bg-primary text-primary-foreground"
                    : "bg-background hover:bg-muted"
                }`}
                data-testid={`btn-theme-${value}`}
              >
                <Icon className="h-4 w-4" />{label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label className="text-sm">Colore principale</Label>
          <div className="flex flex-wrap gap-2.5 mt-2" data-testid="accent-presets">
            {ACCENT_PRESETS.map((p) => {
              const selected = accentEquals(accent, { type: "preset", id: p.id });
              return (
                <button
                  key={p.id}
                  type="button"
                  title={p.label}
                  onClick={() => chooseAccent({ type: "preset", id: p.id })}
                  className={`h-9 w-9 rounded-full flex items-center justify-center transition-transform hover:scale-110 ${selected ? "ring-2 ring-offset-2 ring-ring" : ""}`}
                  style={{ backgroundColor: p.swatch }}
                  data-testid={`btn-accent-${p.id}`}
                >
                  {selected && <Check className="h-4 w-4 text-white drop-shadow" />}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-3 mt-4">
            <Label htmlFor="custom-accent" className="text-sm text-muted-foreground">Colore personalizzato</Label>
            <input
              id="custom-accent"
              type="color"
              value={customHex}
              onChange={(e) => setCustomHex(e.target.value)}
              onBlur={() => {
                if (hexToHsl(customHex) && !accentEquals(accent, { type: "custom", hex: customHex })) {
                  chooseAccent({ type: "custom", hex: customHex });
                }
              }}
              className="h-9 w-14 rounded-md border cursor-pointer bg-background p-1"
              data-testid="input-accent-custom"
            />
            {accent.type === "custom" && (
              <span className="text-xs text-muted-foreground font-mono">{accent.hex}</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Il colore scelto viene applicato a barre, pulsanti, link e grafici. I colori di stato (avvisi, errori) restano invariati per leggibilità.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
