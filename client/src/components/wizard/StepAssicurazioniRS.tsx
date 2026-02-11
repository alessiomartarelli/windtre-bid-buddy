import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { PuntoVendita } from "@/types/preventivatore";
import {
  AssicurazioniConfig,
  AssicurazioniAttivatoRiga,
  ASSICURAZIONI_LABELS,
  createEmptyAssicurazioniAttivato,
} from "@/types/assicurazioni";
import { formatCurrency } from "@/utils/format";
import { Shield, ChevronDown, ChevronUp, Building2, Store } from "lucide-react";
import { StepContentHeader } from "./StepContentHeader";

interface StepAssicurazioniRSProps {
  puntiVendita: PuntoVendita[];
  config: AssicurazioniConfig;
  onConfigChange: (config: AssicurazioniConfig) => void;
  attivatoByRS: Record<string, AssicurazioniAttivatoRiga>;
  setAttivatoByRS: React.Dispatch<React.SetStateAction<Record<string, AssicurazioniAttivatoRiga>>>;
  totalePremio: number;
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

export const StepAssicurazioniRS: React.FC<StepAssicurazioniRSProps> = ({
  puntiVendita,
  config,
  onConfigChange,
  attivatoByRS,
  setAttivatoByRS,
  totalePremio,
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

  const handleConfigChange = (field: keyof AssicurazioniConfig, value: number) => {
    onConfigChange({ ...config, [field]: value });
  };

  const handleAttivatoChange = (rs: string, field: keyof AssicurazioniAttivatoRiga, value: number) => {
    const current = attivatoByRS[rs] || createEmptyAssicurazioniAttivato();
    setAttivatoByRS(prev => ({
      ...prev,
      [rs]: { ...current, [field]: value },
    }));
  };

  // Calcola totali
  const totalePezzi = ragioneSocialeList.reduce((sum, rs) => {
    const attivato = attivatoByRS[rs] || createEmptyAssicurazioniAttivato();
    return sum + Object.values(attivato).reduce((pSum, val) => pSum + (typeof val === 'number' ? val : 0), 0);
  }, 0);

  if (!puntiVendita.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <Shield className="w-8 h-8 text-muted-foreground" />
        </div>
        <p className="text-muted-foreground">Prima inserisci i punti vendita.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <StepContentHeader
        icon={Shield}
        title="Assicurazioni per Ragione Sociale"
        subtitle="Pezzi assicurativi aggregati per azienda"
        totalPremio={totalePremio}
        extraInfo={`${totalePezzi} pezzi totali · ${ragioneSocialeList.length} aziende`}
      />

      {/* Configurazione Target */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Target Assicurazioni RS</CardTitle>
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
              <p className="text-xs text-muted-foreground">Bonus: €500 per PDV</p>
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
              <p className="text-xs text-muted-foreground">Bonus: €750 per PDV</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Input per RS */}
      <div className="space-y-4">
        {ragioneSocialeList.map((rs) => {
          const pdvList = ragioneSocialeGroups[rs];
          const isOpen = openCards[rs] ?? true;
          const attivato = attivatoByRS[rs] || createEmptyAssicurazioniAttivato();

          return (
            <Collapsible key={rs} open={isOpen} onOpenChange={() => toggleCard(rs)}>
              <Card className="border-border/50 shadow-sm overflow-hidden transition-all hover:shadow-md">
                <CollapsibleTrigger asChild>
                  <CardHeader className="pb-3 cursor-pointer hover:bg-muted/30 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                          <Building2 className="w-5 h-5 text-green-600" />
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
                        {isOpen ? <ChevronUp className="w-5 h-5 text-muted-foreground" /> : <ChevronDown className="w-5 h-5 text-muted-foreground" />}
                      </div>
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <CardContent className="pt-0 space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                      {/* Prodotti standard */}
                      {PRODOTTI_STANDARD.map((prodotto) => (
                        <div key={prodotto} className="space-y-1">
                          <Label className="text-xs">{ASSICURAZIONI_LABELS[prodotto]}</Label>
                          <Input
                            type="number"
                            min={0}
                            value={attivato[prodotto]}
                            onChange={(e) => handleAttivatoChange(rs, prodotto, Number(e.target.value))}
                            className="h-8"
                          />
                        </div>
                      ))}
                      
                      {/* Viaggio Mondo */}
                      <div className="space-y-1">
                        <Label className="text-xs">Viaggio Mondo (pezzi)</Label>
                        <Input
                          type="number"
                          min={0}
                          value={attivato.viaggioMondo}
                          onChange={(e) => handleAttivatoChange(rs, 'viaggioMondo', Number(e.target.value))}
                          className="h-8"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Viaggio Mondo (€ premio)</Label>
                        <Input
                          type="number"
                          min={0}
                          value={attivato.viaggioMondoPremio}
                          onChange={(e) => handleAttivatoChange(rs, 'viaggioMondoPremio', Number(e.target.value))}
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
                          onChange={(e) => handleAttivatoChange(rs, 'reloadForever', Number(e.target.value))}
                          className="h-8"
                        />
                        <p className="text-[10px] text-muted-foreground">1 punto ogni 5 eventi</p>
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
