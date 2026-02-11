import React, { useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PuntoVendita, PistaMobileConfig, PistaMobilePosConfig } from "@/types/preventivatore";
import { PistaFissoPosConfig } from "@/lib/calcoloPistaFisso";
import { getThresholdsByCluster, mapClusterMobileToClusterPista } from "@/utils/preventivatore-helpers";
import { 
  PartnershipRewardPosConfig, 
  getDefaultTarget100, 
  calculateTarget80, 
  calculatePremio80 
} from "@/types/partnership-reward";

interface StepConfigPisteProps {
  puntiVendita: PuntoVendita[];
  pistaMobileConfig: PistaMobileConfig;
  pistaFissoConfig: { sogliePerPos: PistaFissoPosConfig[] };
  partnershipRewardConfig: { configPerPos: PartnershipRewardPosConfig[] };
  updateMobileField: (index: number, field: keyof PistaMobilePosConfig, value: any) => void;
  updateFissoField: (index: number, field: keyof PistaFissoPosConfig, value: any) => void;
  updatePartnershipField: (index: number, field: "target100" | "premio100", value: number) => void;
}

export const StepConfigPiste: React.FC<StepConfigPisteProps> = ({
  puntiVendita,
  pistaMobileConfig,
  pistaFissoConfig,
  partnershipRewardConfig,
  updateMobileField,
  updateFissoField,
  updatePartnershipField,
}) => {
  // Inizializza i valori Mobile in base al cluster
  useEffect(() => {
    puntiVendita.forEach((pdv, index) => {
      const conf = pistaMobileConfig.sogliePerPos[index];
      if (conf && pdv.clusterMobile) {
        const derivedClusterPista = mapClusterMobileToClusterPista(pdv.clusterMobile);
        
        if (conf.clusterPista !== derivedClusterPista) {
          updateMobileField(index, "clusterPista", derivedClusterPista);
        }
        
        const thresholds = getThresholdsByCluster(
          pdv.tipoPosizione,
          derivedClusterPista,
          pdv.clusterMobile
        );
        
        if (
          conf.soglia1 !== thresholds.soglia1 ||
          conf.soglia2 !== thresholds.soglia2 ||
          conf.soglia3 !== thresholds.soglia3 ||
          conf.soglia4 !== thresholds.soglia4
        ) {
          updateMobileField(index, "soglia1", thresholds.soglia1);
          updateMobileField(index, "soglia2", thresholds.soglia2);
          updateMobileField(index, "soglia3", thresholds.soglia3);
          updateMobileField(index, "soglia4", thresholds.soglia4);
        }

        if (conf.canoneMedio === 16) {
          updateMobileField(index, "canoneMedio", 10);
        }
      }
    });
  }, [puntiVendita.map(p => `${p.tipoPosizione}-${p.clusterMobile}`).join(',')]);

  if (!puntiVendita.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Prima inserisci i punti vendita.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Configura le soglie <strong>Mobile</strong> e <strong>Fisso</strong>, 
        il canone medio, gli obiettivi e i target <strong>Partnership Reward</strong> per ciascun punto vendita.
      </p>

      <div className="grid gap-4">
        {puntiVendita.map((pdv, index) => {
          const mobileConf = pistaMobileConfig.sogliePerPos[index];
          const fissoConf = pistaFissoConfig.sogliePerPos[index];
          const partnershipConf = partnershipRewardConfig.configPerPos[index];
          
          if (!mobileConf || !fissoConf || !partnershipConf) return null;

          const target80 = calculateTarget80(partnershipConf.config.target100);
          const premio80 = calculatePremio80(partnershipConf.config.premio100);

          return (
            <Card key={pdv.id} className="border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  {pdv.nome || "Punto vendita"} – POS {pdv.codicePos || "—"}
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {pdv.ragioneSociale || "Ragione sociale non indicata"} | {pdv.tipoPosizione === "centro_commerciale" ? "CC" : "Strada"}
                </p>
              </CardHeader>
              <CardContent className="pt-0 space-y-6">
                {/* SEZIONE MOBILE */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-1 bg-primary rounded-full" />
                    <h4 className="font-semibold text-sm">Pista Mobile</h4>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Soglia 1</Label>
                      <Input
                        type="number"
                        value={mobileConf.soglia1 ?? ""}
                        onChange={(e) =>
                          updateMobileField(index, "soglia1", Number(e.target.value) || 0)
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Soglia 2</Label>
                      <Input
                        type="number"
                        value={mobileConf.soglia2 ?? ""}
                        onChange={(e) =>
                          updateMobileField(index, "soglia2", Number(e.target.value) || 0)
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Soglia 3</Label>
                      <Input
                        type="number"
                        value={mobileConf.soglia3 ?? ""}
                        onChange={(e) =>
                          updateMobileField(index, "soglia3", Number(e.target.value) || 0)
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Soglia 4</Label>
                      <Input
                        type="number"
                        value={mobileConf.soglia4 ?? ""}
                        onChange={(e) =>
                          updateMobileField(index, "soglia4", Number(e.target.value) || 0)
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
                          updateMobileField(index, "canoneMedio", Number(e.target.value) || 0)
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
                        updateMobileField(index, "forecastTargetPunti", Number(e.target.value) || 0)
                      }
                    />
                  </div>
                </div>

                <Separator />

                {/* SEZIONE FISSO */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-1 bg-secondary rounded-full" />
                    <h4 className="font-semibold text-sm">Pista Fisso</h4>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Soglia 1</Label>
                      <Input
                        type="number"
                        value={fissoConf.soglia1 ?? ""}
                        onChange={(e) =>
                          updateFissoField(index, "soglia1", Number(e.target.value) || 0)
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Soglia 2</Label>
                      <Input
                        type="number"
                        value={fissoConf.soglia2 ?? ""}
                        onChange={(e) =>
                          updateFissoField(index, "soglia2", Number(e.target.value) || 0)
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Soglia 3</Label>
                      <Input
                        type="number"
                        value={fissoConf.soglia3 ?? ""}
                        onChange={(e) =>
                          updateFissoField(index, "soglia3", Number(e.target.value) || 0)
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Soglia 4</Label>
                      <Input
                        type="number"
                        value={fissoConf.soglia4 ?? ""}
                        onChange={(e) => {
                          const newSoglia4 = Number(e.target.value) || 0;
                          updateFissoField(index, "soglia4", newSoglia4);
                          if (!fissoConf.forecastTargetPunti || fissoConf.forecastTargetPunti === fissoConf.soglia4) {
                            updateFissoField(index, "forecastTargetPunti", newSoglia4);
                          }
                        }}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Obiettivo punti Fisso (forecast)</Label>
                    <Input
                      type="number"
                      value={fissoConf.forecastTargetPunti ?? ""}
                      onChange={(e) =>
                        updateFissoField(index, "forecastTargetPunti", Number(e.target.value) || 0)
                      }
                    />
                  </div>
                </div>

                <Separator />

                {/* SEZIONE PARTNERSHIP REWARD */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-1 bg-accent rounded-full" />
                    <h4 className="font-semibold text-sm">Partnership Reward</h4>
                    <span className="text-xs text-muted-foreground">
                      (Cluster CB: {pdv.clusterCB || "—"})
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Target 100%</Label>
                      <Input
                        type="number"
                        value={partnershipConf.config.target100 ?? ""}
                        onChange={(e) =>
                          updatePartnershipField(index, "target100", Number(e.target.value) || 0)
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Target 80%</Label>
                      <Input
                        type="number"
                        value={target80}
                        disabled
                        className="bg-muted"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Premio 100% (€)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={partnershipConf.config.premio100 ?? ""}
                        onChange={(e) =>
                          updatePartnershipField(index, "premio100", Number(e.target.value) || 0)
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Premio 80% (€)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={premio80}
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
