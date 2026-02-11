import React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PuntoVendita } from "@/types/preventivatore";
import { formatCurrency } from "@/utils/format";
import { Monitor } from "lucide-react";
import {
  AttivatoFissoRiga,
  FissoCategoriaType,
  FISSO_CATEGORIE_DEFAULT,
  CalcoloFissoPerPosResult,
  PistaFissoPosConfig,
} from "@/lib/calcoloPistaFisso";
import { StepContentHeader } from "./StepContentHeader";

interface StepAttivatoFissoProps {
  puntiVendita: PuntoVendita[];
  pistaFissoConfig: { sogliePerPos: PistaFissoPosConfig[] };
  anno: number;
  monthIndex: number;
  attivatoFissoByPos: Record<string, AttivatoFissoRiga[]>;
  setAttivatoFissoByPos: React.Dispatch<React.SetStateAction<Record<string, AttivatoFissoRiga[]>>>;
  fissoResults: {
    pdv: PuntoVendita;
    conf: PistaFissoPosConfig;
    righe: AttivatoFissoRiga[];
    result: CalcoloFissoPerPosResult;
  }[];
  totalePremioFissoPrevisto: number;
}

export const StepAttivatoFisso: React.FC<StepAttivatoFissoProps> = ({
  puntiVendita,
  attivatoFissoByPos,
  setAttivatoFissoByPos,
  fissoResults,
  totalePremioFissoPrevisto,
}) => {
  // Funzione per ottenere o creare il valore per una categoria specifica
  const getOrCreatePezzi = (pdvId: string, categoria: FissoCategoriaType): number => {
    const righe = attivatoFissoByPos[pdvId] ?? [];
    const riga = righe.find((r) => r.categoria === categoria);
    return riga?.pezzi ?? 0;
  };

  // Funzione per aggiornare i pezzi di una categoria specifica
  const updatePezzi = (pdvId: string, categoria: FissoCategoriaType, pezzi: number) => {
    setAttivatoFissoByPos((prev) => {
      const righe = prev[pdvId] ?? [];
      
      // Validazione per PIU_SICURI_CASA_UFFICIO
      if (categoria === "PIU_SICURI_CASA_UFFICIO") {
        // Max = somma delle 4 categorie tecnologia (FTTC + FTTH + FWA_OUT + FWA_IND_2P)
        const categorieTecnologia: FissoCategoriaType[] = [
          "FISSO_FTTC", "FISSO_FTTH", "FISSO_FWA_OUT", "FISSO_FWA_IND_2P"
        ];
        const maxPiuSicuri = righe
          .filter((r) => categorieTecnologia.includes(r.categoria))
          .reduce((sum, r) => sum + r.pezzi, 0);
        
        // Limita il valore inserito
        if (pezzi > maxPiuSicuri) {
          pezzi = maxPiuSicuri;
        }
      }
      
      const existingIndex = righe.findIndex((r) => r.categoria === categoria);

      if (existingIndex >= 0) {
        // Aggiorna esistente
        const updated = [...righe];
        updated[existingIndex] = { ...updated[existingIndex], pezzi };
        return { ...prev, [pdvId]: updated };
      } else {
        // Crea nuovo
        const newRiga: AttivatoFissoRiga = {
          categoria,
          pezzi,
        };
        return { ...prev, [pdvId]: [...righe, newRiga] };
      }
    });
  };

  if (!puntiVendita.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Prima inserisci almeno un punto vendita negli step precedenti.
      </p>
    );
  }

  // Calcola totali
  const categorieTecnologia: FissoCategoriaType[] = ["FISSO_FTTC", "FISSO_FTTH", "FISSO_FWA_OUT", "FISSO_FWA_IND_2P"];
  const totalePezzi = fissoResults.reduce((sum, r) => {
    const righe = attivatoFissoByPos[r.pdv.id] ?? [];
    const pezziPos = righe
      .filter((riga) => categorieTecnologia.includes(riga.categoria))
      .reduce((pSum, riga) => pSum + riga.pezzi, 0);
    return sum + pezziPos;
  }, 0);
  const totalePunti = fissoResults.reduce((sum, r) => sum + r.result.punti, 0);

  if (!puntiVendita.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Prima inserisci almeno un punto vendita negli step precedenti.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <StepContentHeader
        icon={Monitor}
        title="Volumi Fisso"
        subtitle="Inserisci per ogni punto vendita i pezzi per ogni categoria FISSO"
        totalPremio={totalePremioFissoPrevisto}
        extraInfo={`${totalePezzi} pezzi · ${totalePunti.toFixed(2)} punti`}
      />


      {puntiVendita.map((pdv, pdvIndex) => {
        const result = fissoResults.find((r) => r.pdv.id === pdv.id);

        return (
          <Card key={pdv.id} className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <div>
                  {pdv.nome || "Punto vendita"} – POS {pdv.codicePos || "—"}
                  <span className="text-xs text-muted-foreground ml-2">
                    (Cluster Fisso: {pdv.clusterFisso || "—"})
                  </span>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Tabella inserimento volumi */}
              {/* Sezione 1: Tecnologie */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Tecnologie</p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  {FISSO_CATEGORIE_DEFAULT.filter(cat => 
                    ["FISSO_FTTC", "FISSO_FTTH", "FISSO_FWA_OUT", "FISSO_FWA_IND_2P"].includes(cat.type)
                  ).map((cat) => (
                    <div key={cat.type} className="space-y-1.5">
                      <Label className="text-xs">{cat.label}</Label>
                      <Input type="number" min={0} value={getOrCreatePezzi(pdv.id, cat.type) || ""} onChange={(e) => { const val = parseInt(e.target.value) || 0; updatePezzi(pdv.id, cat.type, Math.max(0, val)); }} placeholder="0" className="h-9" />
                    </div>
                  ))}
                </div>
              </div>

              {/* Sezione 2: di cui P.IVA */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">di cui P.IVA</p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {FISSO_CATEGORIE_DEFAULT.filter(cat => 
                    ["FISSO_PIVA_1A_LINEA", "FISSO_PIVA_2A_LINEA", "FRITZ_BOX"].includes(cat.type)
                  ).map((cat) => (
                    <div key={cat.type} className="space-y-1.5">
                      <Label className="text-xs">{cat.label}</Label>
                      <Input type="number" min={0} value={getOrCreatePezzi(pdv.id, cat.type) || ""} onChange={(e) => { const val = parseInt(e.target.value) || 0; updatePezzi(pdv.id, cat.type, Math.max(0, val)); }} placeholder="0" className="h-9" />
                    </div>
                  ))}
                </div>
              </div>

              {/* Sezione 3: Dettagli e Add-on */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Dettagli e Add-on</p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {FISSO_CATEGORIE_DEFAULT.filter(cat => 
                    !["FISSO_FTTC", "FISSO_FTTH", "FISSO_FWA_OUT", "FISSO_FWA_IND_2P", "FISSO_PIVA_1A_LINEA", "FISSO_PIVA_2A_LINEA", "FRITZ_BOX"].includes(cat.type)
                  ).map((cat) => (
                    <div key={cat.type} className="space-y-1.5">
                      <Label className="text-xs">{cat.label}</Label>
                      <Input
                        type="number"
                        min={0}
                        max={cat.type === "PIU_SICURI_CASA_UFFICIO" ? (() => {
                          const righe = attivatoFissoByPos[pdv.id] ?? [];
                          const categorieTecnologia: FissoCategoriaType[] = [
                            "FISSO_FTTC", "FISSO_FTTH", "FISSO_FWA_OUT", "FISSO_FWA_IND_2P"
                          ];
                          return righe
                            .filter((r) => categorieTecnologia.includes(r.categoria))
                            .reduce((sum, r) => sum + r.pezzi, 0);
                        })() : undefined}
                        value={getOrCreatePezzi(pdv.id, cat.type) || ""}
                        onChange={(e) => { const val = parseInt(e.target.value) || 0; updatePezzi(pdv.id, cat.type, Math.max(0, val)); }}
                        placeholder="0"
                        className="h-9"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Risultati calcolo */}
              {result && (() => {
                // Calcolo somma pezzi per le categorie specificate
                const categorieConteggio: FissoCategoriaType[] = [
                  "FISSO_FTTC", "FISSO_FTTH", "FISSO_FWA_OUT", "FISSO_FWA_IND_2P"
                ];
                const sommaPezzi = result.righe
                  .filter(r => r.categoria && categorieConteggio.includes(r.categoria))
                  .reduce((sum, r) => sum + (r.pezzi || 0), 0);
                
                // Run rate giornaliero pezzi
                const { totalWorkingDays } = result.result.workdayInfo;
                const runRatePezzi = totalWorkingDays > 0 ? sommaPezzi / totalWorkingDays : 0;

                return (
                  <div className="mt-4 p-4 bg-muted/50 rounded-lg space-y-3">
                    <h4 className="font-semibold text-sm">Riepilogo calcolo FISSO</h4>
                    
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground text-xs">Pezzi target mese</p>
                        <p className="font-semibold">{sommaPezzi}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Run rate giornaliero</p>
                        <p className="font-semibold text-primary">{runRatePezzi.toFixed(2)} pz/gg</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Punti target mese</p>
                        <p className="font-semibold">{result.result.punti.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Run rate punti</p>
                        <p className="font-semibold text-primary">{result.result.runRateGiornalieroPunti.toFixed(2)} pt/gg</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-sm pt-2 border-t border-border">
                      <div>
                        <p className="text-muted-foreground text-xs">Soglia raggiunta</p>
                        <p className="font-semibold">
                          {result.result.soglia > 0 
                            ? `Soglia ${result.result.soglia}` 
                            : "Nessuna"}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">Premio mensile</p>
                        <p className="font-bold text-primary">{formatCurrency(result.result.premio)}</p>
                      </div>
                    </div>

                    <div className="text-xs text-muted-foreground pt-2 border-t border-border">
                      Giorni lavorativi nel mese: {result.result.workdayInfo.totalWorkingDays}
                    </div>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        );
      })}

    </div>
  );
};
