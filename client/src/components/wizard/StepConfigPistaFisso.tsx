import React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PuntoVendita } from "@/types/preventivatore";
import { PistaFissoPosConfig } from "@/lib/calcoloPistaFisso";

interface PistaFissoConfig {
  sogliePerPos: PistaFissoPosConfig[];
}

interface StepConfigPistaFissoProps {
  puntiVendita: PuntoVendita[];
  config: PistaFissoConfig;
  updateField: (
    index: number,
    field: keyof PistaFissoPosConfig,
    value: any
  ) => void;
}

export const StepConfigPistaFisso: React.FC<StepConfigPistaFissoProps> = ({
  puntiVendita,
  config,
  updateField,
}) => {
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
        Imposta per ciascun punto vendita le <strong>soglie FISSO</strong> e i{" "}
        <strong>moltiplicatori</strong> da applicare per ogni soglia raggiunta.
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
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
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
                  <div className="space-y-1">
                    <Label>Soglia 5 (punti)</Label>
                    <Input
                      type="number"
                      value={conf.soglia5 || ""}
                      onChange={(e) => {
                        const newSoglia5 = Number(e.target.value) || 0;
                        updateField(index, "soglia5", newSoglia5);
                        // Imposta forecast = soglia5 se non è stato modificato manualmente
                        if (!conf.forecastTargetPunti || conf.forecastTargetPunti === conf.soglia5) {
                          updateField(index, "forecastTargetPunti", newSoglia5);
                        }
                      }}
                    />
                  </div>
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

                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                  <div className="space-y-1">
                    <Label>Molt. Soglia 1</Label>
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
                    <Label>Molt. Soglia 2</Label>
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
                    <Label>Molt. Soglia 3</Label>
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
                    <Label>Molt. Soglia 4</Label>
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
                  <div className="space-y-1">
                    <Label>Molt. Soglia 5</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={conf.multiplierSoglia5 || ""}
                      onChange={(e) =>
                        updateField(
                          index,
                          "multiplierSoglia5",
                          Number(e.target.value) || 0
                        )
                      }
                    />
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
