import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { PuntoVendita } from "@/types/preventivatore";
import {
  EnergiaConfig,
  EnergiaAttivatoRiga,
  EnergiaCategory,
  ENERGIA_CATEGORY_LABELS,
  ENERGIA_W3_CATEGORY_LABELS,
  ENERGIA_BASE_PAY,
} from "@/types/energia";
import { formatCurrency } from "@/utils/format";
import { Zap, ChevronDown, ChevronUp, Building2, Store } from "lucide-react";
import { StepContentHeader } from "./StepContentHeader";

interface StepEnergiaRSProps {
  puntiVendita: PuntoVendita[];
  energiaConfig: EnergiaConfig;
  setEnergiaConfig: React.Dispatch<React.SetStateAction<EnergiaConfig>>;
  attivatoEnergiaByRS: Record<string, EnergiaAttivatoRiga[]>;
  setAttivatoEnergiaByRS: React.Dispatch<React.SetStateAction<Record<string, EnergiaAttivatoRiga[]>>>;
  totalePremioEnergia: number;
}

export const StepEnergiaRS: React.FC<StepEnergiaRSProps> = ({
  puntiVendita,
  energiaConfig,
  setEnergiaConfig,
  attivatoEnergiaByRS,
  setAttivatoEnergiaByRS,
  totalePremioEnergia,
}) => {
  const [openCards, setOpenCards] = React.useState<Record<string, boolean>>({});

  // Raggruppa PDV per Ragione Sociale
  const ragioneSocialeGroups = React.useMemo(() => {
    const groups: Record<string, PuntoVendita[]> = {};
    puntiVendita.forEach(pdv => {
      const rs = pdv.ragioneSociale || "Senza RS";
      if (!groups[rs]) groups[rs] = [];
      groups[rs].push(pdv);
    });
    return groups;
  }, [puntiVendita]);

  const ragioneSocialeList = Object.keys(ragioneSocialeGroups).sort();

  const toggleCard = (rs: string) => {
    setOpenCards(prev => ({ ...prev, [rs]: !prev[rs] }));
  };

  const handleConfigChange = (field: keyof EnergiaConfig, value: number) => {
    setEnergiaConfig((prev) => ({ ...prev, [field]: value }));
  };

  const handlePezziChange = (rs: string, category: EnergiaCategory, pezzi: number) => {
    setAttivatoEnergiaByRS((prev) => {
      const existing = prev[rs] || [];
      const idx = existing.findIndex((r) => r.category === category);
      
      if (idx >= 0) {
        const updated = [...existing];
        updated[idx] = { ...updated[idx], pezzi };
        return { ...prev, [rs]: updated };
      } else {
        return {
          ...prev,
          [rs]: [...existing, { id: `${rs}-${category}`, category, pezzi }],
        };
      }
    });
  };

  const getPezzi = (rs: string, category: EnergiaCategory): number => {
    const righe = attivatoEnergiaByRS[rs] || [];
    return righe.find((r) => r.category === category)?.pezzi || 0;
  };

  // Calcola totali
  const totalePezzi = ragioneSocialeList.reduce((sum, rs) => {
    const righe = attivatoEnergiaByRS[rs] ?? [];
    return sum + righe.reduce((pSum, riga) => pSum + riga.pezzi, 0);
  }, 0);

  if (!puntiVendita.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <Zap className="w-8 h-8 text-muted-foreground" />
        </div>
        <p className="text-muted-foreground">Prima inserisci i punti vendita.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <StepContentHeader
        icon={Zap}
        title="Energia per Ragione Sociale"
        subtitle="Contratti Luce & Gas aggregati per azienda"
        totalPremio={totalePremioEnergia}
        extraInfo={`${totalePezzi} contratti totali · ${ragioneSocialeList.length} aziende`}
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
              <p className="text-xs font-medium text-amber-700 mb-2">ex W3 L&G Powered by Acea (−50%)</p>
              <div className="flex flex-wrap gap-3">
                {ENERGIA_W3_CATEGORY_LABELS.map((cat) => (
                  <Badge key={cat.value} variant="outline" className="text-sm py-1 px-3 border-amber-300 text-amber-700">
                    {cat.label}: {formatCurrency(ENERGIA_BASE_PAY[cat.value])}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Input per RS */}
      <div className="space-y-4">
        {ragioneSocialeList.map((rs) => {
          const pdvList = ragioneSocialeGroups[rs];
          const isOpen = openCards[rs] ?? true;
          const righe = attivatoEnergiaByRS[rs] ?? [];
          const totalPezziRS = righe.reduce((sum, r) => sum + r.pezzi, 0);
          const premioBaseRS = righe.reduce((sum, r) => sum + r.pezzi * ENERGIA_BASE_PAY[r.category], 0);

          return (
            <Collapsible key={rs} open={isOpen} onOpenChange={() => toggleCard(rs)}>
              <Card className="border-border/50 shadow-sm overflow-hidden transition-all hover:shadow-md">
                <CollapsibleTrigger asChild>
                  <CardHeader className="pb-3 cursor-pointer hover:bg-muted/30 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-yellow-500/10 flex items-center justify-center">
                          <Building2 className="w-5 h-5 text-yellow-600" />
                        </div>
                        <div>
                          <CardTitle className="text-base">{rs}</CardTitle>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Store className="w-3 h-3" />
                            <span>{pdvList.length} {pdvList.length === 1 ? 'negozio' : 'negozi'}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right hidden sm:block">
                          <p className="font-semibold text-primary">{totalPezziRS} contratti</p>
                          <p className="text-xs text-muted-foreground">{formatCurrency(premioBaseRS)}</p>
                        </div>
                        {isOpen ? <ChevronUp className="w-5 h-5 text-muted-foreground" /> : <ChevronDown className="w-5 h-5 text-muted-foreground" />}
                      </div>
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <CardContent className="pt-0 space-y-4">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">Standard</p>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {ENERGIA_CATEGORY_LABELS.map((cat) => (
                          <div key={cat.value}>
                            <Label className="text-xs">{cat.label}</Label>
                            <Input
                              type="number"
                              min={0}
                              value={getPezzi(rs, cat.value) || ""}
                              onChange={(e) => handlePezziChange(rs, cat.value, Number(e.target.value))}
                              placeholder="0"
                            />
                            <p className="text-xs text-muted-foreground">
                              = {formatCurrency(getPezzi(rs, cat.value) * ENERGIA_BASE_PAY[cat.value])}
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
                              value={getPezzi(rs, cat.value) || ""}
                              onChange={(e) => handlePezziChange(rs, cat.value, Number(e.target.value))}
                              placeholder="0"
                              className="border-amber-200"
                            />
                            <p className="text-xs text-muted-foreground">
                              = {formatCurrency(getPezzi(rs, cat.value) * ENERGIA_BASE_PAY[cat.value])}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
};
