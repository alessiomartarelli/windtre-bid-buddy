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
import { ConfigGaraBase, TipologiaGara, TIPOLOGIA_GARA_OPTIONS } from "@/types/preventivatore";
import { FileText, Calendar, Clock, Target } from "lucide-react";

interface StepLetteraProps {
  configGara: ConfigGaraBase;
  setConfigGara: React.Dispatch<React.SetStateAction<ConfigGaraBase>>;
}

export const StepLetteraGara: React.FC<StepLetteraProps> = ({
  configGara,
  setConfigGara,
}) => {
  return (
    <div className="space-y-6">
      {/* Intro Section */}
      <div className="flex items-start gap-4 p-4 rounded-lg bg-gradient-to-r from-primary/10 to-accent/10 border border-primary/20">
        <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
          <FileText className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h3 className="font-semibold text-foreground">Configura la gara</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Inserisci le informazioni base della gara per iniziare la simulazione. 
            Questi dati verranno utilizzati per tutti i calcoli successivi.
          </p>
        </div>
      </div>

      {/* Form Fields */}
      <div className="grid gap-6">
        {/* Tipologia Gara */}
        <Card className="border-border/50 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg bg-warning/10 flex items-center justify-center">
                <Target className="w-4 h-4 text-warning" />
              </div>
              <Label className="text-base font-semibold">Tipologia di gara</Label>
            </div>
            <Select
              value={configGara.tipologiaGara ?? "gara_operatore"}
              onValueChange={(v: TipologiaGara) =>
                setConfigGara((prev) => ({ ...prev, tipologiaGara: v }))
              }
            >
              <SelectTrigger className="text-base">
                <SelectValue placeholder="Seleziona tipologia" />
              </SelectTrigger>
              <SelectContent>
                {TIPOLOGIA_GARA_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {configGara.tipologiaGara === "gara_addetto" && (
              <p className="text-xs text-muted-foreground mt-2 italic">
                Questa tipologia sarà disponibile in futuro.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Nome Gara */}
        <Card className="border-border/50 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <FileText className="w-4 h-4 text-primary" />
              </div>
              <Label htmlFor="nomeGara" className="text-base font-semibold">Nome della gara</Label>
            </div>
            <Input
              id="nomeGara"
              placeholder="Es. Gara NOVEMBRE 2025"
              value={configGara.nomeGara}
              onChange={(e) =>
                setConfigGara((prev) => ({ ...prev, nomeGara: e.target.value }))
              }
              className="text-lg"
            />
          </CardContent>
        </Card>

        {/* Periodo */}
        <div className="grid md:grid-cols-3 gap-4">
          {/* Anno Gara */}
          <Card className="border-border/50 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-lg bg-secondary/10 flex items-center justify-center">
                  <Calendar className="w-4 h-4 text-secondary" />
                </div>
                <Label htmlFor="annoGara" className="text-base font-semibold">Anno gara</Label>
              </div>
              <Select
                value={String(configGara.annoGara)}
                onValueChange={(v) =>
                  setConfigGara((prev) => ({ ...prev, annoGara: Number(v) }))
                }
              >
                <SelectTrigger className="text-base">
                  <SelectValue placeholder="Seleziona anno" />
                </SelectTrigger>
                <SelectContent>
                  {[2024, 2025, 2026, 2027, 2028].map((year) => (
                    <SelectItem key={year} value={String(year)}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Mese Gara */}
          <Card className="border-border/50 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
                  <Calendar className="w-4 h-4 text-accent" />
                </div>
                <Label htmlFor="meseGara" className="text-base font-semibold">Mese gara</Label>
              </div>
              <Select
                value={String(configGara.meseGara)}
                onValueChange={(v) =>
                  setConfigGara((prev) => ({ ...prev, meseGara: Number(v) }))
                }
              >
                <SelectTrigger className="text-base">
                  <SelectValue placeholder="Seleziona mese" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Gennaio</SelectItem>
                  <SelectItem value="2">Febbraio</SelectItem>
                  <SelectItem value="3">Marzo</SelectItem>
                  <SelectItem value="4">Aprile</SelectItem>
                  <SelectItem value="5">Maggio</SelectItem>
                  <SelectItem value="6">Giugno</SelectItem>
                  <SelectItem value="7">Luglio</SelectItem>
                  <SelectItem value="8">Agosto</SelectItem>
                  <SelectItem value="9">Settembre</SelectItem>
                  <SelectItem value="10">Ottobre</SelectItem>
                  <SelectItem value="11">Novembre</SelectItem>
                  <SelectItem value="12">Dicembre</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card className="border-border/50 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center">
                  <Clock className="w-4 h-4 text-success" />
                </div>
                <Label className="text-base font-semibold">Tipo periodo</Label>
              </div>
              <Select
                value={configGara.tipoPeriodo ?? "mensile"}
                onValueChange={(v: "mensile" | "bimestrale" | "trimestrale") =>
                  setConfigGara((prev) => ({ ...prev, tipoPeriodo: v }))
                }
              >
                <SelectTrigger className="text-base">
                  <SelectValue placeholder="Seleziona" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mensile">Mensile</SelectItem>
                  <SelectItem value="bimestrale">Bimestrale</SelectItem>
                  <SelectItem value="trimestrale">Trimestrale</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};