// Sezione Mensile della shell React (Task #144).
// Mostra `co.m[]` (12 mesi) editabili E/U, confrontati con i totali
// derivati dalle transazioni. Warning se i due differiscono di > 0.01€
// (utile a evidenziare totali editati a mano disallineati dopo CRUD su
// Transazioni). Bottone "Riallinea da transazioni" sostituisce i valori
// editati con la somma calcolata.

import { useMemo, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, RotateCw } from "lucide-react";
import type { FinplanCompanySnapshot, FinplanSnapshot } from "@shared/finplanSchema";
import type { FinplanUpdater } from "@/hooks/useFinplan";
import { formatCurrency } from "@/utils/format";
import { MO } from "@/lib/finplanImport";
import { aggregateMonthlyFromTx, rebuildMonthly } from "@/lib/finplanIva";

interface MensileProps {
  snapshot: FinplanSnapshot | null;
  companyIndex: number;
  scheduleSave: (s: FinplanSnapshot | FinplanUpdater) => void;
}

interface RowDraft { e: string; u: string }

function toDraft(n: number | undefined): string {
  return Number.isFinite(n) && n !== 0 ? String(n) : "";
}

function parseAmount(s: string): number {
  const n = parseFloat(s.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function Mensile({ snapshot, companyIndex, scheduleSave }: MensileProps) {
  const co = snapshot?.data?.[companyIndex];

  const expected = useMemo(() => aggregateMonthlyFromTx(co?.transactions), [co]);

  // Draft locali: vengono ri-allineati al snapshot quando cambia (es.
  // dopo append da import). Evita di clobberare digitazione attiva.
  const initial = useMemo<RowDraft[]>(() => Array.from({ length: 12 }, (_, i) => ({
    e: toDraft(co?.m?.[i]?.e),
    u: toDraft(co?.m?.[i]?.u),
  })), [co]);
  const [drafts, setDrafts] = useState<RowDraft[]>(initial);
  useEffect(() => { setDrafts(initial); }, [initial]);

  const updateDraft = (i: number, field: "e" | "u", value: string) => {
    setDrafts(prev => prev.map((r, j) => j === i ? { ...r, [field]: value } : r));
  };

  const commit = () => {
    scheduleSave(prev => {
      const base: FinplanSnapshot = prev && prev.data ? prev : (snapshot ?? { data: [] });
      const data = base.data ?? [];
      return {
        ...base,
        data: data.map((c, i) => {
          if (i !== companyIndex) return c;
          const m = MO.map((mo, idx) => ({
            month: mo,
            e: parseAmount(drafts[idx]?.e ?? ""),
            u: parseAmount(drafts[idx]?.u ?? ""),
          }));
          return { ...c, m };
        }),
      };
    });
  };

  const realign = () => {
    scheduleSave(prev => {
      const base: FinplanSnapshot = prev && prev.data ? prev : (snapshot ?? { data: [] });
      const data = base.data ?? [];
      return {
        ...base,
        data: data.map((c, i) => {
          if (i !== companyIndex) return c;
          const newCo: FinplanCompanySnapshot = { ...c };
          newCo.m = rebuildMonthly(c);
          return newCo;
        }),
      };
    });
  };

  const discrepancies = useMemo(() => {
    const out: { month: number; deltaE: number; deltaU: number }[] = [];
    for (let i = 0; i < 12; i++) {
      const e = parseAmount(drafts[i]?.e ?? "");
      const u = parseAmount(drafts[i]?.u ?? "");
      const dE = e - expected.e[i];
      const dU = u - expected.u[i];
      if (Math.abs(dE) > 0.01 || Math.abs(dU) > 0.01) {
        out.push({ month: i, deltaE: dE, deltaU: dU });
      }
    }
    return out;
  }, [drafts, expected]);

  const totals = useMemo(() => {
    let e = 0, u = 0;
    for (const r of drafts) {
      e += parseAmount(r.e);
      u += parseAmount(r.u);
    }
    return { e, u };
  }, [drafts]);

  return (
    <div className="space-y-4" data-testid="finplan-mensile">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <p className="text-sm text-muted-foreground">
          Totali mensili Entrate/Uscite. Modifica i valori per sovrascrivere quanto calcolato dalle transazioni.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={commit} size="sm" data-testid="button-mensile-save">Salva modifiche</Button>
          <Button onClick={realign} size="sm" variant="outline" data-testid="button-mensile-realign">
            <RotateCw className="h-3.5 w-3.5 mr-1" />
            Riallinea da transazioni
          </Button>
        </div>
      </div>

      {discrepancies.length > 0 && (
        <Alert className="border-amber-500/40 bg-amber-500/10" data-testid="alert-mensile-discrepancy">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-xs">
            {discrepancies.length} mes{discrepancies.length === 1 ? "e" : "i"} con totali editati diversi dalla somma delle transazioni.
            Usa "Riallinea" per sovrascriverli o ignora se sono inserimenti aggregati intenzionali.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[80px]">Mese</TableHead>
                <TableHead>Entrate (manuale)</TableHead>
                <TableHead className="text-right">Da transazioni</TableHead>
                <TableHead>Uscite (manuale)</TableHead>
                <TableHead className="text-right">Da transazioni</TableHead>
                <TableHead className="text-right">Cashflow</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {MO.map((mo, i) => {
                const e = parseAmount(drafts[i]?.e ?? "");
                const u = parseAmount(drafts[i]?.u ?? "");
                const dE = e - expected.e[i];
                const dU = u - expected.u[i];
                const cf = e - u;
                return (
                  <TableRow key={i} data-testid={`row-mensile-${i}`}>
                    <TableCell className="font-medium text-xs">{mo}</TableCell>
                    <TableCell>
                      <Input
                        value={drafts[i]?.e ?? ""}
                        onChange={(ev) => updateDraft(i, "e", ev.target.value)}
                        className="h-8 text-xs"
                        placeholder="0"
                        inputMode="decimal"
                        data-testid={`input-mensile-e-${i}`}
                      />
                    </TableCell>
                    <TableCell className="text-right text-xs font-mono">
                      <span className={Math.abs(dE) > 0.01 ? "text-amber-600" : "text-muted-foreground"}>
                        {formatCurrency(expected.e[i])}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Input
                        value={drafts[i]?.u ?? ""}
                        onChange={(ev) => updateDraft(i, "u", ev.target.value)}
                        className="h-8 text-xs"
                        placeholder="0"
                        inputMode="decimal"
                        data-testid={`input-mensile-u-${i}`}
                      />
                    </TableCell>
                    <TableCell className="text-right text-xs font-mono">
                      <span className={Math.abs(dU) > 0.01 ? "text-amber-600" : "text-muted-foreground"}>
                        {formatCurrency(expected.u[i])}
                      </span>
                    </TableCell>
                    <TableCell className={`text-right text-xs font-mono font-medium ${cf >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      {formatCurrency(cf)}
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="bg-muted/40">
                <TableCell className="font-bold text-xs">TOT</TableCell>
                <TableCell className="font-mono text-xs font-bold" data-testid="text-mensile-tot-e">{formatCurrency(totals.e)}</TableCell>
                <TableCell className="text-right font-mono text-xs text-muted-foreground">{formatCurrency(expected.e.reduce((s, n) => s + n, 0))}</TableCell>
                <TableCell className="font-mono text-xs font-bold" data-testid="text-mensile-tot-u">{formatCurrency(totals.u)}</TableCell>
                <TableCell className="text-right font-mono text-xs text-muted-foreground">{formatCurrency(expected.u.reduce((s, n) => s + n, 0))}</TableCell>
                <TableCell className={`text-right font-mono text-xs font-bold ${totals.e - totals.u >= 0 ? "text-emerald-600" : "text-rose-600"}`} data-testid="text-mensile-tot-cf">
                  {formatCurrency(totals.e - totals.u)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="outline">Tot E manuale: {formatCurrency(totals.e)}</Badge>
        <Badge variant="outline">Tot E da tx: {formatCurrency(expected.e.reduce((s, n) => s + n, 0))}</Badge>
        <Badge variant="outline">Tot U manuale: {formatCurrency(totals.u)}</Badge>
        <Badge variant="outline">Tot U da tx: {formatCurrency(expected.u.reduce((s, n) => s + n, 0))}</Badge>
      </div>
    </div>
  );
}
