import React, { useEffect, useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { PuntoVendita, SoglieMobileRS, SoglieFissoRS, PistaMobileRSConfig, PistaFissoRSConfig, PartnershipRewardRSConfig, PartnershipRewardRS } from "@/types/preventivatore";
import { raggruppaPdvPerRS, generaSoglieMobileRSDefault, generaSoglieFissoRSDefault, generaPartnershipRSDefault } from "@/utils/preventivatore-helpers";
import { PartnershipRewardPosConfig, calculateTarget80, calculatePremio80 } from "@/types/partnership-reward";
import { Building2, Smartphone, Phone, Store, Gift } from "lucide-react";

interface StepConfigPisteRSProps {
  puntiVendita: PuntoVendita[];
  pistaMobileRSConfig: PistaMobileRSConfig;
  pistaFissoRSConfig: PistaFissoRSConfig;
  partnershipRewardConfig: { configPerPos: PartnershipRewardPosConfig[] };
  partnershipRewardRSConfig: PartnershipRewardRSConfig;
  setPistaMobileRSConfig: React.Dispatch<React.SetStateAction<PistaMobileRSConfig>>;
  setPistaFissoRSConfig: React.Dispatch<React.SetStateAction<PistaFissoRSConfig>>;
  setPartnershipRewardRSConfig: React.Dispatch<React.SetStateAction<PartnershipRewardRSConfig>>;
}

export const StepConfigPisteRS: React.FC<StepConfigPisteRSProps> = ({
  puntiVendita,
  pistaMobileRSConfig,
  pistaFissoRSConfig,
  partnershipRewardConfig,
  partnershipRewardRSConfig,
  setPistaMobileRSConfig,
  setPistaFissoRSConfig,
  setPartnershipRewardRSConfig,
}) => {
  // Raggruppa i PDV per Ragione Sociale
  const rsMap = useMemo(() => raggruppaPdvPerRS(puntiVendita), [puntiVendita]);
  const ragioniSociali = useMemo(() => Array.from(rsMap.keys()), [rsMap]);

  // Inizializza le soglie RS di default se non esistono - usa useRef per evitare loop
  const isInitialized = React.useRef(false);

  useEffect(() => {
    if (puntiVendita.length === 0) return;
    
    // Evita re-inizializzazioni multiple
    if (isInitialized.current && pistaMobileRSConfig.sogliePerRS.length > 0) {
      return;
    }

    let mobileNeedsInit = pistaMobileRSConfig.sogliePerRS.length === 0;
    let fissoNeedsInit = pistaFissoRSConfig.sogliePerRS.length === 0;
    let partnershipNeedsInit = partnershipRewardRSConfig.configPerRS.length === 0;

    // Se non serve inizializzare nulla, esci
    if (!mobileNeedsInit && !fissoNeedsInit && !partnershipNeedsInit) {
      isInitialized.current = true;
      return;
    }

    // Inizializza Mobile RS
    if (mobileNeedsInit) {
      const defaultMobile = generaSoglieMobileRSDefault(puntiVendita);
      setPistaMobileRSConfig((prev) => ({
        ...prev,
        sogliePerRS: defaultMobile,
      }));
    }

    // Inizializza Fisso RS
    if (fissoNeedsInit) {
      const defaultFisso = generaSoglieFissoRSDefault(puntiVendita);
      setPistaFissoRSConfig({ sogliePerRS: defaultFisso });
    }

    // Inizializza Partnership RS
    if (partnershipNeedsInit) {
      const defaultPartnership = generaPartnershipRSDefault(puntiVendita, partnershipRewardConfig);
      setPartnershipRewardRSConfig({ configPerRS: defaultPartnership });
    }

    isInitialized.current = true;
  }, [puntiVendita, partnershipRewardConfig, setPistaMobileRSConfig, setPistaFissoRSConfig, setPartnershipRewardRSConfig]);

  // Sincronizza le RS quando cambiano i punti vendita (aggiunta/rimozione)
  useEffect(() => {
    if (puntiVendita.length === 0) return;
    if (!isInitialized.current) return;
    
    const currentRSSet = new Set(ragioniSociali);
    
    // Sincronizza Mobile RS
    const existingMobileRS = new Set(pistaMobileRSConfig.sogliePerRS.map((s) => s.ragioneSociale));
    const needsMobileSync = ragioniSociali.some(rs => !existingMobileRS.has(rs)) || 
                            pistaMobileRSConfig.sogliePerRS.some(s => !currentRSSet.has(s.ragioneSociale));
    
    if (needsMobileSync && pistaMobileRSConfig.sogliePerRS.length > 0) {
      const filtered = pistaMobileRSConfig.sogliePerRS.filter((s) => currentRSSet.has(s.ragioneSociale));
      for (const rs of ragioniSociali) {
        if (!existingMobileRS.has(rs)) {
          const pdvList = rsMap.get(rs) || [];
          const defaults = generaSoglieMobileRSDefault(pdvList);
          const newSoglia = defaults.find((d) => d.ragioneSociale === rs);
          if (newSoglia) filtered.push(newSoglia);
        }
      }
      setPistaMobileRSConfig((prev) => ({ ...prev, sogliePerRS: filtered }));
    }

    // Sincronizza Fisso RS
    const existingFissoRS = new Set(pistaFissoRSConfig.sogliePerRS.map((s) => s.ragioneSociale));
    const needsFissoSync = ragioniSociali.some(rs => !existingFissoRS.has(rs)) || 
                           pistaFissoRSConfig.sogliePerRS.some(s => !currentRSSet.has(s.ragioneSociale));
    
    if (needsFissoSync && pistaFissoRSConfig.sogliePerRS.length > 0) {
      const filtered = pistaFissoRSConfig.sogliePerRS.filter((s) => currentRSSet.has(s.ragioneSociale));
      for (const rs of ragioniSociali) {
        if (!existingFissoRS.has(rs)) {
          const pdvList = rsMap.get(rs) || [];
          const defaults = generaSoglieFissoRSDefault(pdvList);
          const newSoglia = defaults.find((d) => d.ragioneSociale === rs);
          if (newSoglia) filtered.push(newSoglia);
        }
      }
      setPistaFissoRSConfig({ sogliePerRS: filtered });
    }

    // Sincronizza Partnership RS
    const existingPartnershipRS = new Set(partnershipRewardRSConfig.configPerRS.map((s) => s.ragioneSociale));
    const needsPartnershipSync = ragioniSociali.some(rs => !existingPartnershipRS.has(rs)) || 
                                  partnershipRewardRSConfig.configPerRS.some(s => !currentRSSet.has(s.ragioneSociale));
    
    if (needsPartnershipSync && partnershipRewardRSConfig.configPerRS.length > 0) {
      const filtered = partnershipRewardRSConfig.configPerRS.filter((s) => currentRSSet.has(s.ragioneSociale));
      for (const rs of ragioniSociali) {
        if (!existingPartnershipRS.has(rs)) {
          const pdvList = rsMap.get(rs) || [];
          const defaults = generaPartnershipRSDefault(pdvList, partnershipRewardConfig);
          const newConfig = defaults.find((d) => d.ragioneSociale === rs);
          if (newConfig) filtered.push(newConfig);
        }
      }
      setPartnershipRewardRSConfig({ configPerRS: filtered });
    }
  }, [ragioniSociali, rsMap, puntiVendita, partnershipRewardConfig, pistaMobileRSConfig.sogliePerRS, pistaFissoRSConfig.sogliePerRS, partnershipRewardRSConfig.configPerRS, setPistaMobileRSConfig, setPistaFissoRSConfig, setPartnershipRewardRSConfig]);

  const updateMobileRSField = (
    ragioneSociale: string,
    field: keyof Omit<SoglieMobileRS, "ragioneSociale">,
    value: number
  ) => {
    setPistaMobileRSConfig((prev) => {
      const updated = prev.sogliePerRS.map((s) =>
        s.ragioneSociale === ragioneSociale ? { ...s, [field]: value } : s
      );
      return { ...prev, sogliePerRS: updated };
    });
  };

  const updateFissoRSField = (
    ragioneSociale: string,
    field: keyof Omit<SoglieFissoRS, "ragioneSociale">,
    value: number
  ) => {
    setPistaFissoRSConfig((prev) => {
      const updated = prev.sogliePerRS.map((s) =>
        s.ragioneSociale === ragioneSociale ? { ...s, [field]: value } : s
      );
      return { sogliePerRS: updated };
    });
  };

  // Update Partnership Reward RS
  const updatePartnershipRSField = (
    ragioneSociale: string,
    field: "target100" | "premio100",
    value: number
  ) => {
    setPartnershipRewardRSConfig((prev) => {
      const updated = prev.configPerRS.map((s) => {
        if (s.ragioneSociale === ragioneSociale) {
          if (field === "target100") {
            return { ...s, target100: value, target80: calculateTarget80(value) };
          } else {
            return { ...s, premio100: value, premio80: calculatePremio80(value) };
          }
        }
        return s;
      });
      return { configPerRS: updated };
    });
  };

  // Get Partnership RS config for a specific RS
  const getPartnershipRSConfig = (ragioneSociale: string): PartnershipRewardRS | undefined => {
    return partnershipRewardRSConfig.configPerRS.find((c) => c.ragioneSociale === ragioneSociale);
  };

  if (!puntiVendita.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Prima inserisci i punti vendita.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4 p-4 rounded-lg bg-gradient-to-r from-warning/10 to-accent/10 border border-warning/20">
        <div className="w-12 h-12 rounded-xl bg-warning/20 flex items-center justify-center shrink-0">
          <Building2 className="w-6 h-6 text-warning" />
        </div>
        <div>
          <h3 className="font-semibold text-foreground">Configurazione per Ragione Sociale</h3>
          <p className="text-sm text-muted-foreground mt-1">
            In modalità <strong>Gara operatore RS</strong>, le soglie sono aggregate per Ragione Sociale. 
            I valori di default sono la somma delle soglie dei singoli PDV.
          </p>
        </div>
      </div>

      <div className="grid gap-4">
        {ragioniSociali.map((rs) => {
          const pdvList = rsMap.get(rs) || [];
          const mobileConf = pistaMobileRSConfig.sogliePerRS.find((s) => s.ragioneSociale === rs);
          const fissoConf = pistaFissoRSConfig.sogliePerRS.find((s) => s.ragioneSociale === rs);
          const partnershipConf = getPartnershipRSConfig(rs);

          if (!mobileConf || !fissoConf) return null;

          return (
            <Card key={rs} className="border-border">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-primary" />
                    {rs}
                  </CardTitle>
                  <Badge variant="secondary" className="text-xs">
                    <Store className="w-3 h-3 mr-1" />
                    {pdvList.length} PDV
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  PDV: {pdvList.map((p) => p.codicePos || p.nome || "—").join(", ")}
                </p>
              </CardHeader>
              <CardContent className="pt-0 space-y-6">
                {/* SEZIONE MOBILE */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-1 bg-primary rounded-full" />
                    <Smartphone className="w-4 h-4 text-primary" />
                    <h4 className="font-semibold text-sm">Pista Mobile</h4>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Soglia 1</Label>
                      <Input
                        type="number"
                        value={mobileConf.soglia1 ?? ""}
                        onChange={(e) =>
                          updateMobileRSField(rs, "soglia1", Number(e.target.value) || 0)
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Soglia 2</Label>
                      <Input
                        type="number"
                        value={mobileConf.soglia2 ?? ""}
                        onChange={(e) =>
                          updateMobileRSField(rs, "soglia2", Number(e.target.value) || 0)
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Soglia 3</Label>
                      <Input
                        type="number"
                        value={mobileConf.soglia3 ?? ""}
                        onChange={(e) =>
                          updateMobileRSField(rs, "soglia3", Number(e.target.value) || 0)
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Soglia 4</Label>
                      <Input
                        type="number"
                        value={mobileConf.soglia4 ?? ""}
                        onChange={(e) =>
                          updateMobileRSField(rs, "soglia4", Number(e.target.value) || 0)
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Canone Medio (€)</Label>
                      <Input
                        type="number"
                        step="0.5"
                        value={mobileConf.canoneMedio ?? ""}
                        onChange={(e) =>
                          updateMobileRSField(rs, "canoneMedio", Number(e.target.value) || 0)
                        }
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Obiettivo punti Mobile (forecast)</Label>
                    <Input
                      type="number"
                      value={mobileConf.forecastTargetPunti ?? ""}
                      onChange={(e) =>
                        updateMobileRSField(rs, "forecastTargetPunti", Number(e.target.value) || 0)
                      }
                    />
                  </div>
                </div>

                <Separator />

                {/* SEZIONE FISSO */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-1 bg-emerald-500 rounded-full" />
                    <Phone className="w-4 h-4 text-emerald-600" />
                    <h4 className="font-semibold text-sm">Pista Fisso</h4>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Soglia 1</Label>
                      <Input
                        type="number"
                        value={fissoConf.soglia1 ?? ""}
                        onChange={(e) =>
                          updateFissoRSField(rs, "soglia1", Number(e.target.value) || 0)
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Soglia 2</Label>
                      <Input
                        type="number"
                        value={fissoConf.soglia2 ?? ""}
                        onChange={(e) =>
                          updateFissoRSField(rs, "soglia2", Number(e.target.value) || 0)
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Soglia 3</Label>
                      <Input
                        type="number"
                        value={fissoConf.soglia3 ?? ""}
                        onChange={(e) =>
                          updateFissoRSField(rs, "soglia3", Number(e.target.value) || 0)
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Soglia 4</Label>
                      <Input
                        type="number"
                        value={fissoConf.soglia4 ?? ""}
                        onChange={(e) =>
                          updateFissoRSField(rs, "soglia4", Number(e.target.value) || 0)
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Soglia 5</Label>
                      <Input
                        type="number"
                        value={fissoConf.soglia5 ?? ""}
                        onChange={(e) =>
                          updateFissoRSField(rs, "soglia5", Number(e.target.value) || 0)
                        }
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Obiettivo punti Fisso (forecast)</Label>
                    <Input
                      type="number"
                      value={fissoConf.forecastTargetPunti ?? ""}
                      onChange={(e) =>
                        updateFissoRSField(rs, "forecastTargetPunti", Number(e.target.value) || 0)
                      }
                    />
                  </div>
                </div>

                <Separator />

                {/* SEZIONE CB+ PARTNERSHIP REWARD */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-1 bg-accent rounded-full" />
                    <Gift className="w-4 h-4 text-accent" />
                    <h4 className="font-semibold text-sm">CB+ Partnership Reward</h4>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Target 100%</Label>
                      <Input
                        type="number"
                        value={partnershipConf?.target100 ?? ""}
                        onChange={(e) =>
                          updatePartnershipRSField(rs, "target100", Number(e.target.value) || 0)
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Target 80% (auto)</Label>
                      <Input
                        type="number"
                        value={partnershipConf?.target80 ?? ""}
                        disabled
                        className="bg-muted"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Premio 100% (€)</Label>
                      <Input
                        type="number"
                        value={partnershipConf?.premio100 ?? ""}
                        onChange={(e) =>
                          updatePartnershipRSField(rs, "premio100", Number(e.target.value) || 0)
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Premio 80% (€ auto)</Label>
                      <Input
                        type="number"
                        value={(partnershipConf?.premio80 ?? 0).toFixed(2)}
                        disabled
                        className="bg-muted"
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
