// Sezione IVA della shell React (Task #144).
// - Selettore periodo (mensile / trimestrale) → persiste su `co.ivaPeriod`.
// - Tabella liquidazione: per ogni periodo, IVA collettata (su entrate),
//   IVA detraibile (su uscite), saldo (debito >0 / credito <0).
// - Card autofatturazione estera (reverse charge): form di inserimento
//   rapido + elenco transazioni estere U + totali versare/recuperare/
//   saldo netto.

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { FinplanSnapshot, FinplanTransaction, IvaPeriod } from "@shared/finplanSchema";
import type { FinplanUpdater } from "@/hooks/useFinplan";
import { formatCurrency } from "@/utils/format";
import { MO } from "@/lib/finplanImport";
import { calcAutofattura, calcIvaPeriods, totalsIvaPeriods, rebuildMonthly } from "@/lib/finplanIva";

interface IvaSectionProps {
  snapshot: FinplanSnapshot | null;
  companyIndex: number;
  scheduleSave: (s: FinplanSnapshot | FinplanUpdater) => void;
}

export function IvaSection({ snapshot, companyIndex, scheduleSave }: IvaSectionProps) {
  const { toast } = useToast();
  const co = snapshot?.data?.[companyIndex];
  const period: IvaPeriod = (co?.ivaPeriod as IvaPeriod) ?? "trimestrale";

  const rows = useMemo(() => calcIvaPeriods(co?.transactions, period), [co, period]);
  const totale = useMemo(() => totalsIvaPeriods(rows), [rows]);
  const autofattura = useMemo(() => calcAutofattura(co?.transactions), [co]);

  // Form quick-add per autofattura estera (Task #144 review): crea una
  // transazione "est_u" con IVA 22% e la appende a co.transactions.
  // Il risultato confluisce automaticamente nel calcolo `calcAutofattura`
  // (che filtra le tx con catId === "est_u").
  const [afMonth, setAfMonth] = useState<number>(new Date().getMonth());
  const [afAmount, setAfAmount] = useState<string>("");
  const [afDesc, setAfDesc] = useState<string>("");

  const setPeriod = (next: IvaPeriod) => {
    scheduleSave(prev => {
      const base: FinplanSnapshot = prev && prev.data ? prev : (snapshot ?? { data: [] });
      const data = base.data ?? [];
      return {
        ...base,
        data: data.map((c, i) => i === companyIndex ? { ...c, ivaPeriod: next } : c),
      };
    });
  };

  const addAutofattura = () => {
    const amount = parseFloat(afAmount.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: "Importo non valido", variant: "destructive" });
      return;
    }
    scheduleSave(prev => {
      const base: FinplanSnapshot = prev && prev.data ? prev : (snapshot ?? { data: [] });
      const data = (base.data ?? []).slice();
      const target = data[companyIndex];
      if (!target) return base;
      const existing = target.transactions ?? [];
      const seq = typeof target.txIdSeq === "number" ? target.txIdSeq : 1;
      let maxId = seq - 1;
      for (const t of existing) {
        if (typeof t.id === "number" && t.id > maxId) maxId = t.id;
      }
      const newTx: FinplanTransaction = {
        id: maxId + 1,
        month: afMonth,
        type: "U",
        amount: +amount.toFixed(2),
        catId: "est_u",
        ivaRate: 22,
        desc: afDesc.trim() || "Autofattura estera",
      };
      const nextTxs = existing.concat(newTx);
      const updated = { ...target, transactions: nextTxs, txIdSeq: maxId + 2 };
      data[companyIndex] = rebuildMonthly(updated);
      return { ...base, data };
    });
    toast({ title: "Autofattura aggiunta", description: `${MO[afMonth]} · ${formatCurrency(amount)}` });
    setAfAmount("");
    setAfDesc("");
  };

  return (
    <div className="space-y-4" data-testid="finplan-iva">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-sm">Liquidazione IVA</CardTitle>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Periodo</Label>
            <Select value={period} onValueChange={(v) => setPeriod(v as IvaPeriod)}>
              <SelectTrigger className="h-8 w-40" data-testid="select-iva-period"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="mensile">Mensile</SelectItem>
                <SelectItem value="trimestrale">Trimestrale</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Periodo</TableHead>
                <TableHead className="text-right">IVA su vendite (debito)</TableHead>
                <TableHead className="text-right">IVA su acquisti (credito)</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i} data-testid={`row-iva-${i}`}>
                  <TableCell className="text-xs font-medium">{r.label}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{formatCurrency(r.ivaCollettata)}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">{formatCurrency(r.ivaDetraibile)}</TableCell>
                  <TableCell className={`text-right font-mono text-xs font-medium ${r.saldo > 0 ? "text-rose-600" : r.saldo < 0 ? "text-emerald-600" : ""}`}>
                    {formatCurrency(r.saldo)}
                    <Badge variant="outline" className="ml-2 text-[9px]">
                      {r.saldo > 0 ? "Debito" : r.saldo < 0 ? "Credito" : "—"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/40">
                <TableCell className="font-bold text-xs">{totale.label}</TableCell>
                <TableCell className="text-right font-mono text-xs font-bold" data-testid="text-iva-tot-collettata">{formatCurrency(totale.ivaCollettata)}</TableCell>
                <TableCell className="text-right font-mono text-xs font-bold" data-testid="text-iva-tot-detraibile">{formatCurrency(totale.ivaDetraibile)}</TableCell>
                <TableCell className={`text-right font-mono text-xs font-bold ${totale.saldo > 0 ? "text-rose-600" : totale.saldo < 0 ? "text-emerald-600" : ""}`} data-testid="text-iva-tot-saldo">
                  {formatCurrency(totale.saldo)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Autofatturazione estera (reverse charge 22%)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Form quick-add: crea direttamente una tx "est_u" con IVA 22%. */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-2 rounded-md border p-3 bg-muted/30" data-testid="form-autofattura">
            <div className="md:col-span-2 space-y-1">
              <Label className="text-xs">Mese</Label>
              <Select value={String(afMonth)} onValueChange={(v) => setAfMonth(parseInt(v, 10))}>
                <SelectTrigger className="h-8" data-testid="select-autof-month"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MO.map((name, i) => (
                    <SelectItem key={i} value={String(i)}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-3 space-y-1">
              <Label className="text-xs">Imponibile (EUR)</Label>
              <Input
                value={afAmount}
                onChange={(e) => setAfAmount(e.target.value)}
                placeholder="es. 1500,00"
                className="h-8 font-mono"
                data-testid="input-autof-amount"
              />
            </div>
            <div className="md:col-span-5 space-y-1">
              <Label className="text-xs">Descrizione</Label>
              <Input
                value={afDesc}
                onChange={(e) => setAfDesc(e.target.value)}
                placeholder="es. Servizi cloud UE / fornitore extra-UE"
                className="h-8"
                data-testid="input-autof-desc"
              />
            </div>
            <div className="md:col-span-2 flex items-end">
              <Button onClick={addAutofattura} size="sm" className="w-full" data-testid="button-autof-add">
                <Plus className="h-3.5 w-3.5 mr-1" /> Aggiungi
              </Button>
            </div>
            <div className="md:col-span-12 text-[11px] text-muted-foreground" data-testid="text-autof-preview">
              {(() => {
                const a = parseFloat(afAmount.replace(",", "."));
                if (!Number.isFinite(a) || a <= 0) return "Inserisci un imponibile per vedere il calcolo automatico (IVA 22%, saldo netto 0).";
                const iva = +(a * 0.22).toFixed(2);
                return `IVA a debito: ${formatCurrency(iva)} · IVA a credito: ${formatCurrency(iva)} · Saldo netto: ${formatCurrency(0)}`;
              })()}
            </div>
          </div>

          {autofattura.righe.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-autofattura">
              Nessuna transazione "Estero" in uscita. Le transazioni con categoria estero
              compaiono qui per il calcolo del reverse charge.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                <Stat label="Imponibile" value={formatCurrency(autofattura.imponibileTotale)} testId="autof-imponibile" />
                <Stat label="IVA da versare" value={formatCurrency(autofattura.ivaVersare)} testId="autof-versare" highlight="rose" />
                <Stat label="IVA recuperabile" value={formatCurrency(autofattura.ivaRecuperabile)} testId="autof-recuperare" highlight="emerald" />
                <Stat label="Saldo netto" value={formatCurrency(autofattura.saldoNetto)} testId="autof-saldo" />
              </div>
              <div className="overflow-x-auto rounded border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[60px]">Mese</TableHead>
                      <TableHead>Descrizione</TableHead>
                      <TableHead className="text-right">Imponibile</TableHead>
                      <TableHead className="text-right">IVA 22%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {autofattura.righe.map((r, i) => (
                      <TableRow key={String(r.id ?? i)} data-testid={`row-autof-${i}`}>
                        <TableCell className="text-xs">{MO[r.month]}</TableCell>
                        <TableCell className="text-xs max-w-[320px] truncate" title={r.desc}>{r.desc || "—"}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{formatCurrency(r.imponibile)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{formatCurrency(r.iva)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">
                Il reverse charge sulle operazioni estere genera contemporaneamente IVA a debito (versare) e IVA a credito (detrarre):
                il saldo netto è 0 se l'IVA è 100% detraibile.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, testId, highlight }: {
  label: string; value: string; testId: string; highlight?: "rose" | "emerald";
}) {
  const color = highlight === "rose" ? "text-rose-600" : highlight === "emerald" ? "text-emerald-600" : "";
  return (
    <div className="rounded-md border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`font-bold text-sm font-mono ${color}`} data-testid={testId}>{value}</div>
    </div>
  );
}
