import React, { useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PuntoVendita, PistaMobileConfig, PistaMobilePosConfig } from "@/types/preventivatore";
import { getThresholdsByCluster, mapClusterMobileToClusterPista } from "@/utils/preventivatore-helpers";

interface StepConfigPistaMobileProps {
  puntiVendita: PuntoVendita[];
  config: PistaMobileConfig;
  updateField: (
    index: number,
    field: keyof PistaMobilePosConfig,
    value: any
  ) => void;
}

export const StepConfigPistaMobile: React.FC<StepConfigPistaMobileProps> = ({
  puntiVendita,
  config,
  updateField,
}) => {
  // Inizializza o aggiorna i valori in base al cluster mobile selezionato
  useEffect(() => {
    puntiVendita.forEach((pdv, index) => {
      const conf = config.sogliePerPos[index];
      if (conf && pdv.clusterMobile) {
        // Mappa il cluster mobile al cluster pista
        const derivedClusterPista = mapClusterMobileToClusterPista(pdv.clusterMobile);
        
        // Aggiorna clusterPista se diverso
        if (conf.clusterPista !== derivedClusterPista) {
          updateField(index, "clusterPista", derivedClusterPista);
        }
        
        // Calcola le soglie corrette
        const thresholds = getThresholdsByCluster(
          pdv.tipoPosizione,
          derivedClusterPista,
          pdv.clusterMobile
        );
        
        // Aggiorna le soglie se diverse
        if (
          conf.soglia1 !== thresholds.soglia1 ||
          conf.soglia2 !== thresholds.soglia2 ||
          conf.soglia3 !== thresholds.soglia3 ||
          conf.soglia4 !== thresholds.soglia4
        ) {
          updateField(index, "soglia1", thresholds.soglia1);
          updateField(index, "soglia2", thresholds.soglia2);
          updateField(index, "soglia3", thresholds.soglia3);
          updateField(index, "soglia4", thresholds.soglia4);
        }

        // Aggiorna il canone medio se è ancora il vecchio default (16)
        if (conf.canoneMedio === 16) {
          updateField(index, "canoneMedio", 10);
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

  const handleClusterChange = (index: number, newCluster: 1 | 2 | 3) => {
    const pdv = puntiVendita[index];
    updateField(index, "clusterPista", newCluster);
    
    // Aggiorna automaticamente le soglie in base al nuovo cluster
    const thresholds = getThresholdsByCluster(
      pdv.tipoPosizione,
      newCluster,
      pdv.clusterMobile
    );
    updateField(index, "soglia1", thresholds.soglia1);
    updateField(index, "soglia2", thresholds.soglia2);
    updateField(index, "soglia3", thresholds.soglia3);
    updateField(index, "soglia4", thresholds.soglia4);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Imposta per ciascun punto vendita le <strong>soglie Mobile</strong>, il{" "}
        <strong>canone medio</strong> su cui calcolare il commissioning e
        l'eventuale <strong>obiettivo di punti (forecast)</strong>.
      </p>

      <div className="grid gap-4">
        {puntiVendita.map((pdv, index) => {
          const conf = config.sogliePerPos[index];
          if (!conf) return null;
          return (
            <Card key={pdv.id} className="border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {pdv.nome || "Punto vendita"} – POS {pdv.codicePos || "—"}
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {pdv.ragioneSociale || "Ragione sociale non indicata"}
                </p>
              </CardHeader>
              <CardContent className="pt-0 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="space-y-1">
                    <Label>Soglia 1 (punti)</Label>
                    <Input
                      type="number"
                      value={conf.soglia1 || ""}
                      onChange={(e) =>
                        updateField(
                          index,
                          "soglia1",
                          Number(e.target.value) || 0
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Soglia 2 (punti)</Label>
                    <Input
                      type="number"
                      value={conf.soglia2 || ""}
                      onChange={(e) =>
                        updateField(
                          index,
                          "soglia2",
                          Number(e.target.value) || 0
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Soglia 3 (punti)</Label>
                    <Input
                      type="number"
                      value={conf.soglia3 || ""}
                      onChange={(e) =>
                        updateField(
                          index,
                          "soglia3",
                          Number(e.target.value) || 0
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Soglia 4 (punti)</Label>
                    <Input
                      type="number"
                      value={conf.soglia4 || ""}
                      onChange={(e) =>
                        updateField(
                          index,
                          "soglia4",
                          Number(e.target.value) || 0
                        )
                      }
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="space-y-1">
                    <Label>Moltiplicatore Soglia 1</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={conf.multiplierSoglia1 || ""}
                      onChange={(e) =>
                        updateField(
                          index,
                          "multiplierSoglia1",
                          Number(e.target.value) || 0
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Moltiplicatore Soglia 2</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={conf.multiplierSoglia2 || ""}
                      onChange={(e) =>
                        updateField(
                          index,
                          "multiplierSoglia2",
                          Number(e.target.value) || 0
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Moltiplicatore Soglia 3</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={conf.multiplierSoglia3 || ""}
                      onChange={(e) =>
                        updateField(
                          index,
                          "multiplierSoglia3",
                          Number(e.target.value) || 0
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Moltiplicatore Soglia 4</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={conf.multiplierSoglia4 || ""}
                      onChange={(e) =>
                        updateField(
                          index,
                          "multiplierSoglia4",
                          Number(e.target.value) || 0
                        )
                      }
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <Label>Canone medio Mobile (€)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={conf.canoneMedio || ""}
                      onChange={(e) =>
                        updateField(
                          index,
                          "canoneMedio",
                          Number(e.target.value) || 0
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Obiettivo punti (forecast)</Label>
                    <Input
                      type="number"
                      value={conf.forecastTargetPunti || ""}
                      onChange={(e) =>
                        updateField(
                          index,
                          "forecastTargetPunti",
                          Number(e.target.value) || 0
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Cluster pista Mobile</Label>
                    <RadioGroup
                      className="flex gap-4 mt-1"
                      value={String(conf.clusterPista ?? 1)}
                      onValueChange={(value) =>
                        handleClusterChange(index, Number(value) as 1 | 2 | 3)
                      }
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="1" id={`cl1-${pdv.id}`} />
                        <Label htmlFor={`cl1-${pdv.id}`}>1</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="2" id={`cl2-${pdv.id}`} />
                        <Label htmlFor={`cl2-${pdv.id}`}>2</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="3" id={`cl3-${pdv.id}`} />
                        <Label htmlFor={`cl3-${pdv.id}`}>3</Label>
                      </div>
                    </RadioGroup>
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
