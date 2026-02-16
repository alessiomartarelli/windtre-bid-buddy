import React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PuntoVendita, PistaMobileRSConfig, AttivatoMobileDettaglio, MobileActivationType, MOBILE_CATEGORY_LABELS, SoglieMobileRS, MobileCategoryConfig, MOBILE_CATEGORIES_CONFIG_DEFAULT } from "@/types/preventivatore";
import { formatCurrency } from "@/utils/format";
import { Smartphone, ChevronDown, ChevronUp, Building2, Store } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { StepContentHeader } from "./StepContentHeader";

interface StepAttivatoMobileRSProps {
  puntiVendita: PuntoVendita[];
  pistaMobileRSConfig: PistaMobileRSConfig;
  anno: number;
  monthIndex: number;
  attivatoMobileByRS: Record<string, AttivatoMobileDettaglio[]>;
  setAttivatoMobileByRS: React.Dispatch<React.SetStateAction<Record<string, AttivatoMobileDettaglio[]>>>;
  totalePremioMobilePrevisto: number;
}

export const StepAttivatoMobileRS: React.FC<StepAttivatoMobileRSProps> = ({
  puntiVendita,
  pistaMobileRSConfig,
  attivatoMobileByRS,
  setAttivatoMobileByRS,
  totalePremioMobilePrevisto,
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

  // Categorie organizzate per sezioni (escludendo SIM_CNS e SIM_IVA che sono totali)
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

  // Funzione per ottenere il valore per una tipologia specifica per RS
  const getOrCreatePezzi = (rs: string, type: MobileActivationType): number => {
    const righe = attivatoMobileByRS[rs] ?? [];
    const riga = righe.find((r) => r.type === type);
    return riga?.pezzi ?? 0;
  };

  // Funzione per calcolare il totale per un array di tipi
  const calculateTotal = (rs: string, types: MobileActivationType[]) => {
    return types.reduce((sum, type) => sum + getOrCreatePezzi(rs, type), 0);
  };

  // Funzione per calcolare il totale delle Tourist SIM
  const getTotalTourist = (rs: string): number => {
    return (
      getOrCreatePezzi(rs, MobileActivationType.TOURIST_FULL) +
      getOrCreatePezzi(rs, MobileActivationType.TOURIST_PASS) +
      getOrCreatePezzi(rs, MobileActivationType.TOURIST_XXL)
    );
  };

  // Funzione per calcolare il massimo consentito per MNP (SIM CNS + SIM IVA)
  const getMaxMnp = (rs: string): number => {
    const totalCns = calculateTotal(rs, cnsSims);
    const totalIva = calculateTotal(rs, ivaSims);
    return totalCns + totalIva;
  };

  // Funzione per calcolare il massimo consentito per Più Sicuri Mobile
  const getMaxPiuSicuri = (rs: string): number => {
    const totalCns = calculateTotal(rs, cnsSims);
    const totalIva = calculateTotal(rs, ivaSims);
    const totalTourist = getTotalTourist(rs);
    return Math.max(0, totalCns + totalIva - totalTourist);
  };

  // Funzione per aggiornare i pezzi di una tipologia specifica per RS
  const updatePezzi = (rs: string, type: MobileActivationType, pezzi: number) => {
    // Validazione per MNP
    if (type === MobileActivationType.MNP) {
      const maxMnp = getMaxMnp(rs);
      if (pezzi > maxMnp) {
        pezzi = maxMnp;
      }
      // Se riduciamo MNP, dobbiamo anche ridurre MNP_MVNO se necessario
      const currentMnpMvno = getOrCreatePezzi(rs, MobileActivationType.MNP_MVNO);
      if (currentMnpMvno > pezzi) {
        setAttivatoMobileByRS((prev) => {
          const righe = prev[rs] ?? [];
          const mvnoIndex = righe.findIndex((r) => r.type === MobileActivationType.MNP_MVNO);
          if (mvnoIndex >= 0) {
            const updated = [...righe];
            updated[mvnoIndex] = { ...updated[mvnoIndex], pezzi: pezzi };
            return { ...prev, [rs]: updated };
          }
          return prev;
        });
      }
    }

    // Validazione per MNP MVNO
    if (type === MobileActivationType.MNP_MVNO) {
      const mnpValue = getOrCreatePezzi(rs, MobileActivationType.MNP);
      if (pezzi > mnpValue) {
        pezzi = mnpValue;
      }
    }

    // Validazione per Più Sicuri Mobile
    if (type === MobileActivationType.PIU_SICURI_MOBILE || type === MobileActivationType.PIU_SICURI_MOBILE_PRO) {
      const maxPiuSicuri = getMaxPiuSicuri(rs);
      const otherType = type === MobileActivationType.PIU_SICURI_MOBILE 
        ? MobileActivationType.PIU_SICURI_MOBILE_PRO 
        : MobileActivationType.PIU_SICURI_MOBILE;
      const otherValue = getOrCreatePezzi(rs, otherType);
      const maxAllowed = Math.max(0, maxPiuSicuri - otherValue);
      
      if (pezzi > maxAllowed) {
        pezzi = maxAllowed;
      }
    }

    setAttivatoMobileByRS((prev) => {
      const righe = prev[rs] ?? [];
      const existingIndex = righe.findIndex((r) => r.type === type);
      
      if (existingIndex >= 0) {
        const updated = [...righe];
        updated[existingIndex] = { ...updated[existingIndex], pezzi };
        return { ...prev, [rs]: updated };
      } else {
        const newRiga: AttivatoMobileDettaglio = {
          id: `${rs}-${type}-${Date.now()}`,
          type,
          pezzi,
        };
        return { ...prev, [rs]: [...righe, newRiga] };
      }
    });
  };

  // Calcola totali complessivi - solo SIM Consumer + SIM IVA
  const coreSims = [...cnsSims, ...ivaSims];
  const totalePezzi = ragioneSocialeList.reduce((sum, rs) => {
    const righe = attivatoMobileByRS[rs] ?? [];
    return sum + righe
      .filter((riga) => coreSims.includes(riga.type as MobileActivationType))
      .reduce((pSum, riga) => pSum + riga.pezzi, 0);
  }, 0);

  // Ottieni la configurazione soglie per una RS - usa trim per evitare mismatch
  const getSoglieForRS = (rs: string): SoglieMobileRS | undefined => {
    const normalizedRS = rs.trim().toLowerCase();
    return pistaMobileRSConfig.sogliePerRS.find(s => 
      s.ragioneSociale.trim().toLowerCase() === normalizedRS
    );
  };

  // Calcola i punti totali per una RS
  const calcolaPuntiTotaliRS = (rs: string): number => {
    const righe = attivatoMobileByRS[rs] ?? [];
    return righe.reduce((sum, riga) => {
      if (!riga.type || !riga.pezzi) return sum;
      const conf = MOBILE_CATEGORIES_CONFIG_DEFAULT.find(c => c.type === riga.type);
      return sum + (riga.pezzi * (conf?.punti || 0));
    }, 0);
  };

  // Determina la soglia raggiunta per una RS
  const determinaSogliaRaggiuntaRS = (rs: string): number => {
    const punti = calcolaPuntiTotaliRS(rs);
    const soglie = getSoglieForRS(rs);
    
    // Se non ci sono soglie configurate, non possiamo determinare nulla
    if (!soglie) {
      console.warn(`[Mobile RS] Soglie non trovate per RS: "${rs}". Config disponibili:`, 
        pistaMobileRSConfig.sogliePerRS.map(s => s.ragioneSociale));
      return 0;
    }
    
    // Confronta punti con soglie (dal più alto al più basso)
    if (soglie.soglia4 > 0 && punti >= soglie.soglia4) return 4;
    if (soglie.soglia3 > 0 && punti >= soglie.soglia3) return 3;
    if (soglie.soglia2 > 0 && punti >= soglie.soglia2) return 2;
    if (soglie.soglia1 > 0 && punti >= soglie.soglia1) return 1;
    return 0;
  };

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
        title="Volumi Mobile per Ragione Sociale"
        subtitle="Inserisci i volumi target mensili aggregati per azienda"
        totalPremio={totalePremioMobilePrevisto}
        extraInfo={`${totalePezzi} pezzi totali · ${ragioneSocialeList.length} aziende`}
      />

      {/* Cards per RS */}
      <div className="space-y-4">
        {ragioneSocialeList.map((rs) => {
          const pdvList = ragioneSocialeGroups[rs];
          const soglie = getSoglieForRS(rs);
          const isOpen = openCards[rs] ?? true;
          
          const totalCns = calculateTotal(rs, cnsSims);
          const totalIva = calculateTotal(rs, ivaSims);
          const totalPezziRS = (attivatoMobileByRS[rs] ?? []).reduce((sum, r) => sum + r.pezzi, 0);
          const puntiTotaliRS = calcolaPuntiTotaliRS(rs);
          const sogliaRaggiunta = determinaSogliaRaggiuntaRS(rs);
          
          return (
            <Collapsible key={rs} open={isOpen} onOpenChange={() => toggleCard(rs)}>
              <Card className="border-border/50 shadow-sm overflow-hidden transition-all hover:shadow-md">
                <CollapsibleTrigger asChild>
                  <CardHeader className="pb-3 cursor-pointer hover:bg-muted/30 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Building2 className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <CardTitle className="text-base">{rs}</CardTitle>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Store className="w-3 h-3" />
                            <span>{pdvList.length} {pdvList.length === 1 ? 'negozio' : 'negozi'}</span>
                            <span className="text-muted-foreground/70">
                              · {puntiTotaliRS.toFixed(2)} punti
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right hidden sm:block">
                          <div className="flex items-center gap-2 justify-end">
                            <p className="font-semibold text-primary">{totalPezziRS} pezzi</p>
                            {sogliaRaggiunta > 0 && (
                              <Badge variant="default" className="bg-primary text-primary-foreground">
                                S{sogliaRaggiunta}
                              </Badge>
                            )}
                            {sogliaRaggiunta === 0 && totalPezziRS > 0 && (
                              <Badge variant="outline" className="text-muted-foreground">
                                Nessuna soglia
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">CNS: {totalCns} · IVA: {totalIva}</p>
                        </div>
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
                              value={getOrCreatePezzi(rs, type) || ""}
                              onChange={(e) => updatePezzi(rs, type, Number(e.target.value) || 0)}
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
                              value={getOrCreatePezzi(rs, type) || ""}
                              onChange={(e) => updatePezzi(rs, type, Number(e.target.value) || 0)}
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
                          const maxPiuSicuri = isPiuSicuri ? getMaxPiuSicuri(rs) : undefined;
                          const currentValue = getOrCreatePezzi(rs, type);
                          const maxMnpTotal = isMnp ? getMaxMnp(rs) : undefined;
                          const mnpValue = getOrCreatePezzi(rs, MobileActivationType.MNP);
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
                                onChange={(e) => updatePezzi(rs, type, Number(e.target.value) || 0)}
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
                          const currentValue = getOrCreatePezzi(rs, type);
                          return (
                            <div key={type} className="flex items-center justify-between gap-4 py-1">
                              <Label className="text-sm flex-1 text-muted-foreground">{getLabelForType(type)}</Label>
                              <Input
                                className="h-9 w-24 text-center"
                                type="number"
                                min="0"
                                value={currentValue || ""}
                                onChange={(e) => updatePezzi(rs, type, Number(e.target.value) || 0)}
                                placeholder="0"
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Info soglie */}
                    {soglie && (
                      <div className="p-3 bg-muted/50 rounded-lg border border-border/50">
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">Soglie configurate:</span>{" "}
                          S1: {soglie.soglia1} · S2: {soglie.soglia2} · S3: {soglie.soglia3} · S4: {soglie.soglia4} punti
                        </p>
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
