import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PuntoVendita } from "@/types/preventivatore";
import { PartnershipRewardPosConfig } from "@/types/partnership-reward";
import { 
  AttivatoCBDettaglio, 
  CB_EVENTS_CONFIG, 
  CAMBIO_OFFERTA_UNTIED_CLUSTERS, 
  CAMBIO_OFFERTA_RIVINCOLI_CLUSTERS,
  TELEFONO_INCLUSO_OPTIONS,
  CalcoloPartnershipRewardResult 
} from "@/types/partnership-cb-events";
import { formatCurrency } from "@/utils/format";
import { Gift } from "lucide-react";
import { StepContentHeader } from "./StepContentHeader";

interface StepPartnershipRewardProps {
  puntiVendita: PuntoVendita[];
  partnershipRewardConfig: { configPerPos: PartnershipRewardPosConfig[] };
  attivatoCBByPos: Record<string, AttivatoCBDettaglio[]>;
  setAttivatoCBByPos: React.Dispatch<React.SetStateAction<Record<string, AttivatoCBDettaglio[]>>>;
  partnershipResults: Array<{
    pdv: PuntoVendita;
    conf: PartnershipRewardPosConfig;
    result: CalcoloPartnershipRewardResult;
  }>;
  totalePremioPartnershipPrevisto: number;
  anno: number;
  monthIndex: number;
}

export const StepPartnershipReward = ({
  puntiVendita,
  partnershipRewardConfig,
  attivatoCBByPos,
  setAttivatoCBByPos,
  partnershipResults,
  totalePremioPartnershipPrevisto,
}: StepPartnershipRewardProps) => {

  const handlePezziChange = (pdvId: string, eventType: string, cluster: string | undefined, value: string) => {
    const pezzi = parseInt(value) || 0;
    
    setAttivatoCBByPos(prev => {
      const current = prev[pdvId] || [];
      const existingIndex = current.findIndex(e => 
        e.eventType === eventType && 
        (cluster ? e.clusterCard === cluster : !e.clusterCard || e.clusterCard === '')
      );
      
      if (existingIndex >= 0) {
        const updated = [...current];
        updated[existingIndex] = { ...updated[existingIndex], pezzi };
        return { ...prev, [pdvId]: updated };
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
          [pdvId]: [...current, {
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

  const getPezzi = (pdvId: string, eventType: string, cluster: string | undefined): number => {
    const attivato = attivatoCBByPos[pdvId] || [];
    const evento = attivato.find(e => 
      e.eventType === eventType && 
      (cluster ? e.clusterCard === cluster : !e.clusterCard || e.clusterCard === '')
    );
    return evento?.pezzi || 0;
  };

  const totaleGettoni = partnershipResults.reduce((sum, r) => sum + (r.result.totaleGettoni || 0), 0);
  const totalePezzi = partnershipResults.reduce((sum, r) => sum + (r.result.totalePezzi || 0), 0);
  const totalePunti = partnershipResults.reduce((sum, r) => sum + (r.result.punti || 0), 0);
  const totalePremio = partnershipResults.reduce((sum, r) => sum + (r.result.premioMaturato || 0), 0);
  
  // Calcola i punti inseriti direttamente dagli input
  const totalePuntiInseriti = Object.values(attivatoCBByPos).reduce((sum, eventi) => {
    return sum + eventi.reduce((evSum, ev) => evSum + (ev.puntiPartnership * ev.pezzi), 0);
  }, 0);

  if (!puntiVendita.length) {
    return <p className="text-sm text-muted-foreground">Prima inserisci i punti vendita.</p>;
  }

  return (
    <div className="space-y-6">
      {/* Header con totale */}
      <StepContentHeader
        icon={Gift}
        title="Partnership Reward"
        subtitle="Customer Base Eventi e Remunerazione Flat"
        totalPremio={totalePremio}
        extraInfo={`${totalePezzi} pezzi · ${totalePuntiInseriti.toFixed(2)} punti inseriti · Gettoni: ${formatCurrency(totaleGettoni)}`}
      />

      {puntiVendita.map((pdv, pdvIndex) => {
        const config = partnershipRewardConfig.configPerPos[pdvIndex];
        if (!config) return null;
        const result = partnershipResults.find(r => r.pdv.id === pdv.id)?.result;

        return (
          <Card key={pdv.id} className="border-2">
            <CardHeader className="pb-3 bg-muted/50">
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-base">{pdv.codicePos} - {pdv.nome}</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">Target 100%: {config.config.target100} | Target 80%: {config.config.target80}</p>
                </div>
                {result && (
                  <div className="text-right space-y-1">
                    <p className="text-sm font-semibold text-primary">{formatCurrency(result.premioMaturato)}</p>
                    <p className="text-xs">Punti: {result.punti.toFixed(2)} ({result.percentualeTarget.toFixed(1)}%)</p>
                    <p className={`text-xs font-semibold ${result.targetRaggiunto === '100%' ? 'text-green-600' : result.targetRaggiunto === '80%' ? 'text-yellow-600' : 'text-muted-foreground'}`}>
                      Target: {result.targetRaggiunto}
                    </p>
                    <p className="text-xs text-primary">
                      Run rate: {result.runRateGiornalieroPezzi.toFixed(2)} pz/gg
                    </p>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-4 space-y-6">
              <div className="space-y-3">
                <h4 className="font-semibold text-sm bg-orange-100 dark:bg-orange-950 p-2 rounded">Customer Base Eventi</h4>
                <div className="space-y-2"><Label className="text-xs font-semibold">Cambio Offerta MIA UNTIED / MIA CYC UNTIED</Label>{CAMBIO_OFFERTA_UNTIED_CLUSTERS.map(cluster => (<div key={cluster.cluster} className="grid grid-cols-4 gap-2 items-end"><div className="col-span-2"><p className="text-xs">{cluster.cluster}</p><p className="text-[10px] text-muted-foreground">{cluster.gettoni}€ | {cluster.puntiPartnership} punti</p></div><div><Label className="text-xs">Pezzi</Label><Input type="number" min="0" value={getPezzi(pdv.id, 'cambio_offerta_untied', cluster.cluster) || ''} onChange={(e) => handlePezziChange(pdv.id, 'cambio_offerta_untied', cluster.cluster, e.target.value)} className="h-8 text-xs" /></div></div>))}</div>
                <div className="space-y-2"><Label className="text-xs font-semibold">Cambio Offerta Rivincoli Easy Pay / CYC Easy Pay</Label>{CAMBIO_OFFERTA_RIVINCOLI_CLUSTERS.map(cluster => (<div key={cluster.cluster} className="grid grid-cols-4 gap-2 items-end"><div className="col-span-2"><p className="text-xs">{cluster.cluster}</p><p className="text-[10px] text-muted-foreground">{cluster.gettoni}€ | {cluster.puntiPartnership} punti</p></div><div><Label className="text-xs">Pezzi</Label><Input type="number" min="0" value={getPezzi(pdv.id, 'cambio_offerta_rivincoli', cluster.cluster) || ''} onChange={(e) => handlePezziChange(pdv.id, 'cambio_offerta_rivincoli', cluster.cluster, e.target.value)} className="h-8 text-xs" /></div></div>))}</div>
                <div className="space-y-2"><Label className="text-xs font-semibold">Telefono Incluso Offerta MIA Smart Pack</Label>{TELEFONO_INCLUSO_OPTIONS.map(option => (<div key={option.option} className="grid grid-cols-4 gap-2 items-end"><div className="col-span-2"><p className="text-xs">{option.label}</p><p className="text-[10px] text-muted-foreground">{option.gettoni}€ | {option.puntiPartnership} punti</p></div><div><Label className="text-xs">Pezzi</Label><Input type="number" min="0" value={getPezzi(pdv.id, 'telefono_incluso_var', option.option) || ''} onChange={(e) => handlePezziChange(pdv.id, 'telefono_incluso_var', option.option, e.target.value)} className="h-8 text-xs" /></div></div>))}</div>
                {CB_EVENTS_CONFIG.filter(e => e.category === 'customer_base' && !['cambio_offerta_untied', 'cambio_offerta_rivincoli', 'telefono_incluso_var'].includes(e.type)).map(event => (<div key={event.type} className="grid grid-cols-4 gap-2 items-end"><div className="col-span-2"><Label className="text-xs">{event.label}</Label>{event.clusterCard && (<p className="text-[10px] text-muted-foreground">{event.clusterCard} - {event.gettoni}€</p>)}</div><div><Label className="text-xs">Pezzi</Label><Input type="number" min="0" value={getPezzi(pdv.id, event.type, undefined) || ''} onChange={(e) => handlePezziChange(pdv.id, event.type, undefined, e.target.value)} className="h-8 text-xs" /></div></div>))}
              </div>
              <div className="space-y-3"><h4 className="font-semibold text-sm bg-orange-100 dark:bg-orange-950 p-2 rounded">Altri Eventi a Remunerazione Flat - FISSO</h4>{CB_EVENTS_CONFIG.filter(e => e.category === 'fisso_flat').map(event => (<div key={event.type} className="grid grid-cols-4 gap-2 items-end"><div className="col-span-2"><Label className="text-xs">{event.label}</Label><p className="text-[10px] text-muted-foreground">{event.gettoni}€</p></div><div><Label className="text-xs">Pezzi</Label><Input type="number" min="0" value={getPezzi(pdv.id, event.type, undefined) || ''} onChange={(e) => handlePezziChange(pdv.id, event.type, undefined, e.target.value)} className="h-8 text-xs" /></div></div>))}</div>
              <div className="space-y-3"><h4 className="font-semibold text-sm bg-orange-100 dark:bg-orange-950 p-2 rounded">Altri Eventi a Remunerazione Flat - MOBILE</h4>{CB_EVENTS_CONFIG.filter(e => e.category === 'mobile_flat').map(event => (<div key={event.type} className="grid grid-cols-4 gap-2 items-end"><div className="col-span-2"><Label className="text-xs">{event.label}</Label><p className="text-[10px] text-muted-foreground">{event.gettoni}€</p></div><div><Label className="text-xs">Pezzi</Label><Input type="number" min="0" value={getPezzi(pdv.id, event.type, undefined) || ''} onChange={(e) => handlePezziChange(pdv.id, event.type, undefined, e.target.value)} className="h-8 text-xs" /></div></div>))}</div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};
