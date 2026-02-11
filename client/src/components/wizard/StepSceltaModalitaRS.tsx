import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Building2, Store, BarChart3 } from "lucide-react";

export type ModalitaInserimentoRS = "per_rs" | "per_pdv" | null;

interface StepSceltaModalitaRSProps {
  modalita: ModalitaInserimentoRS;
  onModalitaChange: (modalita: "per_rs" | "per_pdv") => void;
  numRagioneSociale: number;
  numPdv: number;
}

export const StepSceltaModalitaRS: React.FC<StepSceltaModalitaRSProps> = ({
  modalita,
  onModalitaChange,
  numRagioneSociale,
  numPdv,
}) => {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
          <BarChart3 className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">Modalità di inserimento dati</h2>
          <p className="text-sm text-muted-foreground">
            Come vuoi inserire i dati di produzione?
          </p>
        </div>
      </div>

      {/* Selezione */}
      <RadioGroup
        value={modalita ?? ""}
        onValueChange={(val) => onModalitaChange(val as "per_rs" | "per_pdv")}
        className="space-y-4"
      >
        {/* Opzione 1: Per Ragione Sociale */}
        <Label
          htmlFor="per_rs"
          className="cursor-pointer"
        >
          <Card 
            className={`transition-all hover:shadow-md ${
              modalita === "per_rs" 
                ? "border-2 border-primary ring-2 ring-primary/20" 
                : "border-border hover:border-primary/50"
            }`}
          >
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <RadioGroupItem value="per_rs" id="per_rs" />
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Building2 className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1">
                  <CardTitle className="text-base">Totali per Ragione Sociale</CardTitle>
                  <CardDescription>
                    Inserisci i numeri aggregati per ogni azienda
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="pl-12 space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                    {numRagioneSociale}
                  </span>
                  <span>aziende da compilare</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  <strong>Più veloce</strong> se hai già i totali per ogni ragione sociale.
                </p>
                <p className="text-xs text-muted-foreground/70 italic">
                  Esempio: "TIM SpA" → 150 SIM, 80 Fisso, etc.
                </p>
              </div>
            </CardContent>
          </Card>
        </Label>

        {/* Opzione 2: Per PDV */}
        <Label
          htmlFor="per_pdv"
          className="cursor-pointer"
        >
          <Card 
            className={`transition-all hover:shadow-md ${
              modalita === "per_pdv" 
                ? "border-2 border-primary ring-2 ring-primary/20" 
                : "border-border hover:border-primary/50"
            }`}
          >
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <RadioGroupItem value="per_pdv" id="per_pdv" />
                <div className="w-10 h-10 rounded-lg bg-secondary/30 flex items-center justify-center">
                  <Store className="w-5 h-5 text-secondary-foreground" />
                </div>
                <div className="flex-1">
                  <CardTitle className="text-base">Dettaglio per ogni PDV</CardTitle>
                  <CardDescription>
                    Inserisci i numeri per ogni singolo negozio
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="pl-12 space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-secondary/30 text-secondary-foreground text-xs font-medium">
                    {numPdv}
                  </span>
                  <span>negozi da compilare</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  <strong>Più preciso</strong>, utile per analisi dettagliata.
                </p>
                <p className="text-xs text-muted-foreground/70 italic">
                  Esempio: "TIM Roma Centro" → 50 SIM, 25 Fisso
                </p>
              </div>
            </CardContent>
          </Card>
        </Label>
      </RadioGroup>

      {/* Info aggiuntive */}
      {modalita && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">
              {modalita === "per_rs" ? (
                <>
                  <strong className="text-foreground">Nota:</strong> I premi saranno calcolati in base alle soglie configurate per Ragione Sociale nello step precedente.
                </>
              ) : (
                <>
                  <strong className="text-foreground">Nota:</strong> I dati inseriti per PDV verranno aggregati per calcolare i premi in base alle soglie RS.
                </>
              )}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
