import React from "react";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectValue,
  SelectItem,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PuntoVendita, ClusterCode, ClusterPIvaCode, CLUSTER_OPTIONS, CLUSTER_PIVA_OPTIONS } from "@/types/preventivatore";
import { Layers, Smartphone, Monitor, Gift, Briefcase, CheckCircle2, AlertCircle } from "lucide-react";

interface StepClusterProps {
  puntiVendita: PuntoVendita[];
  updatePdvField: <K extends keyof PuntoVendita>(
    index: number,
    field: K,
    value: PuntoVendita[K]
  ) => void;
}

export const StepCluster: React.FC<StepClusterProps> = ({
  puntiVendita,
  updatePdvField,
}) => {
  // Filtra i cluster in base al tipo di posizione
  const getAvailableClusters = (tipoPosizione: string) => {
    if (tipoPosizione === "centro_commerciale") {
      return CLUSTER_OPTIONS.filter(c => 
        c.value === "CC1" || c.value === "CC2" || c.value === "CC3" || c.value === "local_x"
      );
    } else if (tipoPosizione === "strada") {
      return CLUSTER_OPTIONS.filter(c => 
        c.value === "strada_1" || c.value === "strada_2" || c.value === "strada_3" || c.value === "local_x"
      );
    }
    return CLUSTER_OPTIONS;
  };

  // Verifica completamento cluster per PDV
  const isComplete = (pdv: PuntoVendita) => {
    return pdv.clusterMobile && pdv.clusterFisso && pdv.clusterCB && pdv.clusterPIva;
  };

  const completedCount = puntiVendita.filter(isComplete).length;

  if (!puntiVendita.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <Layers className="w-8 h-8 text-muted-foreground" />
        </div>
        <p className="text-muted-foreground">
          Prima inserisci almeno un punto vendita nello step precedente.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header con progress */}
      <div className="flex items-start gap-4 p-4 rounded-lg bg-gradient-to-r from-primary/10 to-accent/10 border border-primary/20">
        <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
          <Layers className="w-6 h-6 text-primary" />
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-foreground">Assegna i cluster</h3>
            <Badge 
              variant={completedCount === puntiVendita.length ? "default" : "secondary"}
              className={completedCount === puntiVendita.length ? "bg-success" : ""}
            >
              {completedCount}/{puntiVendita.length} completi
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Per ogni punto vendita, seleziona il cluster per <strong>Mobile</strong>, <strong>Fisso</strong>, <strong>CB</strong> e <strong>P.IVA</strong>.
          </p>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2 text-sm">
          <div className="w-6 h-6 rounded bg-blue-500 text-white flex items-center justify-center">
            <Smartphone className="w-3.5 h-3.5" />
          </div>
          <span className="text-muted-foreground">Mobile</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <div className="w-6 h-6 rounded bg-indigo-500 text-white flex items-center justify-center">
            <Monitor className="w-3.5 h-3.5" />
          </div>
          <span className="text-muted-foreground">Fisso</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <div className="w-6 h-6 rounded bg-purple-500 text-white flex items-center justify-center">
            <Gift className="w-3.5 h-3.5" />
          </div>
          <span className="text-muted-foreground">CB</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <div className="w-6 h-6 rounded bg-orange-500 text-white flex items-center justify-center">
            <Briefcase className="w-3.5 h-3.5" />
          </div>
          <span className="text-muted-foreground">P.IVA</span>
        </div>
      </div>

      {/* Table Card */}
      <Card className="border-border/50 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="font-semibold w-10 px-2"></TableHead>
              <TableHead className="font-semibold px-2">PDV</TableHead>
              <TableHead className="font-semibold px-2">
                <div className="flex items-center gap-1">
                  <Smartphone className="w-3.5 h-3.5 text-blue-500" />
                  <span className="hidden sm:inline">Mobile</span>
                </div>
              </TableHead>
              <TableHead className="font-semibold px-2">
                <div className="flex items-center gap-1">
                  <Monitor className="w-3.5 h-3.5 text-indigo-500" />
                  <span className="hidden sm:inline">Fisso</span>
                </div>
              </TableHead>
              <TableHead className="font-semibold px-2">
                <div className="flex items-center gap-1">
                  <Gift className="w-3.5 h-3.5 text-purple-500" />
                  <span className="hidden sm:inline">CB</span>
                </div>
              </TableHead>
              <TableHead className="font-semibold px-2">
                <div className="flex items-center gap-1">
                  <Briefcase className="w-3.5 h-3.5 text-orange-500" />
                  <span className="hidden sm:inline">P.IVA</span>
                </div>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {puntiVendita.map((pdv, index) => {
              const complete = isComplete(pdv);
              return (
                <TableRow 
                  key={pdv.id}
                  className={`transition-colors ${complete ? 'bg-success/5' : 'hover:bg-muted/50'}`}
                >
                  <TableCell className="px-2">
                    {complete ? (
                      <CheckCircle2 className="w-4 h-4 text-success" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-warning" />
                    )}
                  </TableCell>
                  <TableCell className="px-2">
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{pdv.nome || "—"}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {pdv.codicePos || "—"} · {pdv.tipoPosizione === "centro_commerciale" ? "CC" : pdv.tipoPosizione === "strada" ? "Strada" : "Altro"}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="px-2">
                    <Select
                      value={pdv.clusterMobile || ""}
                      onValueChange={(value: ClusterCode) =>
                        updatePdvField(index, "clusterMobile", value)
                      }
                    >
                      <SelectTrigger className="h-9 min-w-[90px]" data-testid={`select-cluster-mobile-${index}`}>
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        {getAvailableClusters(pdv.tipoPosizione).map((c) => (
                          <SelectItem key={c.value} value={c.value}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="px-2">
                    <Select
                      value={pdv.clusterFisso || ""}
                      onValueChange={(value: ClusterCode) =>
                        updatePdvField(index, "clusterFisso", value)
                      }
                    >
                      <SelectTrigger className="h-9 min-w-[90px]" data-testid={`select-cluster-fisso-${index}`}>
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        {getAvailableClusters(pdv.tipoPosizione).map((c) => (
                          <SelectItem key={c.value} value={c.value}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="px-2">
                    <Select
                      value={pdv.clusterCB || ""}
                      onValueChange={(value: ClusterCode) =>
                        updatePdvField(index, "clusterCB", value)
                      }
                    >
                      <SelectTrigger className="h-9 min-w-[90px]" data-testid={`select-cluster-cb-${index}`}>
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        {getAvailableClusters(pdv.tipoPosizione).map((c) => (
                          <SelectItem key={c.value} value={c.value}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="px-2">
                    <Select
                      value={pdv.clusterPIva || ""}
                      onValueChange={(value: ClusterPIvaCode) =>
                        updatePdvField(index, "clusterPIva", value)
                      }
                    >
                      <SelectTrigger className="h-9 min-w-[90px]" data-testid={`select-cluster-piva-${index}`}>
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        {CLUSTER_PIVA_OPTIONS.map((c) => (
                          <SelectItem key={c.value} value={c.value}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
};