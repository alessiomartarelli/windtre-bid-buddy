// Sezione IVA della shell React (Task #144).
// - Selettore periodo (mensile / trimestrale) → persiste su `co.ivaPeriod`.
// - Tabella liquidazione: per ogni periodo, IVA collettata (su entrate),
//   IVA detraibile (su uscite), saldo (debito >0 / credito <0).
// - Card autofatturazione estera (reverse charge): elenco transazioni
//   estere U + totali versare/recuperare/saldo netto.

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { FinplanSnapshot, IvaPeriod } from "@shared/finplanSchema";
import type { FinplanUpdater } from "@/hooks/useFinplan";
import { formatCurrency } from "@/utils/format";
import { MO } from "@/lib/finplanImport";
import { calcAutofattura, calcIvaPeriods, totalsIvaPeriods } from "@/lib/finplanIva";

interface IvaSectionProps {
  snapshot: FinplanSnapshot | null;
  companyIndex: number;
  scheduleSave: (s: FinplanSnapshot | FinplanUpdater) => void;
}

export function IvaSection({ snapshot, companyIndex, scheduleSave }: IvaSectionProps) {
  const co = snapshot?.data?.[companyIndex];
  const period: IvaPeriod = (co?.ivaPeriod as IvaPeriod) ?? "trimestrale";

  const rows = useMemo(() => calcIvaPeriods(co?.transactions, period), [co, period]);
  const totale = useMemo(() => totalsIvaPeriods(rows), [rows]);
  const autofattura = useMemo(() => calcAutofattura(co?.transactions), [co]);

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
