import React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectValue,
  SelectItem,
} from "@/components/ui/select";
import { PuntoVendita, CanalePdv, PuntoVenditaType } from "@/types/preventivatore";

interface StepPdvProps {
  numeroPdv: number;
  onNumeroPdvChange: (value: string) => void;
  puntiVendita: PuntoVendita[];
  updatePdvField: <K extends keyof PuntoVendita>(
    index: number,
    field: K,
    value: PuntoVendita[K]
  ) => void;
}

export const StepPuntiVendita: React.FC<StepPdvProps> = ({
  numeroPdv,
  onNumeroPdvChange,
  puntiVendita,
  updatePdvField,
}) => {
  return (
    <div className="space-y-6">
      <div className="space-y-2 max-w-xs">
        <Label htmlFor="numeroPdv">
          Quanti punti vendita partecipano alla gara?
        </Label>
        <Input
          id="numeroPdv"
          type="number"
          min={0}
          value={numeroPdv || ""}
          onChange={(e) => onNumeroPdvChange(e.target.value)}
        />
      </div>

      {numeroPdv > 0 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Inserisci per ogni negozio il <strong>codice POS</strong>, il{" "}
            <strong>nome</strong>, la <strong>ragione sociale</strong>, il{" "}
            <strong>canale</strong> e la <strong>tipologia</strong>.
          </p>

          <div className="grid gap-4">
            {puntiVendita.map((pdv, index) => (
              <Card key={pdv.id} className="border-border">
                <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <Label>Codice POS</Label>
                    <Input
                      placeholder="Es. 9001xxxxx"
                      value={pdv.codicePos}
                      onChange={(e) =>
                        updatePdvField(index, "codicePos", e.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Nome punto vendita</Label>
                    <Input
                      placeholder="Es. 3Store Milano Duomo"
                      value={pdv.nome}
                      onChange={(e) =>
                        updatePdvField(index, "nome", e.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Ragione sociale</Label>
                    <Input
                      placeholder="Es. Telestore S.r.l."
                      value={pdv.ragioneSociale}
                      onChange={(e) =>
                        updatePdvField(index, "ragioneSociale", e.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Canale</Label>
                    <Select
                      value={pdv.canale}
                      onValueChange={(value: CanalePdv) =>
                        updatePdvField(index, "canale", value)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Seleziona canale" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="franchising">Franchising</SelectItem>
                        <SelectItem value="retail">Retail</SelectItem>
                        <SelectItem value="dealer">Dealer</SelectItem>
                        <SelectItem value="top_dealer">Top dealer</SelectItem>
                        <SelectItem value="corner">Corner</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Tipologia posizione</Label>
                    <Select
                      value={pdv.tipoPosizione}
                      onValueChange={(value: PuntoVenditaType) =>
                        updatePdvField(index, "tipoPosizione", value)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Seleziona tipologia" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="centro_commerciale">
                          Centro commerciale
                        </SelectItem>
                        <SelectItem value="strada">
                          Negozio su strada
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
