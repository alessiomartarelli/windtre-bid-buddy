import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ExtraGaraIvaRsResult } from "@/types/extra-gara-iva";
import { CLUSTER_PIVA_OPTIONS } from "@/types/preventivatore";
import { Zap, Receipt } from "lucide-react";
import { StepContentHeader } from "./StepContentHeader";

interface StepExtraGaraIvaProps {
  results: ExtraGaraIvaRsResult[];
  totalePremio: number;
  modalitaInserimentoRS?: "per_rs" | "per_pdv" | null;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(value);

const formatNumber = (value: number) =>
  new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 }).format(value);

const getClusterLabel = (clusterPIva: string) => {
  const option = CLUSTER_PIVA_OPTIONS.find(o => o.value === clusterPIva);
  return option?.label || clusterPIva || "Non assegnato";
};

const StepExtraGaraIva: React.FC<StepExtraGaraIvaProps> = ({ results, totalePremio, modalitaInserimentoRS }) => {
  const isRSMode = modalitaInserimentoRS === "per_rs";
  
  if (results.length === 0) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Extra IVA</h3>
        <p className="text-sm text-muted-foreground">
          Nessun dato disponibile. Assicurati di aver compilato i dati nei passi precedenti.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <StepContentHeader
        icon={Receipt}
        title="Extra IVA"
        subtitle="Calcolo automatico basato sui dati inseriti negli step precedenti"
        totalPremio={totalePremio}
      />

      {results.map((rs) => {
        // Soglia massima dipende da se c'è BP nella RS
        const sogliaMax = rs.hasBPInRS ? rs.soglie.s4 : rs.soglie.s3;
        const progressPercent = sogliaMax > 0 
          ? Math.min((rs.puntiTotaliRS / sogliaMax) * 100, 100) 
          : 0;
        
        // Calcola percentuale verso soglia successiva
        let nextThreshold = 0;
        let nextThresholdLabel = "";
        if (rs.sogliaRaggiunta === 0 && rs.soglie.s1 > 0) {
          nextThreshold = rs.soglie.s1;
          nextThresholdLabel = "S1";
        } else if (rs.sogliaRaggiunta === 1 && rs.soglie.s2 > 0) {
          nextThreshold = rs.soglie.s2;
          nextThresholdLabel = "S2";
        } else if (rs.sogliaRaggiunta === 2 && rs.soglie.s3 > 0) {
          nextThreshold = rs.soglie.s3;
          nextThresholdLabel = "S3";
        } else if (rs.sogliaRaggiunta === 3 && rs.hasBPInRS && rs.soglie.s4 > 0) {
          nextThreshold = rs.soglie.s4;
          nextThresholdLabel = "S4";
        }
        
        // Per RS senza BP, la soglia massima raggiungibile è S3
        const maxSogliaRaggiungibile = rs.hasBPInRS ? 4 : 3;
        
        const progressToNext = nextThreshold > 0 
          ? Math.min((rs.puntiTotaliRS / nextThreshold) * 100, 100) 
          : 100;

        return (
          <Card key={rs.ragioneSociale} className="border-l-4 border-l-primary">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-base">{rs.ragioneSociale}</CardTitle>
                  <Badge variant={rs.isMultipos ? "default" : "secondary"}>
                    {rs.isMultipos ? "MULTIPOS" : "MONOPOS"} • {rs.numPdv} PDV
                  </Badge>
                </div>
                <span className="text-lg font-bold text-primary">
                  {formatCurrency(rs.premioTotaleRS)}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Soglie: S1={rs.soglie.s1} | S2={rs.soglie.s2} | S3={rs.soglie.s3}
                {rs.hasBPInRS && <> | S4={rs.soglie.s4}</>}
                {!rs.hasBPInRS && <span className="ml-2 text-amber-600">(S4 non disponibile - nessun BP)</span>}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Breakdown categorie aggregate */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                {/* MOBILE */}
                <div className="space-y-2 p-3 bg-muted/30 rounded-lg">
                  <h4 className="font-medium text-xs uppercase tracking-wide text-muted-foreground">Mobile (SIM IVA)</h4>
                  <div className="space-y-1.5">
                    <div className="grid grid-cols-[1fr,auto] gap-2 items-baseline">
                      <span className="text-muted-foreground text-xs">World/Staff</span>
                      <span className="text-right font-semibold whitespace-nowrap">
                        {formatNumber(rs.pdvResults.reduce((s, p) => s + p.puntiWorldStaff, 0))} pt
                      </span>
                    </div>
                    <div className="grid grid-cols-[1fr,auto] gap-2 items-baseline">
                      <span className="text-muted-foreground text-xs">Full Plus/Data</span>
                      <span className="text-right font-semibold whitespace-nowrap">
                        {formatNumber(rs.pdvResults.reduce((s, p) => s + p.puntiFullPlus, 0))} pt
                      </span>
                    </div>
                    <div className="grid grid-cols-[1fr,auto] gap-2 items-baseline">
                      <span className="text-muted-foreground text-xs">Flex/Special</span>
                      <span className="text-right font-semibold whitespace-nowrap">
                        {formatNumber(rs.pdvResults.reduce((s, p) => s + p.puntiFlexSpecial, 0))} pt
                      </span>
                    </div>
                  </div>
                </div>

                {/* FISSO */}
                <div className="space-y-2 p-3 bg-muted/30 rounded-lg">
                  <h4 className="font-medium text-xs uppercase tracking-wide text-muted-foreground">Fisso</h4>
                  <div className="space-y-1.5">
                    <div className="grid grid-cols-[1fr,auto] gap-2 items-baseline">
                      <span className="text-muted-foreground text-xs">Fisso P.IVA (1ª+2ª Linea)</span>
                      <span className="text-right font-semibold whitespace-nowrap">
                        {formatNumber(rs.pdvResults.reduce((s, p) => s + p.puntiFissoPIva, 0))} pt
                      </span>
                    </div>
                    <div className="grid grid-cols-[1fr,auto] gap-2 items-baseline">
                      <span className="text-muted-foreground text-xs">FRITZ!Box</span>
                      <span className="text-right font-semibold whitespace-nowrap">
                        {formatNumber(rs.pdvResults.reduce((s, p) => s + p.puntiFritzBox, 0))} pt
                      </span>
                    </div>
                  </div>
                </div>

                {/* NEW BUSINESS */}
                <div className="space-y-2 p-3 bg-muted/30 rounded-lg">
                  <h4 className="font-medium text-xs uppercase tracking-wide text-muted-foreground">New Business</h4>
                  <div className="space-y-1.5">
                    <div className="grid grid-cols-[1fr,auto] gap-2 items-baseline">
                      <span className="text-muted-foreground text-xs">Luce&Gas</span>
                      <span className="text-right font-semibold whitespace-nowrap">
                        {formatNumber(rs.pdvResults.reduce((s, p) => s + p.puntiLuceGas, 0))} pt
                      </span>
                    </div>
                    <div className="grid grid-cols-[1fr,auto] gap-2 items-baseline">
                      <span className="text-muted-foreground text-xs">Protezione Pro</span>
                      <span className="text-right font-semibold whitespace-nowrap">
                        {formatNumber(rs.pdvResults.reduce((s, p) => s + p.puntiProtezionePro, 0))} pt
                      </span>
                    </div>
                    <div className="grid grid-cols-[1fr,auto] gap-2 items-baseline">
                      <span className="text-muted-foreground text-xs flex items-center gap-1">
                        Negozio Protetti
                        <Zap className="h-3 w-3 text-primary shrink-0" />
                      </span>
                      <span className="text-right font-semibold whitespace-nowrap">
                        {formatNumber(rs.pdvResults.reduce((s, p) => s + p.puntiNegozioProtetti, 0))} pt
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Risultato RS */}
              <div className="border-t pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-muted-foreground">Punti Totali RS: </span>
                    <span className="font-bold text-lg">{formatNumber(rs.puntiTotaliRS)} pt</span>
                    <span className="ml-2">
                      → Soglia <Badge variant={rs.sogliaRaggiunta > 0 ? "default" : "secondary"}>
                        {rs.sogliaRaggiunta > 0 ? `S${rs.sogliaRaggiunta}` : "Nessuna"}
                      </Badge> raggiunta
                    </span>
                  </div>
                </div>
                
                {nextThresholdLabel && rs.sogliaRaggiunta < 4 && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Progresso verso {nextThresholdLabel}</span>
                      <span>{formatNumber(rs.puntiTotaliRS)} / {nextThreshold} pt ({Math.round(progressToNext)}%)</span>
                    </div>
                    <Progress value={progressToNext} className="h-2" />
                  </div>
                )}

                {/* Dettaglio per PDV - nascosto in modalità RS */}
                {!isRSMode && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-3">
                    {rs.pdvResults.map((pdvRes) => (
                      <div 
                        key={pdvRes.pdvId} 
                        className="flex justify-between items-center p-2 bg-muted/20 rounded text-sm"
                      >
                        <div className="flex flex-col">
                          <span className="font-medium">{pdvRes.pdvCode}</span>
                          <span className="text-xs text-muted-foreground">
                            {getClusterLabel(pdvRes.clusterPIva)}
                          </span>
                        </div>
                        <div className="text-right">
                          <div>{pdvRes.pezziTotali} pz × {formatCurrency(pdvRes.premioUnitario).replace("€", "").trim()}€</div>
                          <div className="font-semibold">{formatCurrency(pdvRes.premioTotale)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                {/* Riepilogo aggregato RS in modalità RS */}
                {isRSMode && (
                  <div className="flex justify-between items-center p-3 bg-muted/30 rounded-lg mt-3">
                    <div className="flex flex-col">
                      <span className="font-medium">Totale Ragione Sociale</span>
                      <span className="text-xs text-muted-foreground">
                        {rs.pezziTotaliRS} pezzi totali
                      </span>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-lg">{formatCurrency(rs.premioTotaleRS)}</div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {/* Totale complessivo */}
      <Card className="bg-primary/5 border-primary">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <span className="text-lg font-medium">Totale Premio Extra IVA</span>
            <span className="text-2xl font-bold text-primary">{formatCurrency(totalePremio)}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default StepExtraGaraIva;
