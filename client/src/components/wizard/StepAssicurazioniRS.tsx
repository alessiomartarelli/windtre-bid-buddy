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
  ASSICURAZIONI_POINTS,
  ASSICURAZIONI_PREMIUMS,
  createEmptyAssicurazioniAttivato,
} from "@/types/assicurazioni";
import { formatCurrency } from "@/utils/format";
import { Shield, ChevronDown, ChevronUp, Building2, Store, Clock } from "lucide-react";
import { CalendarioMeseOverride, getWorkdayInfoFromOverrides } from "@/utils/calendario";
import { StepContentHeader } from "./StepContentHeader";

interface StepAssicurazioniRSProps {
  puntiVendita: PuntoVendita[];
  config: AssicurazioniConfig;
  onConfigChange: (config: AssicurazioniConfig) => void;
  attivatoByRS: Record<string, AssicurazioniAttivatoRiga>;
  setAttivatoByRS: React.Dispatch<React.SetStateAction<Record<string, AssicurazioniAttivatoRiga>>>;
  totalePremio: number;
  anno: number;
  monthIndex: number;
  calendarioOverrides: Record<string, CalendarioMeseOverride>;
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
  anno,
  monthIndex,
  calendarioOverrides,
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
          <p className="text-xs text-muted-foreground">Le soglie vengono moltiplicate per il numero di PDV di ciascuna Ragione Sociale</p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>PDV in Gara</Label>
              <Input
                type="number"
                value={puntiVendita.length}
                readOnly
                className="bg-muted"
              />
            </div>
            <div className="space-y-2">
              <Label>No Malus ({config.targetNoMalus || 0} × {puntiVendita.length})</Label>
              <Input
                type="number"
                value={(config.targetNoMalus || 0) * puntiVendita.length}
                readOnly
                className="bg-muted"
              />
            </div>
            <div className="space-y-2">
              <Label>S1 €500 ({config.targetS1 || 0} × {puntiVendita.length})</Label>
              <Input
                type="number"
                value={(config.targetS1 || 0) * puntiVendita.length}
                readOnly
                className="bg-muted"
              />
            </div>
            <div className="space-y-2">
              <Label>S2 €750 ({config.targetS2 || 0} × {puntiVendita.length})</Label>
              <Input
                type="number"
                value={(config.targetS2 || 0) * puntiVendita.length}
                readOnly
                className="bg-muted"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Input per RS */}
      <div className="space-y-4">
        {ragioneSocialeList.map((rs) => {
          const pdvList = ragioneSocialeGroups[rs];
          const numPdvRS = pdvList.length;
          const isOpen = openCards[rs] ?? true;
          const attivato = attivatoByRS[rs] || createEmptyAssicurazioniAttivato();

          let puntiBaseRS = 0;
          let gettoniRS = 0;
          for (const prodotto of PRODOTTI_STANDARD) {
            const pezzi = attivato[prodotto] || 0;
            puntiBaseRS += pezzi * ASSICURAZIONI_POINTS[prodotto];
            gettoniRS += pezzi * (ASSICURAZIONI_PREMIUMS[prodotto] ?? 0);
          }
          if (attivato.viaggioMondoPremio > 0) {
            puntiBaseRS += (attivato.viaggioMondoPremio / 100) * 1.5;
            gettoniRS += Math.min(attivato.viaggioMondoPremio * 0.125, 201) * (attivato.viaggioMondo || 1);
          }
          const effectiveS1 = (config.targetS1 || 0) * numPdvRS;
          const effectiveS2 = (config.targetS2 || 0) * numPdvRS;
          let puntiReloadEff = 0;
          if (puntiBaseRS >= effectiveS1 && attivato.reloadForever > 0) {
            const raw = Math.floor(attivato.reloadForever / 5);
            const max15 = Math.floor(puntiBaseRS * 0.15 / 0.85);
            puntiReloadEff = Math.min(raw, max15);
          }
          const puntiTotRS = puntiBaseRS + puntiReloadEff;
          const sogliaRaggiunta = puntiTotRS >= effectiveS2 ? "S2" : puntiBaseRS >= effectiveS1 ? "S1" : "nessuna";
          const premioSogliaRS = (puntiBaseRS >= effectiveS1 ? 500 * numPdvRS : 0) + (puntiTotRS >= effectiveS2 ? 750 * numPdvRS : 0);
          const premioTotaleRS = gettoniRS + premioSogliaRS;

          const avgWorkingDaysRS = pdvList.reduce((sum, pdv) => {
            const wi = getWorkdayInfoFromOverrides(anno, monthIndex, pdv.calendar, calendarioOverrides[pdv.id]);
            return sum + wi.totalWorkingDays;
          }, 0) / (pdvList.length || 1);
          const totalPezziRS_sum = Object.values(attivato).reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0);
          const runRatePezziRS = avgWorkingDaysRS > 0 ? totalPezziRS_sum / avgWorkingDaysRS : 0;
          const runRatePuntiRS = avgWorkingDaysRS > 0 ? puntiBaseRS / avgWorkingDaysRS : 0;

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
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span><Store className="w-3 h-3 inline" /> {numPdvRS} {numPdvRS === 1 ? 'negozio' : 'negozi'}</span>
                            <span>· {puntiBaseRS.toFixed(1)} punti</span>
                            {puntiReloadEff > 0 && <span>+ {puntiReloadEff} RF</span>}
                            <span>· S1: {effectiveS1} · S2: {effectiveS2}</span>
                            {gettoniRS > 0 && <span>· Gettoni: {formatCurrency(gettoniRS)}</span>}
                            {sogliaRaggiunta !== "nessuna" && (
                              <Badge variant="default" className="text-[10px] px-1.5 py-0">{sogliaRaggiunta} · Target: {formatCurrency(premioSogliaRS)}</Badge>
                            )}
                            {(gettoniRS > 0 || premioSogliaRS > 0) && (
                              <span className="font-semibold text-primary">Tot: {formatCurrency(premioTotaleRS)}</span>
                            )}
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
                    <div className="p-3 bg-secondary/10 rounded-lg border border-secondary/30" data-testid={`run-rate-assicurazioni-rs-${rs}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <Clock className="w-4 h-4 text-secondary-foreground" />
                        <p className="font-semibold text-sm text-secondary-foreground">Run Rate</p>
                      </div>
                      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                        <span>Pezzi/gg: <span className="font-medium text-foreground">{runRatePezziRS.toFixed(2)}</span></span>
                        <span>Punti/gg: <span className="font-medium text-foreground">{runRatePuntiRS.toFixed(2)}</span></span>
                        <span>Media gg lav: <span className="font-medium text-foreground">{avgWorkingDaysRS.toFixed(1)}</span></span>
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
