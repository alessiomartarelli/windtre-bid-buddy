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
import { Gift, ChevronDown, ChevronUp, Building2, Store, Clock } from "lucide-react";
import { CalendarioMeseOverride, getWorkdayInfoFromOverrides } from "@/utils/calendario";
import { StepContentHeader } from "./StepContentHeader";

interface StepPartnershipRewardRSProps {
  puntiVendita: PuntoVendita[];
  partnershipRewardRSConfig: PartnershipRewardRSConfig;
  anno: number;
  monthIndex: number;
  calendarioOverrides: Record<string, CalendarioMeseOverride>;
  attivatoCBByRS: Record<string, AttivatoCBDettaglio[]>;
  setAttivatoCBByRS: React.Dispatch<React.SetStateAction<Record<string, AttivatoCBDettaglio[]>>>;
  totalePremioPartnershipPrevisto: number;
}

export const StepPartnershipRewardRS: React.FC<StepPartnershipRewardRSProps> = ({
  puntiVendita,
  partnershipRewardRSConfig,
  anno,
  monthIndex,
  calendarioOverrides,
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

  const aggregatiRS = ragioneSocialeList.map((rs) => {
    const righe = attivatoCBByRS[rs] ?? [];
    const gettoni = righe.reduce((s, r) => s + (r.pezzi * (r.gettoni || 0)), 0);
    const punti = righe.reduce((s, r) => s + (r.pezzi * (r.puntiPartnership || 0)), 0);
    const config = partnershipRewardRSConfig.configPerRS.find(c => c.ragioneSociale === rs);
    const target100 = config?.target100 || 0;
    const target80 = config?.target80 || 0;
    const premio100 = config?.premio100 || 0;
    const premio80 = config?.premio80 || 0;
    let premioTarget = 0;
    if (target100 > 0 && punti >= target100) {
      premioTarget = premio100;
    } else if (target80 > 0 && punti >= target80) {
      premioTarget = premio80;
    }
    return { gettoni, punti, premioTarget, premioTotale: gettoni + premioTarget };
  });

  const totaleGettoniGlobale = aggregatiRS.reduce((s, a) => s + a.gettoni, 0);
  const totalePremioTargetGlobale = aggregatiRS.reduce((s, a) => s + a.premioTarget, 0);
  const totalePremioCalcolato = totaleGettoniGlobale + totalePremioTargetGlobale;

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
        totalPremio={totalePremioCalcolato}
        extraInfo={`${totalePezzi} pezzi · ${totalePuntiInseriti.toFixed(2)} punti · Gettoni: ${formatCurrency(totaleGettoniGlobale)} · PR: ${formatCurrency(totalePremioTargetGlobale)} · ${ragioneSocialeList.length} aziende`}
      />

      <div className="space-y-4">
        {ragioneSocialeList.map((rs) => {
          const pdvList = ragioneSocialeGroups[rs];
          const isOpen = openCards[rs] ?? true;
          const config = partnershipRewardRSConfig.configPerRS.find(c => c.ragioneSociale === rs);
          const totalPezziRS = (attivatoCBByRS[rs] ?? []).reduce((sum, r) => sum + r.pezzi, 0);

          const righeRS = attivatoCBByRS[rs] ?? [];
          const totaleGettoniRS = righeRS.reduce((sum, r) => sum + (r.pezzi * (r.gettoni || 0)), 0);
          const totalePuntiRS = righeRS.reduce((sum, r) => sum + (r.pezzi * (r.puntiPartnership || 0)), 0);

          const avgWorkingDaysRS = pdvList.reduce((sum, pdv) => {
            const wi = getWorkdayInfoFromOverrides(anno, monthIndex, pdv.calendar, calendarioOverrides[pdv.id]);
            return sum + wi.totalWorkingDays;
          }, 0) / (pdvList.length || 1);
          const runRatePuntiRS = avgWorkingDaysRS > 0 ? totalePuntiRS / avgWorkingDaysRS : 0;
          const runRatePezziRS = avgWorkingDaysRS > 0 ? totalPezziRS / avgWorkingDaysRS : 0;

          const target100 = config?.target100 || 0;
          const target80 = config?.target80 || 0;
          const premio100 = config?.premio100 || 0;
          const premio80 = config?.premio80 || 0;
          const percentualeTarget = target100 > 0 ? (totalePuntiRS / target100) * 100 : 0;
          let premioTargetRS = 0;
          let targetRaggiuntoRS: string = 'Nessuno';
          if (target100 > 0 && totalePuntiRS >= target100) {
            targetRaggiuntoRS = '100%';
            premioTargetRS = premio100;
          } else if (target80 > 0 && totalePuntiRS >= target80) {
            targetRaggiuntoRS = '80%';
            premioTargetRS = premio80;
          }
          const premioTotaleRS = premioTargetRS + totaleGettoniRS;

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
                                · Target: {totalePuntiRS.toFixed(2)}/{config.target100} ({percentualeTarget.toFixed(1)}%)
                              </span>
                            )}
                            {totalPezziRS > 0 && targetRaggiuntoRS !== 'Nessuno' && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{targetRaggiuntoRS}</Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right hidden sm:block space-y-0.5">
                          <p className="font-semibold text-primary">{totalPezziRS} pezzi</p>
                          {totalPezziRS > 0 && (
                            <>
                              <p className="text-xs text-muted-foreground">
                                Gettoni: {formatCurrency(totaleGettoniRS)} · PR: {formatCurrency(premioTargetRS)}
                              </p>
                              <p className="text-xs font-medium">
                                Totale: {formatCurrency(premioTotaleRS)}
                              </p>
                            </>
                          )}
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

                    <div data-testid={`run-rate-partnership-rs-${rs}`} className="p-3 bg-secondary/10 rounded-lg border border-secondary/30">
                      <div className="flex items-center gap-2 mb-1">
                        <Clock className="w-4 h-4 text-secondary-foreground" />
                        <p className="font-semibold text-sm text-secondary-foreground">Run Rate</p>
                      </div>
                      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                        <span>Punti/gg: <span className="font-medium text-foreground">{runRatePuntiRS.toFixed(2)}</span></span>
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
    </div>
  );
};
