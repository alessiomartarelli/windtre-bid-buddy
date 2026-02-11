import React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { PuntoVendita, PistaFissoRSConfig, SoglieFissoRS } from "@/types/preventivatore";
import { formatCurrency } from "@/utils/format";
import { Monitor, ChevronDown, ChevronUp, Building2, Store } from "lucide-react";
import {
  AttivatoFissoRiga,
  FissoCategoriaType,
  FISSO_CATEGORIE_DEFAULT,
} from "@/lib/calcoloPistaFisso";
import { StepContentHeader } from "./StepContentHeader";

interface StepAttivatoFissoRSProps {
  puntiVendita: PuntoVendita[];
  pistaFissoRSConfig: PistaFissoRSConfig;
  anno: number;
  monthIndex: number;
  attivatoFissoByRS: Record<string, AttivatoFissoRiga[]>;
  setAttivatoFissoByRS: React.Dispatch<React.SetStateAction<Record<string, AttivatoFissoRiga[]>>>;
  totalePremioFissoPrevisto: number;
}

export const StepAttivatoFissoRS: React.FC<StepAttivatoFissoRSProps> = ({
  puntiVendita,
  pistaFissoRSConfig,
  attivatoFissoByRS,
  setAttivatoFissoByRS,
  totalePremioFissoPrevisto,
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

  const getOrCreatePezzi = (rs: string, categoria: FissoCategoriaType): number => {
    const righe = attivatoFissoByRS[rs] ?? [];
    const riga = righe.find((r) => r.categoria === categoria);
    return riga?.pezzi ?? 0;
  };

  const updatePezzi = (rs: string, categoria: FissoCategoriaType, pezzi: number) => {
    setAttivatoFissoByRS((prev) => {
      const righe = prev[rs] ?? [];

      // Validazione per PIU_SICURI_CASA_UFFICIO
      if (categoria === "PIU_SICURI_CASA_UFFICIO") {
        const totalePezziAttuali = righe
          .filter((r) => r.categoria !== "PIU_SICURI_CASA_UFFICIO")
          .reduce((sum, r) => sum + r.pezzi, 0);
        const piva2aLinea = righe.find((r) => r.categoria === "FISSO_PIVA_2A_LINEA")?.pezzi ?? 0;
        const maxPiuSicuri = Math.max(0, totalePezziAttuali - piva2aLinea);
        if (pezzi > maxPiuSicuri) {
          pezzi = maxPiuSicuri;
        }
      }

      const existingIndex = righe.findIndex((r) => r.categoria === categoria);

      if (existingIndex >= 0) {
        const updated = [...righe];
        updated[existingIndex] = { ...updated[existingIndex], pezzi };
        return { ...prev, [rs]: updated };
      } else {
        const newRiga: AttivatoFissoRiga = {
          categoria,
          pezzi,
        };
        return { ...prev, [rs]: [...righe, newRiga] };
      }
    });
  };

  // Calcola totali - solo 4 tecnologie core
  const categorieTecnologia: FissoCategoriaType[] = ["FISSO_FTTC", "FISSO_FTTH", "FISSO_FWA_OUT", "FISSO_FWA_IND_2P"];
  const totalePezzi = ragioneSocialeList.reduce((sum, rs) => {
    const righe = attivatoFissoByRS[rs] ?? [];
    return sum + righe
      .filter((riga) => categorieTecnologia.includes(riga.categoria))
      .reduce((pSum, riga) => pSum + riga.pezzi, 0);
  }, 0);

  // Calcola i punti totali per una RS
  const calcolaPuntiTotaliRS = (rs: string): number => {
    const righe = attivatoFissoByRS[rs] ?? [];
    return righe.reduce((sum, riga) => {
      const conf = FISSO_CATEGORIE_DEFAULT.find(c => c.type === riga.categoria);
      return sum + (riga.pezzi * (conf?.puntiPerPezzo || 0));
    }, 0);
  };

  // Ottieni la configurazione soglie per una RS - usa trim e lowercase per evitare mismatch
  const getSoglieForRS = (rs: string): SoglieFissoRS | undefined => {
    const normalizedRS = rs.trim().toLowerCase();
    return pistaFissoRSConfig.sogliePerRS.find(s => 
      s.ragioneSociale.trim().toLowerCase() === normalizedRS
    );
  };

  // Determina la soglia raggiunta per una RS (Fisso ha 5 soglie)
  const determinaSogliaRaggiuntaRS = (rs: string): number => {
    const punti = calcolaPuntiTotaliRS(rs);
    const soglie = getSoglieForRS(rs);
    
    // Se non ci sono soglie configurate, non possiamo determinare nulla
    if (!soglie) {
      console.warn(`[Fisso RS] Soglie non trovate per RS: "${rs}". Config disponibili:`, 
        pistaFissoRSConfig.sogliePerRS.map(s => s.ragioneSociale));
      return 0;
    }
    
    // Confronta punti con soglie (dal più alto al più basso)
    if (soglie.soglia5 && soglie.soglia5 > 0 && punti >= soglie.soglia5) return 5;
    if (soglie.soglia4 && soglie.soglia4 > 0 && punti >= soglie.soglia4) return 4;
    if (soglie.soglia3 > 0 && punti >= soglie.soglia3) return 3;
    if (soglie.soglia2 > 0 && punti >= soglie.soglia2) return 2;
    if (soglie.soglia1 > 0 && punti >= soglie.soglia1) return 1;
    return 0;
  };

  if (!puntiVendita.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <Monitor className="w-8 h-8 text-muted-foreground" />
        </div>
        <p className="text-muted-foreground">Prima inserisci i punti vendita.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <StepContentHeader
        icon={Monitor}
        title="Volumi Fisso per Ragione Sociale"
        subtitle="Inserisci i volumi target mensili aggregati per azienda"
        totalPremio={totalePremioFissoPrevisto}
        extraInfo={`${totalePezzi} pezzi totali · ${ragioneSocialeList.length} aziende`}
      />

      <div className="space-y-4">
        {ragioneSocialeList.map((rs) => {
          const pdvList = ragioneSocialeGroups[rs];
          const isOpen = openCards[rs] ?? true;
          const righe = attivatoFissoByRS[rs] ?? [];
          const totalPezziRS = righe.reduce((sum, r) => sum + r.pezzi, 0);
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
                              · {puntiTotaliRS.toFixed(1)} punti
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
                        </div>
                        {isOpen ? <ChevronUp className="w-5 h-5 text-muted-foreground" /> : <ChevronDown className="w-5 h-5 text-muted-foreground" />}
                      </div>
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <CardContent className="pt-0 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {FISSO_CATEGORIE_DEFAULT.map((cat) => (
                        <div key={cat.type} className="space-y-1.5">
                          <Label className="text-xs">{cat.label}</Label>
                          <Input
                            type="number"
                            min={0}
                            value={getOrCreatePezzi(rs, cat.type) || ""}
                            onChange={(e) => {
                              const val = parseInt(e.target.value) || 0;
                              updatePezzi(rs, cat.type, Math.max(0, val));
                            }}
                            placeholder="0"
                            className="h-9"
                          />
                        </div>
                      ))}
                    </div>

                    {/* Riepilogo */}
                    <div className="mt-4 p-4 bg-muted/50 rounded-lg">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">Totale pezzi RS</span>
                        <span className="font-semibold">{totalPezziRS}</span>
                      </div>
                    </div>
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
