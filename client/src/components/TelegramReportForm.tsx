import { useState, useEffect } from "react";
import { apiUrl as buildApiUrl } from "@/lib/basePath";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Eye, EyeOff, Send, Save, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Organization {
  id: string;
  name: string;
}

interface TelegramReportFormProps {
  organizations: Organization[];
}

// Forecast mensile (Task #266): valori del form come stringhe (input
// numerici), convertiti a numero/null al salvataggio.
interface ForecastForm {
  canvassPezzi: string;
  telefoniPezzi: string;
  accessoriFatturato: string;
  serviziFatturato: string;
  numeroNegozi: string;
  giorniLavorativiPerNegozio: string;
}

const EMPTY_FORECAST_FORM: ForecastForm = {
  canvassPezzi: "",
  telefoniPezzi: "",
  accessoriFatturato: "",
  serviziFatturato: "",
  numeroNegozi: "",
  giorniLavorativiPerNegozio: "",
};

const FORECAST_FIELDS: Array<{
  key: keyof ForecastForm;
  label: string;
  placeholder: string;
  hint?: string;
}> = [
  { key: "canvassPezzi", label: "Canvass (pezzi/mese)", placeholder: "es. 240" },
  { key: "telefoniPezzi", label: "Telefoni (pezzi/mese)", placeholder: "es. 120" },
  { key: "accessoriFatturato", label: "Accessori (€/mese)", placeholder: "es. 5000" },
  { key: "serviziFatturato", label: "Servizi (€/mese)", placeholder: "es. 3000" },
  { key: "numeroNegozi", label: "Numero negozi", placeholder: "es. 4" },
  { key: "giorniLavorativiPerNegozio", label: "Giorni lavorativi/mese", placeholder: "es. 26" },
];

function forecastFormToPayload(f: ForecastForm): Record<string, number | null> {
  const num = (v: string): number | null => {
    const s = v.trim().replace(",", ".");
    if (s === "") return null;
    const n = parseFloat(s);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return {
    canvassPezzi: num(f.canvassPezzi),
    telefoniPezzi: num(f.telefoniPezzi),
    accessoriFatturato: num(f.accessoriFatturato),
    serviziFatturato: num(f.serviziFatturato),
    numeroNegozi: num(f.numeroNegozi),
    giorniLavorativiPerNegozio: num(f.giorniLavorativiPerNegozio),
  };
}

function forecastToForm(raw: unknown): ForecastForm {
  const o = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string =>
    v === null || v === undefined || v === "" ? "" : String(v);
  return {
    canvassPezzi: str(o.canvassPezzi),
    telefoniPezzi: str(o.telefoniPezzi),
    accessoriFatturato: str(o.accessoriFatturato),
    serviziFatturato: str(o.serviziFatturato),
    numeroNegozi: str(o.numeroNegozi),
    giorniLavorativiPerNegozio: str(o.giorniLavorativiPerNegozio),
  };
}

// Card admin per il report vendite giornaliero su Telegram (Task #239):
// configura bot token + chat ID del gruppo per organizzazione, abilita
// l'invio automatico (13:30 e 22:30 ora italiana) e invia un test.
export const TelegramReportForm = ({ organizations }: TelegramReportFormProps) => {
  const { toast } = useToast();
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [enabled, setEnabled] = useState(false);
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [hasExistingConfig, setHasExistingConfig] = useState(false);
  const [hasSavedToken, setHasSavedToken] = useState(false);
  const [forecast, setForecast] = useState<ForecastForm>(EMPTY_FORECAST_FORM);

  useEffect(() => {
    if (selectedOrgId) {
      loadConfig(selectedOrgId);
    } else {
      setEnabled(false);
      setBotToken("");
      setChatId("");
      setHasExistingConfig(false);
      setHasSavedToken(false);
      setForecast(EMPTY_FORECAST_FORM);
    }
  }, [selectedOrgId]);

  const setForecastField = (key: keyof ForecastForm, value: string) =>
    setForecast((prev) => ({ ...prev, [key]: value }));

  const loadConfig = async (orgId: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(buildApiUrl(`/api/admin/telegram-report?org_id=${orgId}`), {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Impossibile caricare la configurazione");
      const data = await res.json();
      if (data) {
        // Il server NON restituisce mai il token in chiaro: solo has_token.
        setEnabled(data.enabled === true);
        setBotToken("");
        setChatId(data.chat_id || "");
        setHasSavedToken(data.has_token === true);
        setHasExistingConfig(Boolean(data.has_token || data.chat_id));
        setForecast(forecastToForm(data.forecast));
      } else {
        setEnabled(false);
        setBotToken("");
        setChatId("");
        setHasSavedToken(false);
        setHasExistingConfig(false);
        setForecast(EMPTY_FORECAST_FORM);
      }
    } catch (error) {
      console.error("Error loading Telegram config:", error);
      toast({
        title: "Errore",
        description: "Impossibile caricare la configurazione Telegram",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedOrgId) return;
    if (enabled && ((!botToken.trim() && !hasSavedToken) || !chatId.trim())) {
      toast({
        title: "Dati mancanti",
        description: "Per abilitare il report servono bot token e chat ID",
        variant: "destructive",
      });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch(buildApiUrl("/api/admin/telegram-report"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          organization_id: selectedOrgId,
          enabled,
          bot_token: botToken.trim(),
          chat_id: chatId.trim(),
          forecast: forecastFormToPayload(forecast),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Salvataggio fallito");
      if (botToken.trim()) setHasSavedToken(true);
      setBotToken("");
      setHasExistingConfig(Boolean(botToken.trim() || hasSavedToken || chatId.trim()));
      toast({
        title: "Configurazione salvata",
        description: enabled
          ? "Report automatico attivo: invio alle 13:30 e alle 22:30"
          : "Configurazione salvata (invio automatico disattivato)",
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Impossibile salvare la configurazione";
      toast({ title: "Errore", description: msg, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearToken = async () => {
    if (!selectedOrgId || !hasSavedToken) return;
    setIsSaving(true);
    try {
      const res = await fetch(buildApiUrl("/api/admin/telegram-report"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          organization_id: selectedOrgId,
          enabled: false,
          clear_token: true,
          bot_token: "",
          chat_id: chatId.trim(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Rimozione fallita");
      setHasSavedToken(false);
      setEnabled(false);
      setBotToken("");
      setHasExistingConfig(Boolean(chatId.trim()));
      toast({
        title: "Token rimosso",
        description: "Il bot token salvato è stato eliminato (invio automatico disattivato)",
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Impossibile rimuovere il token";
      toast({ title: "Errore", description: msg, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    if (!selectedOrgId) return;
    if ((!botToken.trim() && !hasSavedToken) || !chatId.trim()) {
      toast({
        title: "Dati mancanti",
        description: "Inserisci bot token e chat ID prima di inviare il test",
        variant: "destructive",
      });
      return;
    }
    setIsTesting(true);
    try {
      const res = await fetch(buildApiUrl("/api/admin/telegram-report-test"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          organization_id: selectedOrgId,
          bot_token: botToken.trim(),
          chat_id: chatId.trim(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Invio test fallito");
      toast({
        title: "Report inviato",
        description: "Controlla il gruppo Telegram: il report di oggi è stato inviato",
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Impossibile inviare il test";
      toast({ title: "Errore", description: msg, variant: "destructive" });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <Card className="border-border shadow-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Send className="h-5 w-5 text-primary" />
          Report vendite su Telegram
        </CardTitle>
        <CardDescription>
          Invia automaticamente il riepilogo vendite del giorno in un gruppo Telegram alle 13:30
          e alle 22:30 (ora italiana)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="tg-organization">Organizzazione *</Label>
            <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
              <SelectTrigger data-testid="select-telegram-org">
                <SelectValue placeholder="Seleziona un'organizzazione" />
              </SelectTrigger>
              <SelectContent>
                {organizations.map((org) => (
                  <SelectItem key={org.id} value={org.id}>
                    {org.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedOrgId && !isLoading && (
              <div className="flex items-center gap-2 text-xs" data-testid="status-telegram-config">
                {hasExistingConfig ? (
                  <>
                    <CheckCircle className="h-3 w-3 text-primary" />
                    <span className="text-primary">
                      Bot configurato{enabled ? " — invio automatico ATTIVO" : " — invio automatico disattivato"}
                    </span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-3 w-3 text-muted-foreground" />
                    <span className="text-muted-foreground">Nessun bot configurato</span>
                  </>
                )}
              </div>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="tg-bot-token">Bot Token *</Label>
                <div className="relative">
                  <Input
                    id="tg-bot-token"
                    data-testid="input-telegram-token"
                    type={showToken ? "text" : "password"}
                    placeholder={hasSavedToken ? "•••••••• token salvato (lascia vuoto per mantenerlo)" : "123456789:ABCdefGHI..."}
                    value={botToken}
                    onChange={(e) => setBotToken(e.target.value)}
                    className="pr-10"
                    disabled={!selectedOrgId}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    onClick={() => setShowToken(!showToken)}
                    disabled={!selectedOrgId}
                    data-testid="button-toggle-token-visibility"
                  >
                    {showToken ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Crea un bot con @BotFather su Telegram (comando /newbot) e incolla qui il token.
                  Il token viene salvato cifrato.
                </p>
                {hasSavedToken && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                    onClick={handleClearToken}
                    disabled={isSaving || isTesting}
                    data-testid="button-telegram-clear-token"
                  >
                    Rimuovi token salvato
                  </Button>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="tg-chat-id">Chat ID del gruppo *</Label>
                <Input
                  id="tg-chat-id"
                  data-testid="input-telegram-chat-id"
                  type="text"
                  placeholder="-1001234567890"
                  value={chatId}
                  onChange={(e) => setChatId(e.target.value)}
                  disabled={!selectedOrgId}
                />
                <p className="text-xs text-muted-foreground">
                  Aggiungi il bot al gruppo, poi recupera l'ID del gruppo (di solito inizia con
                  -100): scrivi un messaggio nel gruppo e apri
                  api.telegram.org/bot&lt;TOKEN&gt;/getUpdates per leggerlo.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="tg-enabled">Invio automatico</Label>
                  <p className="text-xs text-muted-foreground">
                    Report giornaliero alle 13:30 e alle 22:30 (ora italiana)
                  </p>
                </div>
                <Switch
                  id="tg-enabled"
                  data-testid="switch-telegram-enabled"
                  checked={enabled}
                  onCheckedChange={setEnabled}
                  disabled={!selectedOrgId}
                />
              </div>

              <div className="space-y-3 rounded-lg border border-border p-3">
                <div className="space-y-0.5">
                  <Label>Forecast e obiettivi (mese)</Label>
                  <p className="text-xs text-muted-foreground">
                    Obiettivi mensili per il commento del report (stile direttore
                    vendite): passo, delta % e proiezioni. Lascia vuoto ciò che non
                    vuoi valutare.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {FORECAST_FIELDS.map((f) => (
                    <div key={f.key} className="space-y-1">
                      <Label htmlFor={`tg-forecast-${f.key}`} className="text-xs">
                        {f.label}
                      </Label>
                      <Input
                        id={`tg-forecast-${f.key}`}
                        data-testid={`input-telegram-forecast-${f.key}`}
                        type="number"
                        inputMode="decimal"
                        min="0"
                        placeholder={f.placeholder}
                        value={forecast[f.key]}
                        onChange={(e) => setForecastField(f.key, e.target.value)}
                        disabled={!selectedOrgId}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleTest}
                  disabled={isTesting || isSaving || !selectedOrgId}
                  className="flex-1"
                  data-testid="button-telegram-test"
                >
                  <Send className="h-4 w-4 mr-2" />
                  {isTesting ? "Invio in corso..." : "Invia report di prova"}
                </Button>
                <Button
                  type="button"
                  onClick={handleSave}
                  disabled={isTesting || isSaving || !selectedOrgId}
                  className="flex-1"
                  data-testid="button-telegram-save"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {isSaving ? "Salvataggio..." : "Salva configurazione"}
                </Button>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
