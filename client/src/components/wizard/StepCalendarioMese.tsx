import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PuntoVendita } from "@/types/preventivatore";
import { isStoreOpenOnDate } from "@/utils/calendario";
import { cn } from "@/lib/utils";
import { Edit2, Check, X } from "lucide-react";

// Tipo per lo stato del giorno
export type DayStatus = "worked" | "remaining" | "closed";

// Override per un singolo PDV
export interface CalendarioMeseOverride {
  dayStatuses: Record<string, DayStatus>; // chiave = "YYYY-MM-DD"
}

// Override per tutti i PDV
export type CalendariMeseOverrides = Record<string, CalendarioMeseOverride>;

interface StepCalendarioMeseProps {
  puntiVendita: PuntoVendita[];
  anno: number;
  meseGara: number; // 1-indexed (gennaio = 1)
  calendarioOverrides?: CalendariMeseOverrides;
  onCalendarioOverridesChange?: (overrides: CalendariMeseOverrides) => void;
}

const GIORNI_SETTIMANA = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];
const MESI = [
  "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"
];

const STATUS_CYCLE: DayStatus[] = ["worked", "remaining", "closed"];

const STATUS_LABELS: Record<DayStatus, string> = {
  worked: "Lavorato",
  remaining: "Da lavorare",
  closed: "Chiuso",
};

export const StepCalendarioMese: React.FC<StepCalendarioMeseProps> = ({
  puntiVendita,
  anno,
  meseGara,
  calendarioOverrides = {},
  onCalendarioOverridesChange,
}) => {
  const [editingPdvId, setEditingPdvId] = useState<string | null>(null);
  const today = new Date();
  const monthIndex = meseGara - 1; // Convert to 0-indexed

  if (!puntiVendita.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Prima inserisci almeno un punto vendita.
      </p>
    );
  }

  // Genera i giorni del mese
  const firstDayOfMonth = new Date(anno, monthIndex, 1);
  const lastDayOfMonth = new Date(anno, monthIndex + 1, 0);
  const daysInMonth = lastDayOfMonth.getDate();
  const startingDayOfWeek = firstDayOfMonth.getDay(); // 0 = domenica

  const calendarDays: (number | null)[] = [];
  // Aggiungi celle vuote per i giorni prima dell'inizio del mese
  for (let i = 0; i < startingDayOfWeek; i++) {
    calendarDays.push(null);
  }
  // Aggiungi i giorni del mese
  for (let day = 1; day <= daysInMonth; day++) {
    calendarDays.push(day);
  }

  // Formatta data in YYYY-MM-DD
  const formatDate = (day: number): string => {
    const m = String(monthIndex + 1).padStart(2, "0");
    const d = String(day).padStart(2, "0");
    return `${anno}-${m}-${d}`;
  };

  // Calcola lo stato di default di un giorno
  const getDefaultDayStatus = (day: number, pdv: PuntoVendita): DayStatus => {
    const date = new Date(anno, monthIndex, day);
    const isOpen = isStoreOpenOnDate(date, pdv.calendar);
    
    if (!isOpen) return "closed";
    
    // Se è aperto, controlla se è passato
    if (date <= today) return "worked";
    return "remaining";
  };

  // Ottieni lo stato effettivo del giorno (con override)
  const getDayStatus = (day: number, pdv: PuntoVendita): DayStatus => {
    const dateKey = formatDate(day);
    const pdvOverrides = calendarioOverrides[pdv.id];
    
    if (pdvOverrides?.dayStatuses[dateKey]) {
      return pdvOverrides.dayStatuses[dateKey];
    }
    
    return getDefaultDayStatus(day, pdv);
  };

  // Gestisce il click su un giorno
  const handleDayClick = (day: number, pdv: PuntoVendita) => {
    if (editingPdvId !== pdv.id || !onCalendarioOverridesChange) return;

    const dateKey = formatDate(day);
    const currentStatus = getDayStatus(day, pdv);
    const currentIndex = STATUS_CYCLE.indexOf(currentStatus);
    const nextStatus = STATUS_CYCLE[(currentIndex + 1) % STATUS_CYCLE.length];
    
    // Se il nuovo stato è uguale al default, rimuovi l'override
    const defaultStatus = getDefaultDayStatus(day, pdv);
    
    const pdvOverrides = calendarioOverrides[pdv.id] || { dayStatuses: {} };
    const newDayStatuses = { ...pdvOverrides.dayStatuses };
    
    if (nextStatus === defaultStatus) {
      delete newDayStatuses[dateKey];
    } else {
      newDayStatuses[dateKey] = nextStatus;
    }
    
    onCalendarioOverridesChange({
      ...calendarioOverrides,
      [pdv.id]: { dayStatuses: newDayStatuses },
    });
  };

  // Calcola le statistiche con override
  const getStatsWithOverrides = (pdv: PuntoVendita) => {
    let worked = 0;
    let remaining = 0;
    let closed = 0;
    
    for (let day = 1; day <= daysInMonth; day++) {
      const status = getDayStatus(day, pdv);
      if (status === "worked") worked++;
      else if (status === "remaining") remaining++;
      else closed++;
    }
    
    const totalWorking = worked + remaining;
    const projectionFactor = worked > 0 ? totalWorking / worked : 1;
    
    return { worked, remaining, closed, totalWorking, projectionFactor };
  };

  return (
    <div className="space-y-4">
      <div className="text-center mb-4">
        <h3 className="text-lg font-semibold">
          Calendario {MESI[monthIndex]} {anno}
        </h3>
        <p className="text-sm text-muted-foreground">
          Clicca su "Modifica" per cambiare lo stato dei giorni. I calcoli di proiezione useranno questi dati.
        </p>
      </div>

      {/* Legenda globale */}
      <div className="flex justify-center gap-4 text-xs flex-wrap">
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded bg-green-500/30 border border-green-500/50" />
          <span className="text-muted-foreground">Lavorato</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded bg-blue-500/30 border border-blue-500/50" />
          <span className="text-muted-foreground">Da lavorare</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded bg-muted/50 border border-muted-foreground/30" />
          <span className="text-muted-foreground">Chiuso</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded ring-2 ring-primary ring-offset-1" />
          <span className="text-muted-foreground">Oggi</span>
        </div>
      </div>

      <div className="grid gap-4">
        {puntiVendita.map((pdv) => {
          const stats = getStatsWithOverrides(pdv);
          const isEditing = editingPdvId === pdv.id;
          
          return (
            <Card key={pdv.id} className={cn("border-border", isEditing && "ring-2 ring-primary")}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    <span>{pdv.nome || "Punto vendita"} – POS {pdv.codicePos || "—"}</span>
                  </CardTitle>
                  {onCalendarioOverridesChange && (
                    <Button
                      variant={isEditing ? "default" : "outline"}
                      size="sm"
                      onClick={() => setEditingPdvId(isEditing ? null : pdv.id)}
                    >
                      {isEditing ? (
                        <>
                          <Check className="h-4 w-4 mr-1" />
                          Fine
                        </>
                      ) : (
                        <>
                          <Edit2 className="h-4 w-4 mr-1" />
                          Modifica
                        </>
                      )}
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {pdv.ragioneSociale || "Ragione sociale non indicata"}
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Riepilogo giorni */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-green-500/10 rounded-lg p-2">
                    <div className="text-2xl font-bold text-green-600">{stats.worked}</div>
                    <div className="text-xs text-muted-foreground">Lavorati</div>
                  </div>
                  <div className="bg-blue-500/10 rounded-lg p-2">
                    <div className="text-2xl font-bold text-blue-600">{stats.remaining}</div>
                    <div className="text-xs text-muted-foreground">Restanti</div>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-2">
                    <div className="text-2xl font-bold text-muted-foreground">{stats.closed}</div>
                    <div className="text-xs text-muted-foreground">Chiusi</div>
                  </div>
                </div>

                {/* Fattore proiezione */}
                {stats.worked > 0 && stats.remaining > 0 && (
                  <div className="text-center text-sm text-muted-foreground">
                    Fattore proiezione: <span className="font-semibold text-foreground">
                      {stats.projectionFactor.toFixed(2)}x
                    </span>
                    <span className="ml-2 text-xs">
                      ({stats.totalWorking} totali / {stats.worked} lavorati)
                    </span>
                  </div>
                )}

                {/* Calendario visivo */}
                <div className={cn("border rounded-lg p-2", isEditing && "bg-muted/20")}>
                  {isEditing && (
                    <p className="text-xs text-center text-primary mb-2 font-medium">
                      Clicca sui giorni per cambiare lo stato
                    </p>
                  )}
                  
                  {/* Header giorni settimana */}
                  <div className="grid grid-cols-7 gap-1 mb-1">
                    {GIORNI_SETTIMANA.map((giorno) => (
                      <div
                        key={giorno}
                        className="text-center text-xs font-medium text-muted-foreground py-1"
                      >
                        {giorno}
                      </div>
                    ))}
                  </div>

                  {/* Griglia giorni */}
                  <div className="grid grid-cols-7 gap-1">
                    {calendarDays.map((day, index) => {
                      if (day === null) {
                        return <div key={`empty-${index}`} className="aspect-square" />;
                      }

                      const date = new Date(anno, monthIndex, day);
                      const status = getDayStatus(day, pdv);
                      const dateKey = formatDate(day);
                      const hasOverride = calendarioOverrides[pdv.id]?.dayStatuses[dateKey] !== undefined;
                      const isToday = 
                        today.getDate() === day && 
                        today.getMonth() === monthIndex && 
                        today.getFullYear() === anno;

                      return (
                        <button
                          key={day}
                          onClick={() => handleDayClick(day, pdv)}
                          disabled={!isEditing}
                          className={cn(
                            "aspect-square flex items-center justify-center text-xs rounded-md transition-all relative",
                            status === "worked" && "bg-green-500/30 text-green-700 border border-green-500/50",
                            status === "remaining" && "bg-blue-500/30 text-blue-700 border border-blue-500/50",
                            status === "closed" && "bg-muted/50 text-muted-foreground border border-muted-foreground/30",
                            isToday && "ring-2 ring-primary ring-offset-1",
                            isEditing && "cursor-pointer hover:opacity-70 hover:scale-105",
                            !isEditing && "cursor-default",
                            hasOverride && "font-bold"
                          )}
                          title={`${day} ${MESI[monthIndex]} - ${STATUS_LABELS[status]}${hasOverride ? " (modificato)" : ""}`}
                        >
                          {day}
                          {hasOverride && (
                            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-primary rounded-full" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Indicatore modifiche */}
                {Object.keys(calendarioOverrides[pdv.id]?.dayStatuses || {}).length > 0 && (
                  <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="text-xs">
                      {Object.keys(calendarioOverrides[pdv.id]?.dayStatuses || {}).length} giorni modificati
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
