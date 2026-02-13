import React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectValue,
  SelectItem,
} from "@/components/ui/select";
import { PuntoVendita, CanalePdv, PuntoVenditaType } from "@/types/preventivatore";
import { Trash2 } from "lucide-react";

interface StepPdvProps {
  numeroPdv: number;
  onNumeroPdvChange: (value: string) => void;
  puntiVendita: PuntoVendita[];
  updatePdvField: <K extends keyof PuntoVendita>(
    index: number,
    field: K,
    value: PuntoVendita[K]
  ) => void;
  ragioniSociali: string[];
  onRagioniSocialiChange: (rs: string[]) => void;
}

export const StepPuntiVendita: React.FC<StepPdvProps> = ({
  numeroPdv,
  onNumeroPdvChange,
  puntiVendita,
  updatePdvField,
  ragioniSociali,
  onRagioniSocialiChange,
}) => {
  const [numeroRS, setNumeroRS] = React.useState<number>(ragioniSociali.length);

  const handleNumeroRSChange = (value: string) => {
    const n = parseInt(value) || 0;
    const clamped = Math.max(0, Math.min(n, 50));
    setNumeroRS(clamped);
    if (clamped > ragioniSociali.length) {
      const newRS = [...ragioniSociali];
      for (let i = ragioniSociali.length; i < clamped; i++) {
        newRS.push("");
      }
      onRagioniSocialiChange(newRS);
    } else if (clamped < ragioniSociali.length) {
      onRagioniSocialiChange(ragioniSociali.slice(0, clamped));
    }
  };

  const updateRSName = (index: number, name: string) => {
    const updated = [...ragioniSociali];
    updated[index] = name;
    onRagioniSocialiChange(updated);
  };

  React.useEffect(() => {
    if (ragioniSociali.length !== numeroRS) {
      setNumeroRS(ragioniSociali.length);
    }
  }, [ragioniSociali.length]);

  const validRS = ragioniSociali.filter(rs => rs.trim() !== "");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md">
        <div className="space-y-2">
          <Label htmlFor="numeroPdv" data-testid="label-numero-pdv">
            Quanti PDV partecipano?
          </Label>
          <Input
            id="numeroPdv"
            type="number"
            min={0}
            value={numeroPdv || ""}
            onChange={(e) => onNumeroPdvChange(e.target.value)}
            data-testid="input-numero-pdv"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="numeroRS" data-testid="label-numero-rs">
            Quante ragioni sociali?
          </Label>
          <Input
            id="numeroRS"
            type="number"
            min={0}
            value={numeroRS || ""}
            onChange={(e) => handleNumeroRSChange(e.target.value)}
            data-testid="input-numero-rs"
          />
        </div>
      </div>

      {numeroRS > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Inserisci il nome di ciascuna <strong>ragione sociale</strong>. Verranno usate come opzioni nei PDV.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {ragioniSociali.map((rs, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground min-w-[24px]">{index + 1}.</span>
                <Input
                  placeholder={`Ragione sociale ${index + 1}`}
                  value={rs}
                  onChange={(e) => updateRSName(index, e.target.value)}
                  data-testid={`input-rs-name-${index}`}
                />
              </div>
            ))}
          </div>
        </div>
      )}

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
                      data-testid={`input-codice-pos-${index}`}
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
                      data-testid={`input-nome-pdv-${index}`}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Ragione sociale</Label>
                    {validRS.length > 0 ? (
                      <Select
                        value={pdv.ragioneSociale}
                        onValueChange={(value: string) =>
                          updatePdvField(index, "ragioneSociale", value)
                        }
                      >
                        <SelectTrigger data-testid={`select-ragione-sociale-${index}`}>
                          <SelectValue placeholder="Seleziona RS" />
                        </SelectTrigger>
                        <SelectContent>
                          {validRS.map((rs) => (
                            <SelectItem key={rs} value={rs}>
                              {rs}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        placeholder="Es. Telestore S.r.l."
                        value={pdv.ragioneSociale}
                        onChange={(e) =>
                          updatePdvField(index, "ragioneSociale", e.target.value)
                        }
                        data-testid={`input-ragione-sociale-${index}`}
                      />
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Canale</Label>
                    <Select
                      value={pdv.canale}
                      onValueChange={(value: CanalePdv) =>
                        updatePdvField(index, "canale", value)
                      }
                    >
                      <SelectTrigger data-testid={`select-canale-${index}`}>
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
                      <SelectTrigger data-testid={`select-tipo-posizione-${index}`}>
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
