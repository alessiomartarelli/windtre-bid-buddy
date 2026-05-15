import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import type { FinplanCompanySnapshot, FinplanSnapshot } from "@shared/finplanSchema";
import type { FinplanUpdater } from "@/hooks/useFinplan";

const fmtEuro = (n: number) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

interface CostiIncassiProps {
  snapshot: FinplanSnapshot | null;
  companyIndex: number;
  /**
   * Accetta un updater per evitare clobber su edit rapidi: ogni toggle
   * deve calcolare il prossimo snapshot a partire dall'ULTIMA versione
   * pendente (non dalla prop snapshot, che resta stale finché TanStack-
   * Query non rifa il fetch dopo il PUT).
   */
  scheduleSave: (s: FinplanSnapshot | FinplanUpdater) => void;
}

interface CatRow {
  id: string;
  name: string;
  color: string;
  total: number;
  excluded: boolean;
}

function buildRows(co: FinplanCompanySnapshot | undefined, type: "E" | "U"): CatRow[] {
  if (!co) return [];
  const cats = (co.cats ?? []).filter(c => c.type === type);
  const totals = new Map<string, number>();
  for (const t of co.transactions ?? []) {
    if (t.type !== type) continue;
    const id = String(t.catId ?? "");
    totals.set(id, (totals.get(id) ?? 0) + (typeof t.amount === "number" ? t.amount : 0));
  }
  const excl = new Set((co.cfExclude?.[type] ?? []) as string[]);
  return cats
    .map(c => ({
      id: c.id,
      name: c.name ?? c.id,
      color: c.color ?? "#64748B",
      total: totals.get(c.id) ?? 0,
      excluded: excl.has(c.id),
    }))
    .sort((a, b) => b.total - a.total);
}

export function CostiIncassi({ snapshot, companyIndex, scheduleSave }: CostiIncassiProps) {
  const co = snapshot?.data?.[companyIndex];
  const rowsE = useMemo(() => buildRows(co, "E"), [co]);
  const rowsU = useMemo(() => buildRows(co, "U"), [co]);

  const toggle = (type: "E" | "U", catId: string, excluded: boolean) => {
    // Updater: parte SEMPRE dall'ultimo snapshot pendente noto al hook,
    // così toggle rapidi (anche su altre RS) non si sovrascrivono.
    scheduleSave((prev) => {
      const base: FinplanSnapshot = prev && prev.data ? prev : (snapshot ?? { data: [] });
      const data = base.data ?? [];
      return {
        ...base,
        data: data.map((c, i) => {
          if (i !== companyIndex) return c;
          const cf = c.cfExclude ?? { E: [], U: [], ctpVar: {} };
          const cur = new Set((cf[type] ?? []) as string[]);
          if (excluded) cur.add(catId);
          else cur.delete(catId);
          return {
            ...c,
            cfExclude: {
              ...cf,
              E: type === "E" ? Array.from(cur) : (cf.E ?? []),
              U: type === "U" ? Array.from(cur) : (cf.U ?? []),
              ctpVar: cf.ctpVar ?? {},
            },
          };
        }),
      };
    });
  };

  return (
    <div className="space-y-4" data-testid="finplan-costi-incassi">
      <p className="text-sm text-muted-foreground">
        Spunta le categorie da escludere dal calcolo del cashflow (voci variabili o non rilevanti).
        Le modifiche vengono salvate automaticamente.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <CategoryList
          title="Incassi (Entrate)"
          emoji="💰"
          rows={rowsE}
          onToggle={(id, excl) => toggle("E", id, excl)}
          testIdPrefix="cf-e"
        />
        <CategoryList
          title="Costi (Uscite)"
          emoji="💸"
          rows={rowsU}
          onToggle={(id, excl) => toggle("U", id, excl)}
          testIdPrefix="cf-u"
        />
      </div>
    </div>
  );
}

function CategoryList({
  title, emoji, rows, onToggle, testIdPrefix,
}: {
  title: string;
  emoji: string;
  rows: CatRow[];
  onToggle: (catId: string, excluded: boolean) => void;
  testIdPrefix: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <span>{emoji}</span>
          <span>{title}</span>
          <Badge variant="outline" className="ml-auto text-[10px]">
            {rows.filter(r => r.excluded).length} escluse
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4">Nessuna categoria con dati.</div>
        ) : (
          <ul className="space-y-2">
            {rows.map(r => {
              const tid = `${testIdPrefix}-${r.id}`;
              return (
                <li
                  key={r.id}
                  className="flex items-center gap-3 rounded-md border p-2 hover-elevate"
                  data-testid={`row-${tid}`}
                >
                  <Checkbox
                    id={tid}
                    checked={r.excluded}
                    onCheckedChange={(v) => onToggle(r.id, v === true)}
                    data-testid={`checkbox-${tid}`}
                  />
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
                    style={{ background: r.color }}
                  />
                  <label htmlFor={tid} className="text-sm flex-1 cursor-pointer truncate">
                    {r.name}
                  </label>
                  <span className="font-mono text-xs text-muted-foreground" data-testid={`amount-${tid}`}>
                    {fmtEuro(r.total)}
                  </span>
                  <Badge
                    variant={r.excluded ? "secondary" : "outline"}
                    className="text-[9px] uppercase tracking-wider"
                  >
                    {r.excluded ? "Variabile" : "Fisso"}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
