// Sezione Obiettivi (Task #145).
// CRUD obiettivi finanziari + scheda dedicata "Recupero perdite" che riusa
// `computeRecupero` (lib/finplan/perdite.ts) per progettare il rientro
// dalla perdita pregressa via cashflow netto IVA o quote manuali.
//
// Sorgente: client/public/finplan/index.html righe 2848-2934 (obj CRUD)
// e 2971-3146 (perdite).

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Plus, Trash2 } from "lucide-react";
import type { FinplanCompanySnapshot, FinplanObjective, FinplanPerdite, FinplanSnapshot } from "@shared/finplanSchema";
import type { FinplanUpdater } from "@/hooks/useFinplan";
import { formatCurrency } from "@/utils/format";
import { MO } from "@/lib/finplanImport";
import { computeRecupero } from "@/lib/finplan/perdite";

const OBJ_TIPI = [
  { id: "fatturato", name: "Target fatturato" },
  { id: "margine",   name: "Margine atteso" },
  { id: "investimento", name: "Investimento" },
  { id: "risparmio", name: "Risparmio" },
  { id: "altro",     name: "Altro" },
];

const OBJ_COLORS = ["#00D4AA", "#3B82F6", "#8B5CF6", "#F59E0B", "#EF4444", "#10B981", "#EC4899"];

interface Props {
  snapshot: FinplanSnapshot | null;
  companyIndex: number;
  scheduleSave: (s: FinplanSnapshot | FinplanUpdater) => void;
}

function updateCompany(
  prev: FinplanSnapshot | null,
  snapshot: FinplanSnapshot | null,
  ci: number,
  patch: (co: FinplanCompanySnapshot) => FinplanCompanySnapshot,
): FinplanSnapshot {
  const base: FinplanSnapshot = prev && prev.data ? prev : (snapshot ?? { data: [] });
  const data = (base.data ?? []).slice();
  const co = data[ci] ?? {};
  data[ci] = patch(co);
  return { ...base, data };
}

export function Obiettivi({ snapshot, companyIndex, scheduleSave }: Props) {
  const co = snapshot?.data?.[companyIndex];
  const objs = (co?.obj ?? []) as FinplanObjective[];
  const perdite = co?.perdite as FinplanPerdite | undefined;
  const recupero = useMemo(() => computeRecupero(co, perdite), [co, perdite]);

  const [draftName, setDraftName] = useState("");
  const [draftTipo, setDraftTipo] = useState(OBJ_TIPI[0].id);
  const [draftTarget, setDraftTarget] = useState("");

  const addObj = () => {
    const target = parseFloat(draftTarget.replace(",", "."));
    if (!draftName.trim() || !Number.isFinite(target) || target <= 0) return;
    scheduleSave(prev => updateCompany(prev, snapshot, companyIndex, co => {
      const list = ((co.obj ?? []) as FinplanObjective[]).slice();
      const maxId = list.reduce((m, o) => {
        const id = typeof o.id === "number" ? o.id : 0;
        return id > m ? id : m;
      }, 0);
      const colorIdx = list.length % OBJ_COLORS.length;
      list.push({
        id: maxId + 1,
        name: draftName.trim(),
        tipo: draftTipo,
        target,
        current: 0,
        color: OBJ_COLORS[colorIdx],
      });
      return { ...co, obj: list };
    }));
    setDraftName("");
    setDraftTarget("");
  };

  const updateObj = (id: FinplanObjective["id"], field: keyof FinplanObjective, value: string | number) => {
    scheduleSave(prev => updateCompany(prev, snapshot, companyIndex, co => {
      const list = ((co.obj ?? []) as FinplanObjective[]).map(o =>
        o.id === id ? { ...o, [field]: value } : o,
      );
      return { ...co, obj: list };
    }));
  };

  const removeObj = (id: FinplanObjective["id"]) => {
    scheduleSave(prev => updateCompany(prev, snapshot, companyIndex, co => {
      const list = ((co.obj ?? []) as FinplanObjective[]).filter(o => o.id !== id);
      return { ...co, obj: list };
    }));
  };

  const updatePerdite = (patch: Partial<FinplanPerdite>) => {
    scheduleSave(prev => updateCompany(prev, snapshot, companyIndex, co => ({
      ...co,
      perdite: { ...(co.perdite as FinplanPerdite | undefined ?? {}), ...patch },
    })));
  };

  const updateManuale = (i: number, value: string) => {
    const n = parseFloat(value.replace(",", "."));
    scheduleSave(prev => updateCompany(prev, snapshot, companyIndex, co => {
      const cur = ((co.perdite as FinplanPerdite | undefined)?.manuale ?? []).slice();
      while (cur.length < 12) cur.push(0);
      cur[i] = Number.isFinite(n) ? n : 0;
      return {
        ...co,
        perdite: { ...(co.perdite as FinplanPerdite | undefined ?? {}), manuale: cur },
      };
    }));
  };

  return (
    <div className="space-y-4" data-testid="finplan-obiettivi">
      {/* Quick add */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Nuovo obiettivo</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
            <div className="md:col-span-4 space-y-1">
              <Label className="text-xs">Nome</Label>
              <Input value={draftName} onChange={e => setDraftName(e.target.value)} className="h-8" placeholder="es. Aprire 2 PDV" data-testid="input-obj-name" />
            </div>
            <div className="md:col-span-3 space-y-1">
              <Label className="text-xs">Tipo</Label>
              <Select value={draftTipo} onValueChange={setDraftTipo}>
                <SelectTrigger className="h-8" data-testid="select-obj-tipo"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OBJ_TIPI.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-3 space-y-1">
              <Label className="text-xs">Target (EUR)</Label>
              <Input value={draftTarget} onChange={e => setDraftTarget(e.target.value)} className="h-8 font-mono" placeholder="0,00" inputMode="decimal" data-testid="input-obj-target" />
            </div>
            <div className="md:col-span-2 flex items-end">
              <Button onClick={addObj} size="sm" className="w-full" data-testid="button-obj-add">
                <Plus className="h-3.5 w-3.5 mr-1" /> Aggiungi
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista obiettivi */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Obiettivi attivi ({objs.length})</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {objs.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-obj">Nessun obiettivo. Aggiungine uno sopra per tracciarne l'avanzamento.</p>
          ) : (
            objs.map(o => {
              const target = o.target ?? 0;
              const current = o.current ?? 0;
              const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
              const tipoName = OBJ_TIPI.find(t => t.id === o.tipo)?.name ?? o.tipo ?? "—";
              return (
                <div key={String(o.id)} className="rounded-md border p-3 space-y-2" data-testid={`row-obj-${o.id}`} style={{ borderLeftColor: o.color, borderLeftWidth: 4 }}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex-1 min-w-[200px]">
                      <Input
                        value={o.name ?? ""}
                        onChange={e => updateObj(o.id, "name", e.target.value)}
                        className="h-8 font-medium"
                        data-testid={`input-obj-name-${o.id}`}
                      />
                    </div>
                    <Badge variant="outline" className="text-xs">{tipoName}</Badge>
                    <Button variant="ghost" size="icon" onClick={() => removeObj(o.id)} className="h-7 w-7" data-testid={`button-obj-del-${o.id}`}>
                      <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Target</Label>
                      <Input
                        defaultValue={target}
                        onBlur={e => updateObj(o.id, "target", parseFloat(e.target.value.replace(",", ".")) || 0)}
                        className="h-8 font-mono text-xs"
                        inputMode="decimal"
                        data-testid={`input-obj-target-${o.id}`}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Avanzamento</Label>
                      <Input
                        defaultValue={current}
                        onBlur={e => updateObj(o.id, "current", parseFloat(e.target.value.replace(",", ".")) || 0)}
                        className="h-8 font-mono text-xs"
                        inputMode="decimal"
                        data-testid={`input-obj-current-${o.id}`}
                      />
                    </div>
                    <div className="space-y-1 md:col-span-1 col-span-2">
                      <Label className="text-[10px] text-muted-foreground">Progresso</Label>
                      <div className="flex items-center gap-2">
                        <Progress value={pct} className="h-2 flex-1" />
                        <span className="text-xs font-mono w-12 text-right">{pct.toFixed(0)}%</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground font-mono">
                        {formatCurrency(current)} / {formatCurrency(target)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* Recupero perdite */}
      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">Recupero perdite pregresse</CardTitle>
          <div className="flex items-center gap-2">
            <Label className="text-xs">Attivo</Label>
            <Switch
              checked={!!perdite?.attivo}
              onCheckedChange={(v) => updatePerdite({ attivo: v })}
              data-testid="switch-perdite-attivo"
            />
          </div>
        </CardHeader>
        {perdite?.attivo && (
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Importo perdita</Label>
                <Input
                  defaultValue={perdite?.importo ?? 0}
                  onBlur={e => updatePerdite({ importo: parseFloat(e.target.value.replace(",", ".")) || 0 })}
                  className="h-8 font-mono"
                  inputMode="decimal"
                  data-testid="input-perdite-importo"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Costi fissi (info)</Label>
                <Input
                  defaultValue={perdite?.costiFissi ?? 0}
                  onBlur={e => updatePerdite({ costiFissi: parseFloat(e.target.value.replace(",", ".")) || 0 })}
                  className="h-8 font-mono"
                  inputMode="decimal"
                  data-testid="input-perdite-costifissi"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Mese di partenza</Label>
                <Select value={String(perdite?.mesePart ?? 0)} onValueChange={v => updatePerdite({ mesePart: parseInt(v, 10) })}>
                  <SelectTrigger className="h-8" data-testid="select-perdite-mese"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MO.map((m, i) => <SelectItem key={i} value={String(i)}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Quote da cashflow netto</Label>
                <div className="flex items-center h-8">
                  <Switch
                    checked={perdite?.usaCashFlow !== false}
                    onCheckedChange={v => updatePerdite({ usaCashFlow: v })}
                    data-testid="switch-perdite-cashflow"
                  />
                </div>
              </div>
            </div>

            {/* Sintesi */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2">
              <Stat label="Importo" value={formatCurrency(recupero.importo)} testId="stat-perdite-importo" />
              <Stat label="Recuperato" value={formatCurrency(recupero.recuperato)} testId="stat-perdite-recuperato" highlight="emerald" />
              <Stat label="Residuo" value={formatCurrency(recupero.residuo)} testId="stat-perdite-residuo" highlight="rose" />
              <Stat label="% recupero" value={`${recupero.pct.toFixed(1)}%`} testId="stat-perdite-pct" />
            </div>
            <Progress value={recupero.pct} className="h-2" />

            {/* Tabella mesi */}
            <div className="overflow-x-auto rounded border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[60px]">Mese</TableHead>
                    <TableHead className="text-right">CF netto</TableHead>
                    <TableHead className="text-right">{perdite?.usaCashFlow !== false ? "Quota auto" : "Quota manuale"}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recupero.mesi.map(r => (
                    <TableRow key={r.i} data-testid={`row-perdite-${r.i}`}>
                      <TableCell className="text-xs font-medium">{MO[r.i]}</TableCell>
                      <TableCell className={`text-right font-mono text-xs ${r.cfNetto >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        {formatCurrency(r.cfNetto)}
                      </TableCell>
                      <TableCell className="text-right">
                        {perdite?.usaCashFlow !== false ? (
                          <span className="font-mono text-xs">{formatCurrency(r.quota)}</span>
                        ) : (
                          <Input
                            defaultValue={(perdite?.manuale ?? [])[r.i] ?? 0}
                            onBlur={e => updateManuale(r.i, e.target.value)}
                            className="h-7 font-mono text-xs ml-auto w-32"
                            inputMode="decimal"
                            data-testid={`input-perdite-manuale-${r.i}`}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, testId, highlight }: { label: string; value: string; testId: string; highlight?: "rose" | "emerald" }) {
  const color = highlight === "rose" ? "text-rose-600" : highlight === "emerald" ? "text-emerald-600" : "";
  return (
    <div className="rounded-md border p-2">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`font-bold text-sm font-mono ${color}`} data-testid={testId}>{value}</div>
    </div>
  );
}
