import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Link2, Save, TestTube, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// URL API di default
const DEFAULT_BISUITE_API_URL = "http://85.94.215.97/api/v1/sales/full";

interface BiSuiteCredentials {
  apiUrl: string;
  clientId: string;
  clientSecret: string;
}

interface Organization {
  id: string;
  name: string;
}

interface BiSuiteConnectionFormProps {
  organizations: Organization[];
  onCredentialsSaved?: () => void;
}

export const BiSuiteConnectionForm = ({ organizations, onCredentialsSaved }: BiSuiteConnectionFormProps) => {
  const { toast } = useToast();
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [apiUrl, setApiUrl] = useState<string>(DEFAULT_BISUITE_API_URL);
  const [credentials, setCredentials] = useState<BiSuiteCredentials>({
    apiUrl: DEFAULT_BISUITE_API_URL,
    clientId: "",
    clientSecret: "",
  });
  const [showSecret, setShowSecret] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasExistingCredentials, setHasExistingCredentials] = useState(false);

  // Load existing credentials when organization changes
  useEffect(() => {
    if (selectedOrgId) {
      loadCredentials(selectedOrgId);
    } else {
      setCredentials({ apiUrl: apiUrl, clientId: "", clientSecret: "" });
      setHasExistingCredentials(false);
    }
  }, [selectedOrgId]);

  const loadCredentials = async (orgId: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/admin/bisuite-credentials?org_id=${orgId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load credentials');
      const data = await res.json();

      if (data) {
        setCredentials({
          apiUrl: data.api_url || apiUrl,
          clientId: data.client_id,
          clientSecret: data.client_secret,
        });
        setHasExistingCredentials(true);
      } else {
        setCredentials({ apiUrl: apiUrl, clientId: "", clientSecret: "" });
        setHasExistingCredentials(false);
      }
    } catch (error) {
      console.error('Error loading credentials:', error);
      toast({
        title: "Errore",
        description: "Impossibile caricare le credenziali",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (field: keyof BiSuiteCredentials, value: string) => {
    setCredentials(prev => ({ ...prev, [field]: value }));
  };

  const handleTest = async () => {
    if (!apiUrl || !credentials.clientId || !credentials.clientSecret) {
      toast({
        title: "Campi obbligatori",
        description: "Compila tutti i campi prima di testare la connessione",
        variant: "destructive",
      });
      return;
    }

    setIsTesting(true);
    try {
      // TODO: Implement actual OAuth test via edge function
      await new Promise(resolve => setTimeout(resolve, 1500));
      toast({
        title: "Test completato",
        description: "La funzionalità di test OAuth verrà implementata con l'edge function",
      });
    } catch (error) {
      toast({
        title: "Errore di connessione",
        description: "Impossibile connettersi all'API BiSuite",
        variant: "destructive",
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    if (!selectedOrgId) {
      toast({
        title: "Organizzazione richiesta",
        description: "Seleziona un'organizzazione prima di salvare",
        variant: "destructive",
      });
      return;
    }

    if (!apiUrl || !credentials.clientId || !credentials.clientSecret) {
      toast({
        title: "Campi obbligatori",
        description: "Compila tutti i campi prima di salvare",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const credentialData = {
        organization_id: selectedOrgId,
        api_url: apiUrl,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      };
      if (hasExistingCredentials) {
        const res = await fetch('/api/admin/bisuite-credentials', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(credentialData),
        });
        if (!res.ok) throw new Error('Failed to update credentials');
      } else {
        const res = await fetch('/api/admin/bisuite-credentials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(credentialData),
        });
        if (!res.ok) throw new Error('Failed to save credentials');
        setHasExistingCredentials(true);
      }

      toast({
        title: "Credenziali salvate",
        description: `Le credenziali BiSuite sono state ${hasExistingCredentials ? 'aggiornate' : 'salvate'} con successo`,
      });

      onCredentialsSaved?.();
    } catch (error: any) {
      console.error('Error saving credentials:', error);
      toast({
        title: "Errore",
        description: error.message || "Impossibile salvare le credenziali",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const getOrgName = (orgId: string) => {
    return organizations.find(o => o.id === orgId)?.name || orgId;
  };

  return (
    <Card className="border-border shadow-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Link2 className="h-5 w-5 text-primary" />
          Connessione BiSuite API
        </CardTitle>
        <CardDescription>
          Configura le credenziali OAuth 2.0 per collegare il sistema BiSuite a un'organizzazione
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* API URL - sopra la select organizzazione */}
          <div className="space-y-2">
            <Label htmlFor="apiUrl">URL API BiSuite *</Label>
            <Input
              id="apiUrl"
              type="url"
              placeholder="http://85.94.215.97/api/v1/sales/full"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              L'URL base delle API BiSuite
            </p>
          </div>

          {/* Organization selector */}
          <div className="space-y-2">
            <Label htmlFor="organization">Organizzazione *</Label>
            <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
              <SelectTrigger>
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
            {selectedOrgId && (
              <div className="flex items-center gap-2 text-xs">
                {hasExistingCredentials ? (
                  <>
                    <CheckCircle className="h-3 w-3 text-primary" />
                    <span className="text-primary">Credenziali configurate</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-3 w-3 text-muted-foreground" />
                    <span className="text-muted-foreground">Nessuna credenziale configurata</span>
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
                <Label htmlFor="clientId">Client ID *</Label>
                <Input
                  id="clientId"
                  type="text"
                  placeholder="Il tuo Client ID"
                  value={credentials.clientId}
                  onChange={(e) => handleChange("clientId", e.target.value)}
                  disabled={!selectedOrgId}
                />
                <p className="text-xs text-muted-foreground">
                  Identificativo univoco del client OAuth
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="clientSecret">Client Secret *</Label>
                <div className="relative">
                  <Input
                    id="clientSecret"
                    type={showSecret ? "text" : "password"}
                    placeholder="Il tuo Client Secret"
                    value={credentials.clientSecret}
                    onChange={(e) => handleChange("clientSecret", e.target.value)}
                    className="pr-10"
                    disabled={!selectedOrgId}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    onClick={() => setShowSecret(!showSecret)}
                    disabled={!selectedOrgId}
                  >
                    {showSecret ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Chiave segreta per l'autenticazione OAuth
                </p>
              </div>

              <div className="flex gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleTest}
                  disabled={isTesting || isSaving || !selectedOrgId}
                  className="flex-1"
                >
                  <TestTube className="h-4 w-4 mr-2" />
                  {isTesting ? "Test in corso..." : "Testa Connessione"}
                </Button>
                <Button
                  type="button"
                  onClick={handleSave}
                  disabled={isTesting || isSaving || !selectedOrgId}
                  className="flex-1"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {isSaving ? "Salvataggio..." : hasExistingCredentials ? "Aggiorna Credenziali" : "Salva Credenziali"}
                </Button>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
