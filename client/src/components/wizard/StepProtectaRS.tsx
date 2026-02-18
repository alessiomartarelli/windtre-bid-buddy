import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { PuntoVendita } from "@/types/preventivatore";
import {
  ProtectaAttivatoRiga,
  ProtectaProduct,
  PROTECTA_GETTONI,
  PROTECTA_LABELS,
  PROTECTA_PRODUCTS_CASA,
  PROTECTA_PRODUCTS_NEGOZIO,
  createEmptyProtectaAttivato,
} from "@/types/protecta";
import { formatCurrency } from "@/utils/format";
import { Lock, ChevronDown, ChevronUp, Building2, Store, Home, Zap, Clock } from "lucide-react";
import { CalendarioMeseOverride, getWorkdayInfoFromOverrides } from "@/utils/calendario";
import { StepContentHeader } from "./StepContentHeader";

interface StepProtectaRSProps {
  puntiVendita: PuntoVendita[];
  attivatoByRS: Record<string, ProtectaAttivatoRiga>;
  setAttivatoByRS: React.Dispatch<React.SetStateAction<Record<string, ProtectaAttivatoRiga>>>;
  totalePremio: number;
  anno: number;
  monthIndex: number;
  calendarioOverrides: Record<string, CalendarioMeseOverride>;
}

export const StepProtectaRS: React.FC<StepProtectaRSProps> = ({
  puntiVendita,
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

  const handleChange = (rs: string, field: ProtectaProduct, value: number) => {
    setAttivatoByRS(prev => ({
      ...prev,
      [rs]: {
        ...(prev[rs] || createEmptyProtectaAttivato()),
        [field]: Math.max(0, value),
      },
    }));
  };

  // Calcola totali
  const totalePezzi = ragioneSocialeList.reduce((sum, rs) => {
    const attivato = attivatoByRS[rs] || createEmptyProtectaAttivato();
    return sum + (Object.keys(PROTECTA_GETTONI) as ProtectaProduct[]).reduce((pSum, key) => pSum + attivato[key], 0);
  }, 0);

  if (!puntiVendita.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <Lock className="w-8 h-8 text-muted-foreground" />
        </div>
        <p className="text-muted-foreground">Prima inserisci i punti vendita.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <StepContentHeader
        icon={Lock}
        title="Protecta per Ragione Sociale"
        subtitle="Sistemi di Allarme aggregati per azienda"
        totalPremio={totalePremio}
        extraInfo={`${totalePezzi} pezzi totali · ${ragioneSocialeList.length} aziende`}
      />

      <div className="space-y-4">
        {ragioneSocialeList.map((rs) => {
          const pdvList = ragioneSocialeGroups[rs];
          const isOpen = openCards[rs] ?? true;
          const attivato = attivatoByRS[rs] || createEmptyProtectaAttivato();
          
          // Calcola premio RS
          const premioRS = (Object.keys(PROTECTA_GETTONI) as ProtectaProduct[]).reduce(
            (sum, key) => sum + attivato[key] * PROTECTA_GETTONI[key],
            0
          );

          const avgWorkingDaysRS = pdvList.reduce((sum, pdv) => {
            const wi = getWorkdayInfoFromOverrides(anno, monthIndex, pdv.calendar, calendarioOverrides[pdv.id]);
            return sum + wi.totalWorkingDays;
          }, 0) / (pdvList.length || 1);
          const totalPezziRS = (Object.keys(PROTECTA_GETTONI) as ProtectaProduct[]).reduce((s, k) => s + attivato[k], 0);
          const runRatePezziRS = avgWorkingDaysRS > 0 ? totalPezziRS / avgWorkingDaysRS : 0;

          return (
            <Collapsible key={rs} open={isOpen} onOpenChange={() => toggleCard(rs)}>
              <Card className="border-border/50 shadow-sm overflow-hidden transition-all hover:shadow-md">
                <CollapsibleTrigger asChild>
                  <CardHeader className="pb-3 cursor-pointer hover:bg-muted/30 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                          <Building2 className="w-5 h-5 text-purple-600" />
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
                          <p className="font-semibold text-primary">{formatCurrency(premioRS)}</p>
                        </div>
                        {isOpen ? <ChevronUp className="w-5 h-5 text-muted-foreground" /> : <ChevronDown className="w-5 h-5 text-muted-foreground" />}
                      </div>
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <CardContent className="pt-0 space-y-4">
                    {/* Sezione Casa */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <Home className="h-4 w-4" />
                        <span>Allarmi Casa</span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {PROTECTA_PRODUCTS_CASA.map((product) => (
                          <div key={product} className="space-y-1">
                            <Label htmlFor={`${rs}-${product}`} className="text-xs">
                              {PROTECTA_LABELS[product]}
                              <span className="text-muted-foreground ml-1">
                                ({formatCurrency(PROTECTA_GETTONI[product])})
                              </span>
                            </Label>
                            <Input
                              id={`${rs}-${product}`}
                              type="number"
                              min={0}
                              value={attivato[product] || ''}
                              onChange={(e) => handleChange(rs, product, parseInt(e.target.value) || 0)}
                              placeholder="0"
                              className="h-9"
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Sezione Negozio */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <Store className="h-4 w-4" />
                        <span>Allarmi Negozio</span>
                        <Badge variant="outline" className="ml-2 text-xs">
                          <Zap className="h-3 w-3 mr-1" />
                          Extra Gara P.IVA 5pt
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        {PROTECTA_PRODUCTS_NEGOZIO.map((product) => (
                          <div key={product} className="space-y-1">
                            <Label htmlFor={`${rs}-${product}`} className="text-xs">
                              {PROTECTA_LABELS[product]}
                              <span className="text-muted-foreground ml-1">
                                ({formatCurrency(PROTECTA_GETTONI[product])})
                              </span>
                            </Label>
                            <Input
                              id={`${rs}-${product}`}
                              type="number"
                              min={0}
                              value={attivato[product] || ''}
                              onChange={(e) => handleChange(rs, product, parseInt(e.target.value) || 0)}
                              placeholder="0"
                              className="h-9"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="p-3 bg-secondary/10 rounded-lg border border-secondary/30" data-testid={`run-rate-protecta-rs-${rs}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <Clock className="w-4 h-4 text-secondary-foreground" />
                        <p className="font-semibold text-sm text-secondary-foreground">Run Rate</p>
                      </div>
                      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                        <span>Pezzi/gg: <span className="font-medium text-foreground">{runRatePezziRS.toFixed(2)}</span></span>
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

      {/* Totale */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-primary" />
              <span className="font-medium">Totale Premio Protecta RS</span>
            </div>
            <span className="text-2xl font-bold text-primary">
              {formatCurrency(totalePremio)}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
