import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { PuntoVendita, PartnershipRewardRSConfig } from "@/types/preventivatore";
import { 
  AttivatoCBDettaglio, 
  CB_EVENTS_CONFIG, 
  CAMBIO_OFFERTA_UNTIED_CLUSTERS, 
  CAMBIO_OFFERTA_RIVINCOLI_CLUSTERS,
  TELEFONO_INCLUSO_OPTIONS,
} from "@/types/partnership-cb-events";
import { formatCurrency } from "@/utils/format";
import { Gift, ChevronDown, ChevronUp, Building2, Store } from "lucide-react";
import { StepContentHeader } from "./StepContentHeader";

interface StepPartnershipRewardRSProps {
  puntiVendita: PuntoVendita[];
  partnershipRewardRSConfig: PartnershipRewardRSConfig;
  attivatoCBByRS: Record<string, AttivatoCBDettaglio[]>;
  setAttivatoCBByRS: React.Dispatch<React.SetStateAction<Record<string, AttivatoCBDettaglio[]>>>;
  totalePremioPartnershipPrevisto: number;
}

export const StepPartnershipRewardRS: React.FC<StepPartnershipRewardRSProps> = ({
  puntiVendita,
  partnershipRewardRSConfig,
  attivatoCBByRS,
  setAttivatoCBByRS,
  totalePremioPartnershipPrevisto,
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

  const handlePezziChange = (rs: string, eventType: string, cluster: string | undefined, value: string) => {
    const pezzi = parseInt(value) || 0;
    
    setAttivatoCBByRS(prev => {
      const current = prev[rs] || [];
      const existingIndex = current.findIndex(e => 
        e.eventType === eventType && 
        (cluster ? e.clusterCard === cluster : !e.clusterCard || e.clusterCard === '')
      );
      
      if (existingIndex >= 0) {
        const updated = [...current];
        updated[existingIndex] = { ...updated[existingIndex], pezzi };
        return { ...prev, [rs]: updated };
      } else {
        let gettoni = 0;
        let puntiPartnership = 0;
        if (cluster) {
          if (eventType === 'cambio_offerta_untied') {
            const config = CAMBIO_OFFERTA_UNTIED_CLUSTERS.find(c => c.cluster === cluster);
            gettoni = config?.gettoni || 0;
            puntiPartnership = config?.puntiPartnership || 0;
          } else if (eventType === 'cambio_offerta_rivincoli') {
            const config = CAMBIO_OFFERTA_RIVINCOLI_CLUSTERS.find(c => c.cluster === cluster);
            gettoni = config?.gettoni || 0;
            puntiPartnership = config?.puntiPartnership || 0;
          } else if (eventType === 'telefono_incluso_var') {
            const config = TELEFONO_INCLUSO_OPTIONS.find(o => o.option === cluster);
            gettoni = config?.gettoni || 0;
            puntiPartnership = config?.puntiPartnership || 0;
          }
        } else {
          const eventConfig = CB_EVENTS_CONFIG.find(e => e.type === eventType);
          gettoni = eventConfig?.gettoni || 0;
          puntiPartnership = 0;
        }
        
        return {
          ...prev,
          [rs]: [...current, {
            eventType: eventType as any,
            pezzi,
            gettoni,
            puntiPartnership,
            clusterCard: cluster,
          }]
        };
      }
    });
  };

  const getPezzi = (rs: string, eventType: string, cluster: string | undefined): number => {
    const attivato = attivatoCBByRS[rs] || [];
    const evento = attivato.find(e => 
      e.eventType === eventType && 
      (cluster ? e.clusterCard === cluster : !e.clusterCard || e.clusterCard === '')
    );
    return evento?.pezzi || 0;
  };

  // Calcola totali
  const totalePezzi = ragioneSocialeList.reduce((sum, rs) => {
    const righe = attivatoCBByRS[rs] ?? [];
    return sum + righe.reduce((pSum, riga) => pSum + riga.pezzi, 0);
  }, 0);

  // Calcola i punti inseriti direttamente dagli input
  const totalePuntiInseriti = ragioneSocialeList.reduce((sum, rs) => {
    const righe = attivatoCBByRS[rs] ?? [];
    return sum + righe.reduce((pSum, riga) => pSum + (riga.puntiPartnership * riga.pezzi), 0);
  }, 0);

  if (!puntiVendita.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <Gift className="w-8 h-8 text-muted-foreground" />
        </div>
        <p className="text-muted-foreground">Prima inserisci i punti vendita.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <StepContentHeader
        icon={Gift}
        title="Partnership Reward per Ragione Sociale"
        subtitle="Customer Base Eventi aggregati per azienda"
        totalPremio={totalePremioPartnershipPrevisto}
        extraInfo={`${totalePezzi} pezzi · ${totalePuntiInseriti.toFixed(2)} punti inseriti · ${ragioneSocialeList.length} aziende`}
      />

      <div className="space-y-4">
        {ragioneSocialeList.map((rs) => {
          const pdvList = ragioneSocialeGroups[rs];
          const isOpen = openCards[rs] ?? true;
          const config = partnershipRewardRSConfig.configPerRS.find(c => c.ragioneSociale === rs);
          const totalPezziRS = (attivatoCBByRS[rs] ?? []).reduce((sum, r) => sum + r.pezzi, 0);

          return (
            <Collapsible key={rs} open={isOpen} onOpenChange={() => toggleCard(rs)}>
              <Card className="border-border/50 shadow-sm overflow-hidden transition-all hover:shadow-md">
                <CollapsibleTrigger asChild>
                  <CardHeader className="pb-3 cursor-pointer hover:bg-muted/30 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
                          <Building2 className="w-5 h-5 text-orange-500" />
                        </div>
                        <div>
                          <CardTitle className="text-base">{rs}</CardTitle>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Store className="w-3 h-3" />
                            <span>{pdvList.length} {pdvList.length === 1 ? 'negozio' : 'negozi'}</span>
                            {config && (
                              <span className="text-muted-foreground/70">
                                · Target 100%: {config.target100}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right hidden sm:block">
                          <p className="font-semibold text-primary">{totalPezziRS} pezzi</p>
                        </div>
                        {isOpen ? <ChevronUp className="w-5 h-5 text-muted-foreground" /> : <ChevronDown className="w-5 h-5 text-muted-foreground" />}
                      </div>
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <CardContent className="pt-0 space-y-6">
                    {/* Customer Base Eventi */}
                    <div className="space-y-3">
                      <Badge variant="secondary" className="bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300">
                        Customer Base Eventi
                      </Badge>
                      
                      {/* Cambio Offerta Untied */}
                      <div className="space-y-2">
                        <Label className="text-xs font-semibold">Cambio Offerta MIA UNTIED / MIA CYC UNTIED</Label>
                        <div className="grid gap-2">
                          {CAMBIO_OFFERTA_UNTIED_CLUSTERS.map(cluster => (
                            <div key={cluster.cluster} className="grid grid-cols-4 gap-2 items-end">
                              <div className="col-span-2">
                                <p className="text-xs">{cluster.cluster}</p>
                                <p className="text-[10px] text-muted-foreground">{cluster.gettoni}€ | {cluster.puntiPartnership} punti</p>
                              </div>
                              <div>
                                <Input
                                  type="number"
                                  min="0"
                                  value={getPezzi(rs, 'cambio_offerta_untied', cluster.cluster) || ''}
                                  onChange={(e) => handlePezziChange(rs, 'cambio_offerta_untied', cluster.cluster, e.target.value)}
                                  className="h-8 text-xs"
                                  placeholder="0"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Cambio Offerta Rivincoli */}
                      <div className="space-y-2">
                        <Label className="text-xs font-semibold">Cambio Offerta Rivincoli Easy Pay / CYC Easy Pay</Label>
                        <div className="grid gap-2">
                          {CAMBIO_OFFERTA_RIVINCOLI_CLUSTERS.map(cluster => (
                            <div key={cluster.cluster} className="grid grid-cols-4 gap-2 items-end">
                              <div className="col-span-2">
                                <p className="text-xs">{cluster.cluster}</p>
                                <p className="text-[10px] text-muted-foreground">{cluster.gettoni}€ | {cluster.puntiPartnership} punti</p>
                              </div>
                              <div>
                                <Input
                                  type="number"
                                  min="0"
                                  value={getPezzi(rs, 'cambio_offerta_rivincoli', cluster.cluster) || ''}
                                  onChange={(e) => handlePezziChange(rs, 'cambio_offerta_rivincoli', cluster.cluster, e.target.value)}
                                  className="h-8 text-xs"
                                  placeholder="0"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Telefono Incluso */}
                      <div className="space-y-2">
                        <Label className="text-xs font-semibold">Telefono Incluso Offerta MIA Smart Pack</Label>
                        <div className="grid gap-2">
                          {TELEFONO_INCLUSO_OPTIONS.map(option => (
                            <div key={option.option} className="grid grid-cols-4 gap-2 items-end">
                              <div className="col-span-2">
                                <p className="text-xs">{option.label}</p>
                                <p className="text-[10px] text-muted-foreground">{option.gettoni}€ | {option.puntiPartnership} punti</p>
                              </div>
                              <div>
                                <Input
                                  type="number"
                                  min="0"
                                  value={getPezzi(rs, 'telefono_incluso_var', option.option) || ''}
                                  onChange={(e) => handlePezziChange(rs, 'telefono_incluso_var', option.option, e.target.value)}
                                  className="h-8 text-xs"
                                  placeholder="0"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Altri eventi customer base */}
                      {CB_EVENTS_CONFIG.filter(e => e.category === 'customer_base' && !['cambio_offerta_untied', 'cambio_offerta_rivincoli', 'telefono_incluso_var'].includes(e.type)).map(event => (
                        <div key={event.type} className="grid grid-cols-4 gap-2 items-end">
                          <div className="col-span-2">
                            <Label className="text-xs">{event.label}</Label>
                            {event.clusterCard && (
                              <p className="text-[10px] text-muted-foreground">{event.clusterCard} - {event.gettoni}€</p>
                            )}
                          </div>
                          <div>
                            <Input
                              type="number"
                              min="0"
                              value={getPezzi(rs, event.type, undefined) || ''}
                              onChange={(e) => handlePezziChange(rs, event.type, undefined, e.target.value)}
                              className="h-8 text-xs"
                              placeholder="0"
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Altri Eventi FISSO */}
                    <div className="space-y-3">
                      <Badge variant="secondary" className="bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300">
                        Altri Eventi - FISSO
                      </Badge>
                      <div className="grid gap-2">
                        {CB_EVENTS_CONFIG.filter(e => e.category === 'fisso_flat').map(event => (
                          <div key={event.type} className="grid grid-cols-4 gap-2 items-end">
                            <div className="col-span-2">
                              <Label className="text-xs">{event.label}</Label>
                              <p className="text-[10px] text-muted-foreground">{event.gettoni}€</p>
                            </div>
                            <div>
                              <Input
                                type="number"
                                min="0"
                                value={getPezzi(rs, event.type, undefined) || ''}
                                onChange={(e) => handlePezziChange(rs, event.type, undefined, e.target.value)}
                                className="h-8 text-xs"
                                placeholder="0"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Altri Eventi MOBILE */}
                    <div className="space-y-3">
                      <Badge variant="secondary" className="bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300">
                        Altri Eventi - MOBILE
                      </Badge>
                      <div className="grid gap-2">
                        {CB_EVENTS_CONFIG.filter(e => e.category === 'mobile_flat').map(event => (
                          <div key={event.type} className="grid grid-cols-4 gap-2 items-end">
                            <div className="col-span-2">
                              <Label className="text-xs">{event.label}</Label>
                              <p className="text-[10px] text-muted-foreground">{event.gettoni}€</p>
                            </div>
                            <div>
                              <Input
                                type="number"
                                min="0"
                                value={getPezzi(rs, event.type, undefined) || ''}
                                onChange={(e) => handlePezziChange(rs, event.type, undefined, e.target.value)}
                                className="h-8 text-xs"
                                placeholder="0"
                              />
                            </div>
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
