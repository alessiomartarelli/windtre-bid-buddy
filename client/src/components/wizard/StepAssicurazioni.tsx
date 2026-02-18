import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  AssicurazioniConfig,
  AssicurazioniPdvInGara,
  AssicurazioniAttivatoRiga,
  AssicurazioniResult,
  AssicurazioneProduct,
  ASSICURAZIONI_LABELS,
  createEmptyAssicurazioniAttivato,
} from "@/types/assicurazioni";
import { PuntoVendita } from "@/types/preventivatore";
import { formatCurrency } from "@/utils/format";
import { Shield, Clock } from "lucide-react";
import { StepContentHeader } from "./StepContentHeader";
import { CalendarioMeseOverride, getWorkdayInfoFromOverrides } from "@/utils/calendario";

interface StepAssicurazioniProps {
  config: AssicurazioniConfig;
  onConfigChange: (config: AssicurazioniConfig) => void;
  pdvInGara: AssicurazioniPdvInGara[];
  onPdvInGaraChange: (pdvInGara: AssicurazioniPdvInGara[]) => void;
  puntiVendita: PuntoVendita[];
  attivatoByPos: Record<string, AssicurazioniAttivatoRiga>;
  onAttivatoChange: (posId: string, attivato: AssicurazioniAttivatoRiga) => void;
  results: AssicurazioniResult[];
  totalePremio: number;
  anno?: number;
  monthIndex?: number;
  calendarioOverrides?: Record<string, CalendarioMeseOverride>;
}

const PRODOTTI_STANDARD: (keyof Omit<AssicurazioniAttivatoRiga, 'viaggioMondo' | 'viaggioMondoPremio' | 'reloadForever'>)[] = [
  'protezionePro',
  'casaFamigliaFull',
  'casaFamigliaPlus',
  'casaFamigliaStart',
  'sportFamiglia',
  'sportIndividuale',
  'viaggiVacanze',
  'elettrodomestici',
  'micioFido',
];

export default function StepAssicurazioni({
  config,
  onConfigChange,
  pdvInGara,
  onPdvInGaraChange,
  puntiVendita,
  attivatoByPos,
  onAttivatoChange,
  results,
  totalePremio,
  anno,
  monthIndex,
  calendarioOverrides,
}: StepAssicurazioniProps) {
  const handleConfigChange = (field: keyof AssicurazioniConfig, value: number) => {
    onConfigChange({ ...config, [field]: value });
  };

  const handlePdvInGaraToggle = (pdvId: string, inGara: boolean) => {
    onPdvInGaraChange(
      pdvInGara.map((p) => (p.pdvId === pdvId ? { ...p, inGara } : p))
    );
  };

  const handleAttivatoChange = (
    posId: string,
    field: keyof AssicurazioniAttivatoRiga,
    value: number
  ) => {
    const current = attivatoByPos[posId] || createEmptyAssicurazioniAttivato();
    onAttivatoChange(posId, { ...current, [field]: value });
  };

  const pdvCodificatiInGara = pdvInGara.filter(p => p.inGara).length;

  return (
    <div className="space-y-6">
      {/* Header con totale */}
      <StepContentHeader
        icon={Shield}
        title="Assicurazioni"
        subtitle="Configura i target e inserisci i pezzi assicurativi per punto vendita"
        totalPremio={totalePremio}
        extraInfo={`${pdvCodificatiInGara} PDV selezionati in gara`}
      />

      {/* Configurazione Target */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Target Assicurazioni</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label htmlFor="pdvInGara">PDV in Gara</Label>
              <Input
                id="pdvInGara"
                type="number"
                min={0}
                value={config.pdvInGara}
                onChange={(e) => handleConfigChange("pdvInGara", Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                Suggerito: 15 × PDV = {15 * config.pdvInGara} punti
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="targetNoMalus">Target No Malus (punti)</Label>
              <Input
                id="targetNoMalus"
                type="number"
                min={0}
                value={config.targetNoMalus}
                onChange={(e) => handleConfigChange("targetNoMalus", Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="targetS1">Target S1 (punti)</Label>
              <Input
                id="targetS1"
                type="number"
                min={0}
                value={config.targetS1}
                onChange={(e) => handleConfigChange("targetS1", Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                Bonus: €500 per PDV codificato
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="targetS2">Target S2 (punti)</Label>
              <Input
                id="targetS2"
                type="number"
                min={0}
                value={config.targetS2}
                onChange={(e) => handleConfigChange("targetS2", Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                Bonus: €750 per PDV
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Selezione PDV in Gara */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center justify-between">
            <span>Punti Vendita in Gara Assicurazioni</span>
            <Badge variant="secondary">{pdvCodificatiInGara} selezionati</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {pdvInGara.map((pdv) => (
              <div key={pdv.pdvId} className="flex items-center space-x-2">
                <Checkbox
                  id={`gara-ass-${pdv.pdvId}`}
                  checked={pdv.inGara}
                  onCheckedChange={(checked) => handlePdvInGaraToggle(pdv.pdvId, !!checked)}
                />
                <Label htmlFor={`gara-ass-${pdv.pdvId}`} className="text-sm cursor-pointer flex-1">
                  {(pdv.nome || pdv.codicePos).toUpperCase()}
                </Label>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Input pezzi per PDV */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Pezzi Assicurativi per Punto Vendita</h3>
        
        {puntiVendita.map((pdv) => {
          const attivato = attivatoByPos[pdv.codicePos] || createEmptyAssicurazioniAttivato();
          const result = results.find((r) => r.pdvId === pdv.codicePos);
          const pdvInfo = pdvInGara.find(p => p.pdvId === pdv.codicePos);
          const isInGara = pdvInfo?.inGara ?? false;
          const wi = (anno !== undefined && monthIndex !== undefined)
            ? getWorkdayInfoFromOverrides(anno, monthIndex, pdv.calendar, calendarioOverrides?.[pdv.id])
            : null;
          const totalWorkingDays = wi?.totalWorkingDays || 0;
          const totalPezziPDV = Object.values(attivato).reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0);
          const runRatePezzi = totalWorkingDays > 0 ? totalPezziPDV / totalWorkingDays : 0;

          return (
            <Card key={pdv.codicePos} className={isInGara ? "border-primary/50" : ""}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">{(pdv.nome || pdv.codicePos).toUpperCase()}</CardTitle>
                    {isInGara && <Badge variant="secondary">In gara</Badge>}
                  </div>
                  {result && (
                    <div className="text-right">
                      <div className="text-sm text-muted-foreground">
                        Punti: {result.puntiTotaliConReload.toFixed(2)}
                      </div>
                      <div className="font-semibold text-primary">
                        {formatCurrency(result.premioTotale)}
                      </div>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                  {/* Prodotti standard */}
                  {PRODOTTI_STANDARD.map((prodotto) => (
                    <div key={prodotto} className="space-y-1">
                      <Label className="text-xs">{ASSICURAZIONI_LABELS[prodotto]}</Label>
                      <Input
                        type="number"
                        min={0}
                        value={attivato[prodotto]}
                        onChange={(e) =>
                          handleAttivatoChange(pdv.codicePos, prodotto, Number(e.target.value))
                        }
                        className="h-8"
                      />
                    </div>
                  ))}
                  
                  {/* Viaggio Mondo */}
                  <div className="space-y-1">
                    <Label className="text-xs">Viaggio Mondo (€ premio)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={attivato.viaggioMondoPremio}
                      onChange={(e) =>
                        handleAttivatoChange(pdv.codicePos, 'viaggioMondoPremio', Number(e.target.value))
                      }
                      className="h-8"
                    />
                  </div>
                  
                  {/* Reload Forever */}
                  <div className="space-y-1">
                    <Label className="text-xs">Reload Forever (eventi)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={attivato.reloadForever}
                      onChange={(e) =>
                        handleAttivatoChange(pdv.codicePos, 'reloadForever', Number(e.target.value))
                      }
                      className="h-8"
                    />
                    <p className="text-[10px] text-muted-foreground">1 punto ogni 5 eventi</p>
                  </div>
                </div>

                {totalWorkingDays > 0 && (
                  <div className="p-2 bg-secondary/10 rounded-lg border border-secondary/30 mt-2" data-testid={`run-rate-assicurazioni-pdv-${pdv.id}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <Clock className="w-3 h-3 text-secondary-foreground" />
                      <span className="font-medium text-xs text-secondary-foreground">Run Rate</span>
                    </div>
                    <span className="text-xs text-muted-foreground">Pezzi/gg: <span className="font-medium text-foreground">{runRatePezzi.toFixed(2)}</span> · Giorni: {totalWorkingDays}</span>
                  </div>
                )}

                {result && result.dettaglioProdotti.length > 0 && (
                  <div className="mt-4 pt-3 border-t">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      {result.dettaglioProdotti.map((d, idx) => (
                        <div key={idx} className="bg-muted/50 p-2 rounded">
                          <div className="font-medium">{d.prodotto}</div>
                          <div className="text-muted-foreground">
                            {d.pezzi} pz × {d.punti.toFixed(2)} pt = {formatCurrency(d.premio)}
                          </div>
                        </div>
                      ))}
                    </div>
                    {(result.bonusSoglia1 > 0 || result.bonusSoglia2 > 0) && (
                      <div className="mt-2 flex gap-2">
                        {result.bonusSoglia1 > 0 && (
                          <Badge variant="outline" className="bg-green-500/10">
                            Bonus S1: {formatCurrency(result.bonusSoglia1)}
                          </Badge>
                        )}
                        {result.bonusSoglia2 > 0 && (
                          <Badge variant="outline" className="bg-blue-500/10">
                            Bonus S2: {formatCurrency(result.bonusSoglia2)}
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Totale */}
      <Card className="bg-primary/5 border-primary">
        <CardContent className="py-4">
          <div className="flex justify-between items-center">
            <span className="text-lg font-semibold">Totale Premio Assicurazioni</span>
            <span className="text-2xl font-bold text-primary">{formatCurrency(totalePremio)}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
