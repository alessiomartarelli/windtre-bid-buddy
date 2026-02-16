import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { PuntoVendita } from "@/types/preventivatore";
import {
  EnergiaConfig,
  EnergiaAttivatoRiga,
  EnergiaPdvInGara,
  EnergiaResult,
  EnergiaCategory,
  ENERGIA_CATEGORY_LABELS,
  ENERGIA_W3_CATEGORY_LABELS,
  ENERGIA_BASE_PAY,
  getPistaEnergiaSoglie,
  getPistaEnergiaSoglieEffettive,
  PISTA_ENERGIA_BONUS_PER_CONTRATTO,
  PistaEnergiaSoglia,
} from "@/types/energia";
import { formatCurrency } from "@/utils/format";
import { Zap } from "lucide-react";
import { StepContentHeader } from "./StepContentHeader";

interface StepEnergiaProps {
  puntiVendita: PuntoVendita[];
  energiaConfig: EnergiaConfig;
  setEnergiaConfig: React.Dispatch<React.SetStateAction<EnergiaConfig>>;
  energiaPdvInGara: EnergiaPdvInGara[];
  setEnergiaPdvInGara: React.Dispatch<React.SetStateAction<EnergiaPdvInGara[]>>;
  attivatoEnergiaByPos: Record<string, EnergiaAttivatoRiga[]>;
  setAttivatoEnergiaByPos: React.Dispatch<React.SetStateAction<Record<string, EnergiaAttivatoRiga[]>>>;
  energiaResults: EnergiaResult[];
  totalePremioEnergia: number;
}

export function StepEnergia({
  puntiVendita,
  energiaConfig,
  setEnergiaConfig,
  energiaPdvInGara,
  setEnergiaPdvInGara,
  attivatoEnergiaByPos,
  setAttivatoEnergiaByPos,
  energiaResults,
  totalePremioEnergia,
}: StepEnergiaProps) {
  
  const handleConfigChange = (field: keyof EnergiaConfig, value: number) => {
    setEnergiaConfig((prev) => ({ ...prev, [field]: value }));
  };

  const handlePdvInGaraToggle = (pdvId: string, checked: boolean) => {
    setEnergiaPdvInGara((prev) =>
      prev.map((p) => (p.pdvId === pdvId ? { ...p, isInGara: checked } : p))
    );
  };

  const handlePezziChange = (pdvId: string, category: EnergiaCategory, pezzi: number) => {
    setAttivatoEnergiaByPos((prev) => {
      const existing = prev[pdvId] || [];
      const idx = existing.findIndex((r) => r.category === category);
      
      if (idx >= 0) {
        const updated = [...existing];
        updated[idx] = { ...updated[idx], pezzi };
        return { ...prev, [pdvId]: updated };
      } else {
        return {
          ...prev,
          [pdvId]: [...existing, { id: `${pdvId}-${category}`, category, pezzi }],
        };
      }
    });
  };

  const getPezzi = (pdvId: string, category: EnergiaCategory): number => {
    const righe = attivatoEnergiaByPos[pdvId] || [];
    return righe.find((r) => r.category === category)?.pezzi || 0;
  };

  const getResultForPdv = (pdvId: string): EnergiaResult | undefined => {
    const pdv = puntiVendita.find((p) => p.id === pdvId);
    if (!pdv) return undefined;
    return energiaResults.find((r) => r.posCode === pdv.codicePos);
  };

  const pdvInGaraCount = energiaPdvInGara.filter((p) => p.isInGara).length;

  return (
    <div className="space-y-6">
      {/* Header con totale */}
      <StepContentHeader
        icon={Zap}
        title="Energia"
        subtitle="Contratti Luce & Gas per punto vendita"
        totalPremio={totalePremioEnergia}
        extraInfo={`PDV in gara: ${pdvInGaraCount} / ${puntiVendita.length}`}
      />

      {/* Configurazione Target */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Configurazione Target extra L&G</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div>
              <Label htmlFor="pdvInGara">PDV in gara (RS)</Label>
              <Input
                id="pdvInGara"
                type="number"
                min={0}
                value={energiaConfig.pdvInGara || ""}
                onChange={(e) => handleConfigChange("pdvInGara", Number(e.target.value))}
                placeholder="N° PDV"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Soglia bonus: {55 * (energiaConfig.pdvInGara || 0)} contratti
              </p>
            </div>
            <div>
              <Label htmlFor="targetNoMalus">Target No Malus</Label>
              <Input
                id="targetNoMalus"
                type="number"
                min={0}
                value={energiaConfig.targetNoMalus || ""}
                onChange={(e) => handleConfigChange("targetNoMalus", Number(e.target.value))}
              />
            </div>
            <div>
              <Label htmlFor="targetS1">Target S1 (€250)</Label>
              <Input
                id="targetS1"
                type="number"
                min={0}
                value={energiaConfig.targetS1 || ""}
                onChange={(e) => handleConfigChange("targetS1", Number(e.target.value))}
              />
            </div>
            <div>
              <Label htmlFor="targetS2">Target S2 (€500)</Label>
              <Input
                id="targetS2"
                type="number"
                min={0}
                value={energiaConfig.targetS2 || ""}
                onChange={(e) => handleConfigChange("targetS2", Number(e.target.value))}
              />
            </div>
            <div>
              <Label htmlFor="targetS3">Target S3 (€1000)</Label>
              <Input
                id="targetS3"
                type="number"
                min={0}
                value={energiaConfig.targetS3 || ""}
                onChange={(e) => handleConfigChange("targetS3", Number(e.target.value))}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista PDV in Gara */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Negozi in Gara (per premi a soglia)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {energiaPdvInGara.map((pdv) => (
              <div
                key={pdv.pdvId}
                className="flex items-center gap-2 p-2 border rounded-lg hover:bg-muted/50"
              >
                <Checkbox
                  id={`gara-${pdv.pdvId}`}
                  checked={pdv.isInGara}
                  onCheckedChange={(checked) => handlePdvInGaraToggle(pdv.pdvId, !!checked)}
                />
                <Label htmlFor={`gara-${pdv.pdvId}`} className="text-sm cursor-pointer flex-1">
                  {(pdv.nome || pdv.codicePos).toUpperCase()}
                </Label>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Pista Energia - Soglie automatiche */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Pista Energia</CardTitle>
          <p className="text-xs text-muted-foreground">
            Soglie automatiche in base al numero di PDV. Bonus aggiuntivo per contratto al raggiungimento della soglia.
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Fino a 3 PDV (per PDV)</p>
                <div className="flex flex-wrap gap-2">
                  {(["S1", "S2", "S3", "S4", "S5"] as PistaEnergiaSoglia[]).map((s) => (
                    <Badge key={s} variant="outline" className="text-xs py-0.5 px-2">
                      {s === "S5" ? "S Extra" : s}: {getPistaEnergiaSoglie(1)[s]}
                      {PISTA_ENERGIA_BONUS_PER_CONTRATTO[s] > 0 && ` (+${PISTA_ENERGIA_BONUS_PER_CONTRATTO[s]}€/contr.)`}
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Dal 4° PDV in poi (per PDV)</p>
                <div className="flex flex-wrap gap-2">
                  {(["S1", "S2", "S3", "S4", "S5"] as PistaEnergiaSoglia[]).map((s) => (
                    <Badge key={s} variant="outline" className="text-xs py-0.5 px-2">
                      {s}: {getPistaEnergiaSoglie(4)[s]}
                      {PISTA_ENERGIA_BONUS_PER_CONTRATTO[s] > 0 && ` (+${PISTA_ENERGIA_BONUS_PER_CONTRATTO[s]}€/contr.)`}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
            {puntiVendita.length > 0 && (
              <div className="mt-2 p-2 rounded-md bg-muted/50">
                <p className="text-xs text-muted-foreground">
                  Con {puntiVendita.length} PDV, soglie effettive: {" "}
                  {(["S1", "S2", "S3", "S4", "S5"] as PistaEnergiaSoglia[]).map((s) => (
                    <span key={s} className="mr-2">{s === "S5" ? "S Extra" : s}={getPistaEnergiaSoglieEffettive(puntiVendita.length)[s]}</span>
                  ))}
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Legenda Pay Base */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Pay Base per Categoria</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Standard</p>
              <div className="flex flex-wrap gap-3">
                {ENERGIA_CATEGORY_LABELS.map((cat) => (
                  <Badge key={cat.value} variant="outline" className="text-sm py-1 px-3">
                    {cat.label}: {formatCurrency(ENERGIA_BASE_PAY[cat.value])}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">ex W3 L&G Powered by Acea (−50%)</p>
              <div className="flex flex-wrap gap-3">
                {ENERGIA_W3_CATEGORY_LABELS.map((cat) => (
                  <Badge key={cat.value} variant="outline" className="text-sm py-1 px-3 border-amber-300 text-amber-700">
                    {cat.label}: {formatCurrency(ENERGIA_BASE_PAY[cat.value])}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-3">
            + €15/contratto se la ragione sociale raggiunge {55 * (energiaConfig.pdvInGara || 1)} contratti totali
          </p>
        </CardContent>
      </Card>

      {/* Input Pezzi per PDV */}
      <div className="space-y-4">
        {puntiVendita.map((pdv) => {
          const result = getResultForPdv(pdv.id);
          const pdvGara = energiaPdvInGara.find((p) => p.pdvId === pdv.id);
          const isInGara = pdvGara?.isInGara || false;

          return (
            <Card key={pdv.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">{(pdv.nome || pdv.codicePos).toUpperCase()}</CardTitle>
                    {isInGara && <Badge variant="secondary">In gara</Badge>}
                  </div>
                  {result && (
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Premio: {formatCurrency(result.premioTotale)}</p>
                      {result.sogliaRaggiunta > 0 && (
                        <Badge variant="default">S{result.sogliaRaggiunta}</Badge>
                      )}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">Standard</p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {ENERGIA_CATEGORY_LABELS.map((cat) => (
                        <div key={cat.value}>
                          <Label className="text-xs">{cat.label}</Label>
                          <Input
                            type="number"
                            min={0}
                            value={getPezzi(pdv.id, cat.value) || ""}
                            onChange={(e) => handlePezziChange(pdv.id, cat.value, Number(e.target.value))}
                            placeholder="0"
                          />
                          <p className="text-xs text-muted-foreground">
                            = {formatCurrency(getPezzi(pdv.id, cat.value) * ENERGIA_BASE_PAY[cat.value])}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-amber-700 mb-2">ex W3 L&G Powered by Acea (−50%)</p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {ENERGIA_W3_CATEGORY_LABELS.map((cat) => (
                        <div key={cat.value}>
                          <Label className="text-xs">{cat.label}</Label>
                          <Input
                            type="number"
                            min={0}
                            value={getPezzi(pdv.id, cat.value) || ""}
                            onChange={(e) => handlePezziChange(pdv.id, cat.value, Number(e.target.value))}
                            placeholder="0"
                            className="border-amber-200"
                          />
                          <p className="text-xs text-muted-foreground">
                            = {formatCurrency(getPezzi(pdv.id, cat.value) * ENERGIA_BASE_PAY[cat.value])}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                
                {result && (
                  <>
                    <Separator className="my-3" />
                    <div className="flex flex-wrap gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Totale pezzi:</span>{" "}
                        <span className="font-medium">{result.totalePezzi}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Premio base:</span>{" "}
                        <span className="font-medium">{formatCurrency(result.premioBase)}</span>
                      </div>
                      {result.bonusRaggiungimentoSoglia > 0 && (
                        <div>
                          <span className="text-muted-foreground">Bonus +15€:</span>{" "}
                          <span className="font-medium text-green-600">{formatCurrency(result.bonusRaggiungimentoSoglia)}</span>
                        </div>
                      )}
                      {result.premioSoglia > 0 && (
                        <div>
                          <span className="text-muted-foreground">Premio soglia:</span>{" "}
                          <span className="font-medium text-green-600">{formatCurrency(result.premioSoglia)}</span>
                        </div>
                      )}
                      {result.pistaEnergia?.sogliaRaggiunta && (
                        <div>
                          <span className="text-muted-foreground">Pista {result.pistaEnergia.sogliaRaggiunta} (+{result.pistaEnergia.bonusPerContratto}€/c):</span>{" "}
                          <span className="font-medium text-green-600">{formatCurrency(result.pistaEnergia.bonusTotale)}</span>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
