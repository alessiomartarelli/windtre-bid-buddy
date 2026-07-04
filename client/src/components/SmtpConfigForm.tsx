import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, Mail, Send, PlugZap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface SmtpConfigResponse {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  baseUrl: string;
  passSet: boolean;
  savedInDb: {
    host: boolean;
    port: boolean;
    secure: boolean;
    user: boolean;
    pass: boolean;
    from: boolean;
    baseUrl: boolean;
  } | null;
  envFallback: {
    host: boolean;
    user: boolean;
    pass: boolean;
    from: boolean;
    baseUrl: boolean;
  };
}

export function SmtpConfigForm({ defaultTestRecipient }: { defaultTestRecipient?: string }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [meta, setMeta] = useState<SmtpConfigResponse | null>(null);

  const [host, setHost] = useState("");
  const [port, setPort] = useState<number>(587);
  const [secure, setSecure] = useState(false);
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [from, setFrom] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [testTo, setTestTo] = useState(defaultTestRecipient ?? "");

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const res = await apiRequest("GET", "/api/admin/smtp-config");
      const data = (await res.json()) as SmtpConfigResponse;
      setMeta(data);
      setHost(data.host ?? "");
      setPort(data.port ?? 587);
      setSecure(!!data.secure);
      setUser(data.user ?? "");
      setFrom(data.from ?? "");
      setBaseUrl(data.baseUrl ?? "");
      setPass("");
    } catch (err) {
      toast({
        title: "Errore",
        description: err instanceof Error ? err.message : "Impossibile leggere la configurazione SMTP",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (defaultTestRecipient && !testTo) {
      setTestTo(defaultTestRecipient);
    }
  }, [defaultTestRecipient, testTo]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiRequest("PUT", "/api/admin/smtp-config", {
        host: host.trim(),
        port,
        secure,
        user: user.trim(),
        // Solo se compilata: lasciarla vuota = mantieni la password salvata.
        ...(pass.length > 0 ? { pass } : {}),
        from: from.trim(),
        baseUrl: baseUrl.trim(),
      });
      toast({ title: "Configurazione SMTP salvata" });
      setPass("");
      await fetchConfig();
    } catch (err) {
      toast({
        title: "Errore salvataggio",
        description: err instanceof Error ? err.message : "Impossibile salvare la configurazione",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!testTo.trim()) {
      toast({ title: "Inserisci un destinatario per il test", variant: "destructive" });
      return;
    }
    setTesting(true);
    try {
      const res = await apiRequest("POST", "/api/admin/smtp-test", { to: testTo.trim() });
      const data = await res.json();
      toast({
        title: "Email di test inviata",
        description: data.messageId ? `messageId: ${data.messageId}` : `Inviata a ${testTo}`,
      });
    } catch (err) {
      toast({
        title: "Invio email di test fallito",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    try {
      await apiRequest("POST", "/api/admin/smtp-verify");
      toast({
        title: "Connessione SMTP riuscita",
        description: "Host, porta e credenziali sono validi.",
      });
    } catch (err) {
      toast({
        title: "Verifica connessione fallita",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setVerifying(false);
    }
  };

  const sourceBadge = (field: "host" | "user" | "from" | "baseUrl" | "pass") => {
    const inDb = meta?.savedInDb?.[field];
    const inEnv = meta?.envFallback?.[field];
    if (inDb) {
      return (
        <Badge variant="default" className="text-[10px] py-0 px-1.5 h-4">
          DB
        </Badge>
      );
    }
    if (inEnv) {
      return (
        <Badge variant="secondary" className="text-[10px] py-0 px-1.5 h-4">
          ENV
        </Badge>
      );
    }
    return null;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Server SMTP
        </CardTitle>
        <CardDescription>
          Configura il server SMTP usato per le notifiche email (sync BiSuite, alert, ecc.).
          I valori salvati qui hanno priorità sulle variabili d'ambiente. Lascia la password vuota
          per mantenere quella già salvata.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="smtp-host" className="flex items-center gap-2">
                  Host SMTP {sourceBadge("host")}
                </Label>
                <Input
                  id="smtp-host"
                  data-testid="input-smtp-host"
                  placeholder="smtp.example.com"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="smtp-port">Porta</Label>
                <Input
                  id="smtp-port"
                  data-testid="input-smtp-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(e) => setPort(parseInt(e.target.value, 10) || 0)}
                  required
                />
              </div>
              <div className="flex items-end gap-3 pb-1">
                <div className="flex items-center gap-2">
                  <Switch
                    id="smtp-secure"
                    data-testid="switch-smtp-secure"
                    checked={secure}
                    onCheckedChange={setSecure}
                  />
                  <Label htmlFor="smtp-secure" className="cursor-pointer">
                    TLS implicito (porta 465)
                  </Label>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="smtp-user" className="flex items-center gap-2">
                  Utente {sourceBadge("user")}
                </Label>
                <Input
                  id="smtp-user"
                  data-testid="input-smtp-user"
                  placeholder="user@example.com"
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="smtp-pass" className="flex items-center gap-2">
                  Password {sourceBadge("pass")}
                  {meta?.passSet && (
                    <span className="text-xs text-muted-foreground">(impostata)</span>
                  )}
                </Label>
                <Input
                  id="smtp-pass"
                  data-testid="input-smtp-pass"
                  type="password"
                  placeholder={meta?.passSet ? "•••••••• (lascia vuoto per mantenere)" : "Password SMTP"}
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="smtp-from" className="flex items-center gap-2">
                  Mittente (From) {sourceBadge("from")}
                </Label>
                <Input
                  id="smtp-from"
                  data-testid="input-smtp-from"
                  placeholder='MyStoreDesk <noreply@example.com>'
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="smtp-baseurl" className="flex items-center gap-2">
                  Base URL applicazione {sourceBadge("baseUrl")}
                </Label>
                <Input
                  id="smtp-baseurl"
                  data-testid="input-smtp-baseurl"
                  placeholder="https://incentive.example.com/incentivew3"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Usato per i link assoluti nelle email (es. "Apri Vendite BiSuite").
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Button type="submit" disabled={saving} data-testid="button-save-smtp">
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Salvataggio...
                  </>
                ) : (
                  "Salva configurazione"
                )}
              </Button>
            </div>

            <div className="border-t pt-4 mt-4 space-y-2">
              <Label htmlFor="smtp-test-to">Invia email di test a</Label>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  id="smtp-test-to"
                  data-testid="input-smtp-test-to"
                  type="email"
                  placeholder="destinatario@example.com"
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleVerify}
                  disabled={verifying || !meta?.host}
                  data-testid="button-verify-smtp"
                >
                  {verifying ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Verifica...
                    </>
                  ) : (
                    <>
                      <PlugZap className="mr-2 h-4 w-4" />
                      Verifica connessione
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleTest}
                  disabled={testing || !meta?.host}
                  data-testid="button-send-smtp-test"
                >
                  {testing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Invio...
                    </>
                  ) : (
                    <>
                      <Send className="mr-2 h-4 w-4" />
                      Invia email di test
                    </>
                  )}
                </Button>
              </div>
              {!meta?.host && (
                <p className="text-xs text-destructive">
                  Configura host SMTP e salva prima di inviare un'email di test.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Il test usa la configurazione attualmente salvata (DB + env). Se hai appena
                modificato i campi, salva prima per testarli.
              </p>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
