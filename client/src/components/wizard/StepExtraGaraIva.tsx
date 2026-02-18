import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ExtraGaraIvaRsResult } from "@/types/extra-gara-iva";
import { PuntoVendita, CLUSTER_PIVA_OPTIONS } from "@/types/preventivatore";
import { ExtraGaraSogliePerRS, calcolaSoglieRS, ExtraGaraConfigOverrides } from "@/lib/calcoloExtraGaraIva";
import { TabelleCalcoloValues } from "@/hooks/useTabelleCalcoloConfig";
import { CalendarioMeseOverride, getWorkdayInfoFromOverrides } from "@/utils/calendario";
import { Zap, Receipt, Pencil, RotateCcw, Clock } from "lucide-react";
import { StepContentHeader } from "./StepContentHeader";

interface StepExtraGaraIvaProps {
  results: ExtraGaraIvaRsResult[];
  totalePremio: number;
  modalitaInserimentoRS?: "per_rs" | "per_pdv" | null;
  puntiVendita?: PuntoVendita[];
  soglieOverride?: ExtraGaraSogliePerRS;
  onSoglieOverrideChange?: (override: ExtraGaraSogliePerRS) => void;
  tabelleCalcoloConfig?: TabelleCalcoloValues | null;
  anno?: number;
  monthIndex?: number;
  calendarioOverrides?: Record<string, CalendarioMeseOverride>;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(value);

const formatNumber = (value: number) =>
  new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 }).format(value);

const getClusterLabel = (clusterPIva: string) => {
  const option = CLUSTER_PIVA_OPTIONS.find(o => o.value === clusterPIva);
  return option?.label || clusterPIva || "Non assegnato";
};

const StepExtraGaraIva: React.FC<StepExtraGaraIvaProps> = ({ 
  results, 
  totalePremio, 
  modalitaInserimentoRS,
  puntiVendita,
  soglieOverride,
  onSoglieOverrideChange,
  tabelleCalcoloConfig,
  anno,
  monthIndex,
  calendarioOverrides,
}) => {
  const isRSMode = modalitaInserimentoRS === "per_rs";
  const [editingRS, setEditingRS] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{ s1: number; s2: number; s3: number; s4: number }>({ s1: 0, s2: 0, s3: 0, s4: 0 });

  const configOverrides: ExtraGaraConfigOverrides | undefined = useMemo(() => {
    if (!tabelleCalcoloConfig?.extraGara) return undefined;
    return {
      puntiAttivazione: tabelleCalcoloConfig.extraGara.puntiAttivazione,
      soglieMultipos: tabelleCalcoloConfig.extraGara.soglieMultipos,
      soglieMonopos: tabelleCalcoloConfig.extraGara.soglieMonopos,
      premiPerSoglia: tabelleCalcoloConfig.extraGara.premiPerSoglia,
    };
  }, [tabelleCalcoloConfig]);

  const avgWorkingDaysPerRS = useMemo(() => {
    if (!puntiVendita || anno === undefined || monthIndex === undefined) return {};
    const pdvPerRS: Record<string, PuntoVendita[]> = {};
    for (const pdv of puntiVendita) {
      const rs = pdv.ragioneSociale || "Senza RS";
      if (!pdvPerRS[rs]) pdvPerRS[rs] = [];
      pdvPerRS[rs].push(pdv);
    }
    const result: Record<string, number> = {};
    for (const [rs, pdvList] of Object.entries(pdvPerRS)) {
      const totalDays = pdvList.reduce((sum, pdv) => {
        const wi = getWorkdayInfoFromOverrides(anno, monthIndex, pdv.calendar, calendarioOverrides?.[pdv.id]);
        return sum + wi.totalWorkingDays;
      }, 0);
      result[rs] = totalDays / (pdvList.length || 1);
    }
    return result;
  }, [puntiVendita, anno, monthIndex, calendarioOverrides]);

  const defaultSogliePerRS = useMemo(() => {
    if (!puntiVendita) return {};
    const pdvPerRS: Record<string, PuntoVendita[]> = {};
    for (const pdv of puntiVendita) {
      const rs = pdv.ragioneSociale || "Senza RS";
      if (!pdvPerRS[rs]) pdvPerRS[rs] = [];
      pdvPerRS[rs].push(pdv);
    }
    const defaults: Record<string, { s1: number; s2: number; s3: number; s4: number }> = {};
    for (const [rs, pdvList] of Object.entries(pdvPerRS)) {
      const isMultipos = pdvList.length > 1;
      defaults[rs] = calcolaSoglieRS(pdvList, isMultipos, configOverrides);
    }
    return defaults;
  }, [puntiVendita, configOverrides]);

  const startEditing = (rs: string) => {
    const current = soglieOverride?.[rs] || defaultSogliePerRS[rs] || { s1: 0, s2: 0, s3: 0, s4: 0 };
    setEditValues({ ...current });
    setEditingRS(rs);
  };

  const saveEditing = () => {
    if (!editingRS || !onSoglieOverrideChange) return;
    onSoglieOverrideChange({
      ...soglieOverride,
      [editingRS]: { ...editValues },
    });
    setEditingRS(null);
  };

  const resetToDefault = (rs: string) => {
    if (!onSoglieOverrideChange || !soglieOverride) return;
    const newOverride = { ...soglieOverride };
    delete newOverride[rs];
    onSoglieOverrideChange(newOverride);
    setEditingRS(null);
  };

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
        const sogliaMax = rs.hasBPInRS ? rs.soglie.s4 : rs.soglie.s3;
        const progressPercent = sogliaMax > 0 
          ? Math.min((rs.puntiTotaliRS / sogliaMax) * 100, 100) 
          : 0;
        
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
        
        const maxSogliaRaggiungibile = rs.hasBPInRS ? 4 : 3;
        
        const progressToNext = nextThreshold > 0 
          ? Math.min((rs.puntiTotaliRS / nextThreshold) * 100, 100) 
          : 100;

        const isEditing = editingRS === rs.ragioneSociale;
        const hasOverride = soglieOverride && soglieOverride[rs.ragioneSociale] !== undefined;

        return (
          <Card key={rs.ragioneSociale}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-3 flex-wrap">
                  <CardTitle className="text-base">{rs.ragioneSociale}</CardTitle>
                  <Badge variant={rs.isMultipos ? "default" : "secondary"}>
                    {rs.isMultipos ? "MULTIPOS" : "MONOPOS"} - {rs.numPdv} PDV
                  </Badge>
                  {hasOverride && (
                    <Badge variant="outline" className="text-amber-600 border-amber-400">
                      Soglie personalizzate
                    </Badge>
                  )}
                </div>
                <span className="text-lg font-bold text-primary">
                  {formatCurrency(rs.premioTotaleRS)}
                </span>
              </div>

              {isEditing ? (
                <div className="mt-2 p-3 bg-muted/40 rounded-lg space-y-3">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Modifica Soglie per {rs.ragioneSociale}</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {(["s1", "s2", "s3", "s4"] as const).map((key) => {
                      const isS4Disabled = key === "s4" && !rs.hasBPInRS;
                      return (
                        <div key={key} className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground uppercase">{key.toUpperCase()}</label>
                          <Input
                            type="number"
                            min={0}
                            step={1}
                            value={editValues[key]}
                            disabled={isS4Disabled}
                            onChange={(e) => setEditValues(prev => ({ ...prev, [key]: Number(e.target.value) || 0 }))}
                            data-testid={`input-soglia-${key}-${rs.ragioneSociale}`}
                          />
                          {isS4Disabled && (
                            <span className="text-xs text-muted-foreground">No BP</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button size="sm" onClick={saveEditing} data-testid={`button-save-soglie-${rs.ragioneSociale}`}>
                      Salva
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingRS(null)} data-testid={`button-cancel-soglie-${rs.ragioneSociale}`}>
                      Annulla
                    </Button>
                    {hasOverride && (
                      <Button size="sm" variant="ghost" onClick={() => resetToDefault(rs.ragioneSociale)} data-testid={`button-reset-soglie-${rs.ragioneSociale}`}>
                        <RotateCcw className="h-3 w-3 mr-1" />
                        Ripristina default
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-xs text-muted-foreground">
                    Soglie: S1={rs.soglie.s1} | S2={rs.soglie.s2} | S3={rs.soglie.s3}
                    {rs.hasBPInRS && <> | S4={rs.soglie.s4}</>}
                    {!rs.hasBPInRS && <span className="ml-2 text-amber-600">(S4 non disponibile - nessun BP)</span>}
                  </span>
                  {onSoglieOverrideChange && (
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      className="h-6 px-2 text-xs"
                      onClick={() => startEditing(rs.ragioneSociale)}
                      data-testid={`button-edit-soglie-${rs.ragioneSociale}`}
                    >
                      <Pencil className="h-3 w-3 mr-1" />
                      Modifica
                    </Button>
                  )}
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
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

                <div className="space-y-2 p-3 bg-muted/30 rounded-lg">
                  <h4 className="font-medium text-xs uppercase tracking-wide text-muted-foreground">Fisso</h4>
                  <div className="space-y-1.5">
                    <div className="grid grid-cols-[1fr,auto] gap-2 items-baseline">
                      <span className="text-muted-foreground text-xs">Fisso P.IVA (1a+2a Linea)</span>
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

              <div className="border-t pt-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-1">
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

                {(() => {
                  const avgDays = avgWorkingDaysPerRS[rs.ragioneSociale] || 0;
                  const runRatePuntiRS = avgDays > 0 ? rs.puntiTotaliRS / avgDays : 0;
                  const runRatePezziRS = avgDays > 0 ? rs.pezziTotaliRS / avgDays : 0;
                  return avgDays > 0 ? (
                    <div className="p-3 bg-secondary/10 rounded-lg border border-secondary/30" data-testid={`run-rate-extra-gara-rs-${rs.ragioneSociale}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <Clock className="w-4 h-4 text-secondary-foreground" />
                        <p className="font-semibold text-sm text-secondary-foreground">Run Rate</p>
                      </div>
                      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                        <span>Punti/gg: <span className="font-medium text-foreground">{runRatePuntiRS.toFixed(2)}</span></span>
                        <span>Attivazioni/gg: <span className="font-medium text-foreground">{runRatePezziRS.toFixed(2)}</span></span>
                        <span>Media gg lav: <span className="font-medium text-foreground">{avgDays.toFixed(1)}</span></span>
                      </div>
                    </div>
                  ) : null;
                })()}

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

      <Card className="bg-primary/5 border-primary">
        <CardContent className="py-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-lg font-medium">Totale Premio Extra IVA</span>
            <span className="text-2xl font-bold text-primary">{formatCurrency(totalePremio)}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default StepExtraGaraIva;
