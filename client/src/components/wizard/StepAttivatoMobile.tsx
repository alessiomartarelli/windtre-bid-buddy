import React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PuntoVendita, PistaMobileConfig, AttivatoMobileDettaglio, MobileActivationType, MOBILE_CATEGORY_LABELS, CalcoloPistaMobilePosResult, PistaMobilePosConfig } from "@/types/preventivatore";
import { formatCurrency, formatPercent } from "@/utils/format";
import { Smartphone, ChevronDown, ChevronUp, Target, Clock, Award } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { StepContentHeader } from "./StepContentHeader";

interface StepAttivatoMobileProps {
  puntiVendita: PuntoVendita[];
  pistaConfig: PistaMobileConfig;
  anno: number;
  monthIndex: number;
  attivatoMobileByPos: Record<string, AttivatoMobileDettaglio[]>;
  setAttivatoMobileByPos: React.Dispatch<React.SetStateAction<Record<string, AttivatoMobileDettaglio[]>>>;
  mobileResults: { pdv: PuntoVendita; conf: PistaMobilePosConfig; righe: AttivatoMobileDettaglio[]; result: CalcoloPistaMobilePosResult & { extraGettoniEuro: number } }[];
  totalePremioMobilePrevisto: number;
}

export const StepAttivatoMobile: React.FC<StepAttivatoMobileProps> = ({
  puntiVendita,
  pistaConfig,
  attivatoMobileByPos,
  setAttivatoMobileByPos,
  mobileResults,
  totalePremioMobilePrevisto,
}) => {
  const [openCards, setOpenCards] = React.useState<Record<string, boolean>>({});

  const toggleCard = (pdvId: string) => {
    setOpenCards(prev => ({ ...prev, [pdvId]: !prev[pdvId] }));
  };

  // Filtra le categorie escludendo SIM Consumer e SIM IVA (sono totali calcolati)
  const availableCategories = MOBILE_CATEGORY_LABELS.filter(
    (cat) => cat.value !== MobileActivationType.SIM_CNS && cat.value !== MobileActivationType.SIM_IVA
  );

  // Funzione per ottenere o creare il valore per una tipologia specifica
  const getOrCreatePezzi = (pdvId: string, type: MobileActivationType): number => {
    const righe = attivatoMobileByPos[pdvId] ?? [];
    const riga = righe.find((r) => r.type === type);
    return riga?.pezzi ?? 0;
  };

  // Funzione per calcolare il totale delle Tourist SIM
  const getTotalTourist = (pdvId: string): number => {
    return (
      getOrCreatePezzi(pdvId, MobileActivationType.TOURIST_FULL) +
      getOrCreatePezzi(pdvId, MobileActivationType.TOURIST_PASS) +
      getOrCreatePezzi(pdvId, MobileActivationType.TOURIST_XXL)
    );
  };

  // Funzione per calcolare il massimo consentito per MNP (SIM CNS + SIM IVA)
  const getMaxMnp = (pdvId: string): number => {
    const totalCns = calculateTotal(pdvId, cnsSims);
    const totalIva = calculateTotal(pdvId, ivaSims);
    return totalCns + totalIva;
  };

  // Funzione per calcolare il massimo consentito per Più Sicuri Mobile
  const getMaxPiuSicuri = (pdvId: string): number => {
    const totalCns = calculateTotal(pdvId, cnsSims);
    const totalIva = calculateTotal(pdvId, ivaSims);
    const totalTourist = getTotalTourist(pdvId);
    return Math.max(0, totalCns + totalIva - totalTourist);
  };

  // Funzione per aggiornare i pezzi di una tipologia specifica
  const updatePezzi = (pdvId: string, type: MobileActivationType, pezzi: number) => {
    // Validazione per MNP: non deve superare SIM CNS + SIM IVA
    if (type === MobileActivationType.MNP) {
      const maxMnp = getMaxMnp(pdvId);
      if (pezzi > maxMnp) {
        pezzi = maxMnp;
      }
      // Se riduciamo MNP, dobbiamo anche ridurre MNP_MVNO se necessario
      const currentMnpMvno = getOrCreatePezzi(pdvId, MobileActivationType.MNP_MVNO);
      if (currentMnpMvno > pezzi) {
        setAttivatoMobileByPos((prev) => {
          const righe = prev[pdvId] ?? [];
          const mvnoIndex = righe.findIndex((r) => r.type === MobileActivationType.MNP_MVNO);
          if (mvnoIndex >= 0) {
            const updated = [...righe];
            updated[mvnoIndex] = { ...updated[mvnoIndex], pezzi: pezzi };
            return { ...prev, [pdvId]: updated };
          }
          return prev;
        });
      }
    }

    // Validazione per MNP MVNO: è un di cui delle MNP, quindi non può superare MNP
    if (type === MobileActivationType.MNP_MVNO) {
      const mnpValue = getOrCreatePezzi(pdvId, MobileActivationType.MNP);
      if (pezzi > mnpValue) {
        pezzi = mnpValue;
      }
    }

    // Validazione per Più Sicuri Mobile e Più Sicuri Mobile Pro
    if (type === MobileActivationType.PIU_SICURI_MOBILE || type === MobileActivationType.PIU_SICURI_MOBILE_PRO) {
      const maxPiuSicuri = getMaxPiuSicuri(pdvId);
      const otherType = type === MobileActivationType.PIU_SICURI_MOBILE 
        ? MobileActivationType.PIU_SICURI_MOBILE_PRO 
        : MobileActivationType.PIU_SICURI_MOBILE;
      const otherValue = getOrCreatePezzi(pdvId, otherType);
      const maxAllowed = Math.max(0, maxPiuSicuri - otherValue);
      
      if (pezzi > maxAllowed) {
        pezzi = maxAllowed;
      }
    }

    setAttivatoMobileByPos((prev) => {
      const righe = prev[pdvId] ?? [];
      const existingIndex = righe.findIndex((r) => r.type === type);
      
      if (existingIndex >= 0) {
        const updated = [...righe];
        updated[existingIndex] = { ...updated[existingIndex], pezzi };
        return { ...prev, [pdvId]: updated };
      } else {
        const newRiga: AttivatoMobileDettaglio = {
          id: `${pdvId}-${type}-${Date.now()}`,
          type,
          pezzi,
        };
        return { ...prev, [pdvId]: [...righe, newRiga] };
      }
    });
  };

  // Categorie organizzate per sezioni
  const cnsSims = [
    MobileActivationType.TIED,
    MobileActivationType.UNTIED,
    MobileActivationType.TOURIST_FULL,
    MobileActivationType.TOURIST_PASS,
    MobileActivationType.TOURIST_XXL,
  ];
  
  const ivaSims = [
    MobileActivationType.PROFESSIONAL_FLEX,
    MobileActivationType.PROFESSIONAL_DATA_10,
    MobileActivationType.PROFESSIONAL_SPECIAL,
    MobileActivationType.PROFESSIONAL_STAFF,
    MobileActivationType.PROFESSIONAL_WORLD,
    MobileActivationType.ALTRE_SIM_IVA,
  ];
  
  const altreSims = [
    MobileActivationType.PHASE_IN_TIED,
    MobileActivationType.WINBACK,
    MobileActivationType.CONVERGENTE_SUPERFIBRA_MULTISERVICE,
    MobileActivationType.MNP,
    MobileActivationType.MNP_MVNO,
    MobileActivationType.PIU_SICURI_MOBILE,
    MobileActivationType.PIU_SICURI_MOBILE_PRO,
  ];

  const deviceCategories = [
    MobileActivationType.DEVICE_VAR_SP_LT_200,
    MobileActivationType.DEVICE_VAR_SP_GTE_200,
    MobileActivationType.DEVICE_1_FIN_SP_LT_200,
    MobileActivationType.DEVICE_1_FIN_SP_200_600,
    MobileActivationType.DEVICE_1_FIN_SP_GTE_600,
    MobileActivationType.DEVICE_2_FINANZIATO,
  ];

  const getLabelForType = (type: MobileActivationType) => {
    return MOBILE_CATEGORY_LABELS.find(cat => cat.value === type)?.label || type;
  };

  const calculateTotal = (pdvId: string, types: MobileActivationType[]) => {
    return types.reduce((sum, type) => sum + getOrCreatePezzi(pdvId, type), 0);
  };

  // Calcola totali - solo SIM Consumer (cnsSims) + SIM IVA (ivaSims)
  const coreSims = [...cnsSims, ...ivaSims];
  const totalePezzi = mobileResults.reduce((sum, r) => {
    const righe = attivatoMobileByPos[r.pdv.id] ?? [];
    const pezziPos = righe
      .filter((riga) => coreSims.includes(riga.type as MobileActivationType))
      .reduce((pSum, riga) => pSum + riga.pezzi, 0);
    return sum + pezziPos;
  }, 0);
  const totalePunti = mobileResults.reduce((sum, r) => sum + r.result.punti, 0);

  if (!puntiVendita.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <Smartphone className="w-8 h-8 text-muted-foreground" />
        </div>
        <p className="text-muted-foreground">Prima inserisci i punti vendita.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header con totali */}
      <StepContentHeader
        icon={Smartphone}
        title="Volumi Mobile"
        subtitle="Inserisci i volumi target mensili per tipologia"
        totalPremio={totalePremioMobilePrevisto}
        extraInfo={`${totalePezzi} pezzi · ${totalePunti.toFixed(2)} punti`}
      />

      {/* Cards per PDV */}
      <div className="space-y-4">
        {puntiVendita.map((pdv, index) => {
          const conf = pistaConfig.sogliePerPos[index];
          if (!conf || !pdv.codicePos) return (
            <Card key={pdv.id} className="border-destructive/50 bg-destructive/5">
              <CardContent className="pt-4">
                <p className="text-sm text-destructive">Config mancante per {pdv.nome}</p>
              </CardContent>
            </Card>
          );
          
          const pdvId = pdv.id;
          const rec = mobileResults.find((r) => r.pdv.id === pdv.id);
          const calc = rec?.result;
          const percSoglia1 = calc && conf.soglia1 > 0 ? Math.min((calc.punti / conf.soglia1) * 100, 100) : 0;
          
          const totalCns = calculateTotal(pdvId, cnsSims);
          const totalIva = calculateTotal(pdvId, ivaSims);
          const isOpen = openCards[pdvId] ?? true;
          
          return (
            <Collapsible key={pdv.id} open={isOpen} onOpenChange={() => toggleCard(pdvId)}>
              <Card className="border-border/50 shadow-sm overflow-hidden transition-all hover:shadow-md">
                <CollapsibleTrigger asChild>
                  <CardHeader className="pb-3 cursor-pointer hover:bg-muted/30 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Smartphone className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <CardTitle className="text-base">{pdv.nome || "Punto vendita"}</CardTitle>
                          <p className="text-xs text-muted-foreground">
                            POS {pdv.codicePos} · {pdv.ragioneSociale || "N/D"} · {pdv.canale.toUpperCase()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        {calc && (
                          <div className="text-right hidden sm:block">
                            <p className="font-semibold text-primary">{formatCurrency(calc.premio + calc.extraGettoniEuro)}</p>
                            <p className="text-xs text-muted-foreground">{calc.punti.toFixed(2)} punti</p>
                          </div>
                        )}
                        {isOpen ? <ChevronUp className="w-5 h-5 text-muted-foreground" /> : <ChevronDown className="w-5 h-5 text-muted-foreground" />}
                      </div>
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                
                <CollapsibleContent>
                  <CardContent className="pt-0 space-y-6">
                    {/* Totali CNS e IVA */}
                    <div className="grid grid-cols-2 gap-4 p-4 bg-gradient-to-r from-primary/5 to-primary/10 rounded-lg border border-primary/10">
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">SIM Consumer</p>
                        <p className="text-3xl font-bold text-foreground mt-1">{totalCns}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">SIM IVA</p>
                        <p className="text-3xl font-bold text-foreground mt-1">{totalIva}</p>
                      </div>
                    </div>

                    {/* Sezione SIM CNS */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/20">
                          SIM Consumer (CNS)
                        </Badge>
                      </div>
                      <div className="grid gap-2 pl-2 border-l-2 border-primary/30">
                        {cnsSims.map((type) => (
                          <div key={type} className="flex items-center justify-between gap-4 py-1">
                            <Label className="text-sm flex-1 text-muted-foreground">{getLabelForType(type)}</Label>
                            <Input
                              className="h-9 w-24 text-center"
                              type="number"
                              min="0"
                              value={getOrCreatePezzi(pdvId, type) || ""}
                              onChange={(e) => updatePezzi(pdvId, type, Number(e.target.value) || 0)}
                              placeholder="0"
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Sezione SIM IVA */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="bg-secondary/50 text-secondary-foreground hover:bg-secondary/70">
                          SIM IVA
                        </Badge>
                      </div>
                      <div className="grid gap-2 pl-2 border-l-2 border-secondary/50">
                        {ivaSims.map((type) => (
                          <div key={type} className="flex items-center justify-between gap-4 py-1">
                            <Label className="text-sm flex-1 text-muted-foreground">{getLabelForType(type)}</Label>
                            <Input
                              className="h-9 w-24 text-center"
                              type="number"
                              min="0"
                              value={getOrCreatePezzi(pdvId, type) || ""}
                              onChange={(e) => updatePezzi(pdvId, type, Number(e.target.value) || 0)}
                              placeholder="0"
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Altre tipologie */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="bg-accent text-accent-foreground hover:bg-accent/80">
                          Altre Tipologie
                        </Badge>
                      </div>
                      <div className="grid gap-2 pl-2 border-l-2 border-accent">
                        {altreSims.map((type) => {
                          const isPiuSicuri = type === MobileActivationType.PIU_SICURI_MOBILE || type === MobileActivationType.PIU_SICURI_MOBILE_PRO;
                          const isMnp = type === MobileActivationType.MNP;
                          const isMnpMvno = type === MobileActivationType.MNP_MVNO;
                          const maxPiuSicuri = isPiuSicuri ? getMaxPiuSicuri(pdvId) : undefined;
                          const currentValue = getOrCreatePezzi(pdvId, type);
                          const maxMnpTotal = isMnp ? getMaxMnp(pdvId) : undefined;
                          const mnpValue = getOrCreatePezzi(pdvId, MobileActivationType.MNP);
                          const maxMnpMvno = isMnpMvno ? mnpValue : undefined;
                          
                          return (
                            <div key={type} className="flex items-center justify-between gap-4 py-1">
                              <Label className="text-sm flex-1 text-muted-foreground">
                                {getLabelForType(type)}
                                {isPiuSicuri && maxPiuSicuri !== undefined && (
                                  <span className="text-xs text-muted-foreground/70 ml-1">(max {maxPiuSicuri})</span>
                                )}
                                {isMnp && maxMnpTotal !== undefined && (
                                  <span className="text-xs text-muted-foreground/70 ml-1">(max {maxMnpTotal})</span>
                                )}
                                {isMnpMvno && (
                                  <span className="text-xs text-muted-foreground/70 ml-1">(di cui MNP, max {maxMnpMvno})</span>
                                )}
                              </Label>
                              <Input
                                className="h-9 w-24 text-center"
                                type="number"
                                min="0"
                                max={isPiuSicuri ? maxPiuSicuri : (isMnp ? maxMnpTotal : (isMnpMvno ? maxMnpMvno : undefined))}
                                value={currentValue || ""}
                                onChange={(e) => updatePezzi(pdvId, type, Number(e.target.value) || 0)}
                                placeholder="0"
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Sezione Device/Telefoni */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="bg-orange-500/10 text-orange-600 hover:bg-orange-500/20">
                          Telefoni / Device
                        </Badge>
                      </div>
                      <div className="grid gap-2 pl-2 border-l-2 border-orange-500/30">
                        {deviceCategories.map((type) => {
                          const currentValue = getOrCreatePezzi(pdvId, type);
                          return (
                            <div key={type} className="flex items-center justify-between gap-4 py-1">
                              <Label className="text-sm flex-1 text-muted-foreground">{getLabelForType(type)}</Label>
                              <Input
                                className="h-9 w-24 text-center"
                                type="number"
                                min="0"
                                value={currentValue || ""}
                                onChange={(e) => updatePezzi(pdvId, type, Number(e.target.value) || 0)}
                                placeholder="0"
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    
                    {/* Result Cards */}
                    {calc && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-4 border-t">
                        <Card className="border-primary/20 bg-primary/5">
                          <CardContent className="p-4">
                            <div className="flex items-center gap-2 mb-2">
                              <Target className="w-4 h-4 text-primary" />
                              <p className="font-semibold text-sm text-primary">Punti & Soglia</p>
                            </div>
                            <p className="text-xs text-muted-foreground">Punti: <span className="font-medium text-foreground">{calc.punti.toFixed(2)}</span></p>
                            <p className="text-xs text-muted-foreground">Soglia: <span className="font-medium text-foreground">{calc.soglia}ª</span></p>
                            <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
                              <div className="h-full bg-primary transition-all" style={{ width: `${percSoglia1}%` }} />
                            </div>
                          </CardContent>
                        </Card>
                        <Card className="border-secondary/30 bg-secondary/10">
                          <CardContent className="p-4">
                            <div className="flex items-center gap-2 mb-2">
                              <Clock className="w-4 h-4 text-secondary-foreground" />
                              <p className="font-semibold text-sm text-secondary-foreground">Run Rate</p>
                            </div>
                            <p className="text-xs text-muted-foreground">Punti/gg: <span className="font-medium text-foreground">{calc.runRateGiornalieroPunti.toFixed(2)}</span></p>
                            <p className="text-xs text-muted-foreground">Attivazioni/gg: <span className="font-medium text-foreground">{calc.runRateGiornalieroAttivazioni.toFixed(2)}</span></p>
                            <p className="text-xs text-muted-foreground">Giorni: <span className="font-medium text-foreground">{calc.workdayInfo.totalWorkingDays}</span></p>
                          </CardContent>
                        </Card>
                        <Card className="border-accent bg-accent/30">
                          <CardContent className="p-4">
                            <div className="flex items-center gap-2 mb-2">
                              <Award className="w-4 h-4 text-accent-foreground" />
                              <p className="font-semibold text-sm text-accent-foreground">Premio</p>
                            </div>
                            <p className="text-lg font-bold text-primary">{formatCurrency(calc.premio + calc.extraGettoniEuro)}</p>
                            {calc.forecastTargetPunti && (
                              <p className="text-xs text-muted-foreground">Target: {formatPercent(calc.forecastRaggiungimentoPercent ?? 0)}</p>
                            )}
                          </CardContent>
                        </Card>
                      </div>
                    )}
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