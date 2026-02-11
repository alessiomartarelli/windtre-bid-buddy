import React, { useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PuntoVendita, Weekday, WEEKDAY_LABELS } from "@/types/preventivatore";

interface StepCalendariProps {
  puntiVendita: PuntoVendita[];
  annoGara: number;
  meseGara: number;
  updatePdvField: <K extends keyof PuntoVendita>(
    index: number,
    field: K,
    value: PuntoVendita[K]
  ) => void;
}

const MESI = [
  "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"
];

export const StepCalendari: React.FC<StepCalendariProps> = ({
  puntiVendita,
  annoGara,
  meseGara,
  updatePdvField,
}) => {
  // Gestione automatica della domenica in base al tipo posizione
  useEffect(() => {
    puntiVendita.forEach((pdv, index) => {
      const workingDays = pdv.calendar?.weeklySchedule?.workingDays ?? [];
      const hasDomenica = workingDays.includes(0); // 0 = Domenica
      
      if (pdv.tipoPosizione === "centro_commerciale" && !hasDomenica) {
        // Aggiungi domenica per centri commerciali
        updatePdvField(index, "calendar", {
          ...pdv.calendar,
          weeklySchedule: { workingDays: [...workingDays, 0] },
        });
      } else if (pdv.tipoPosizione === "strada" && hasDomenica) {
        // Rimuovi domenica per negozi su strada
        const newWorkingDays = workingDays.filter((d) => d !== 0) as Weekday[];
        updatePdvField(index, "calendar", {
          ...pdv.calendar,
          weeklySchedule: { workingDays: newWorkingDays },
        });
      }
    });
  }, [puntiVendita.map(p => `${p.id}-${p.tipoPosizione}`).join(',')]);

  if (!puntiVendita.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Prima inserisci almeno un punto vendita.
      </p>
    );
  }

  const toggleDay = (index: number, day: Weekday, checked: boolean) => {
    const pdv = puntiVendita[index];
    const current = pdv.calendar?.weeklySchedule?.workingDays ?? [];
    let next: Weekday[];
    if (checked) {
      if (current.includes(day)) next = current;
      else next = [...current, day];
    } else {
      next = current.filter((d) => d !== day) as Weekday[];
    }
    updatePdvField(index, "calendar", {
      ...pdv.calendar,
      weeklySchedule: { workingDays: next },
    });
  };

  return (
    <div className="space-y-4">
      <div className="text-center mb-4">
        <h3 className="text-lg font-semibold">
          Calendari per {MESI[meseGara - 1]} {annoGara}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Imposta i <strong>giorni lavorativi</strong> per ciascun punto vendita.
          Serviranno per calcolare le proiezioni a fine mese e gli economici per
          competenza.
        </p>
      </div>

      <div className="grid gap-4">
        {puntiVendita.map((pdv, index) => {
          const workingDays = pdv.calendar?.weeklySchedule?.workingDays ?? [];
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
              <CardContent className="pt-0 space-y-2">
                <Label className="text-sm">Giorni di apertura settimanale</Label>
                <div className="flex flex-wrap gap-3 mt-1">
                  {WEEKDAY_LABELS.map((w) => (
                    <div key={w.value} className="flex items-center space-x-2">
                      <Checkbox
                        checked={workingDays.includes(w.value)}
                        onCheckedChange={(checked) =>
                          toggleDay(index, w.value, Boolean(checked))
                        }
                        id={`wd-${pdv.id}-${w.value}`}
                      />
                      <Label
                        htmlFor={`wd-${pdv.id}-${w.value}`}
                        className="text-xs"
                      >
                        {w.label}
                      </Label>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Per semplicità non stiamo gestendo qui le chiusure straordinarie:
                  puoi comunque aggiungerle in una fase successiva.
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
