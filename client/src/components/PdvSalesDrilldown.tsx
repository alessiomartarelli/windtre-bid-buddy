import { Badge } from "@/components/ui/badge";
import {
  BarChart3,
  Briefcase,
  Flame,
  Headphones,
  Percent,
  RefreshCw,
  Shield,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Wifi,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

export interface PdvSaleDetail {
  id: string;
  bisuiteId?: number | null;
  dataVendita?: string | null;
  codicePos?: string | null;
  nomeNegozio?: string | null;
  nomeAddetto?: string | null;
  nomeCliente?: string | null;
  totale?: string | number | null;
  stato?: string | null;
  categorieArticoli?: string | null;
  contributions?: PdvSaleContribution[];
}

export interface PdvSaleContribution {
  key: string;
  label: string;
  value: number;
  unit?: "pezzi" | "euro";
}

const formatMoney = (value: number) =>
  value.toLocaleString("it-IT", { style: "currency", currency: "EUR" });

const METRIC_ORDER = [
  "mobile", "fisso", "energia", "luce", "gas", "assicurazioni", "protecta",
  "iva_mobile", "iva_wireline", "vas", "cb",
  "finanziato-ga", "finanziato-cb", "var-ga", "var-cb",
  "accessori", "accEuro", "servizi", "srvEuro",
] as const;

const metricRank = (key: string) => {
  const normalized = key.split(":").pop() || key;
  const index = METRIC_ORDER.indexOf(normalized as typeof METRIC_ORDER[number]);
  return index === -1 ? METRIC_ORDER.length : index;
};

const PISTA_LABELS: Record<string, string> = {
  mobile: "Mobile",
  fisso: "Fisso",
  energia: "Energia",
  luce: "Luce",
  gas: "Gas",
  assicurazioni: "Assicurazioni",
  protecta: "Windtre Protetti",
  iva_mobile: "IVA Mobile",
  iva_wireline: "IVA Wireline",
  vas: "VAS",
  cb: "CB",
};

const METRIC_STYLE: Record<string, { icon: LucideIcon; iconClass: string; badgeClass: string }> = {
  mobile: { icon: Smartphone, iconClass: "bg-blue-500", badgeClass: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300" },
  fisso: { icon: Wifi, iconClass: "bg-emerald-500", badgeClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  energia: { icon: Zap, iconClass: "bg-amber-500", badgeClass: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  luce: { icon: Zap, iconClass: "bg-yellow-500", badgeClass: "border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300" },
  gas: { icon: Flame, iconClass: "bg-orange-500", badgeClass: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300" },
  assicurazioni: { icon: Shield, iconClass: "bg-violet-500", badgeClass: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  protecta: { icon: ShieldCheck, iconClass: "bg-rose-500", badgeClass: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300" },
  iva_mobile: { icon: Briefcase, iconClass: "bg-sky-500", badgeClass: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  iva_wireline: { icon: Wifi, iconClass: "bg-indigo-500", badgeClass: "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300" },
  vas: { icon: Sparkles, iconClass: "bg-teal-500", badgeClass: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300" },
  cb: { icon: RefreshCw, iconClass: "bg-cyan-500", badgeClass: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300" },
  telefono: { icon: Smartphone, iconClass: "bg-slate-700", badgeClass: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300" },
  accessori: { icon: Headphones, iconClass: "bg-fuchsia-500", badgeClass: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300" },
  servizi: { icon: Wrench, iconClass: "bg-teal-600", badgeClass: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300" },
  default: { icon: Percent, iconClass: "bg-slate-500", badgeClass: "border-border bg-muted/40 text-foreground" },
};

type DisplayMetric = PdvSaleContribution & { canonicalKey: string; iva?: number };

const canonicalMetric = (metric: PdvSaleContribution): DisplayMetric | null => {
  if (metric.key.startsWith("iva-pista:")) return null;
  if (metric.key.startsWith("item:") || metric.key.startsWith("addon:")) {
    const pista = metric.key.split(":")[1];
    return { ...metric, canonicalKey: `pista:${pista}`, key: `pista:${pista}`, label: PISTA_LABELS[pista] || pista };
  }
  if (metric.key.startsWith("vf:")) {
    const pista = metric.key.slice(3);
    return { ...metric, canonicalKey: `pista:${pista}`, key: `pista:${pista}`, label: PISTA_LABELS[pista] || pista };
  }
  if (metric.key.startsWith("pista:")) {
    const pista = metric.key.slice(6);
    return { ...metric, canonicalKey: metric.key, label: PISTA_LABELS[pista] || metric.label };
  }
  if (metric.key === "extra:cb") {
    return { ...metric, canonicalKey: "pista:cb", key: "pista:cb", label: "CB" };
  }
  return { ...metric, canonicalKey: metric.key };
};

export function PdvSalesDrilldown({ sales, emptyMessage = "Nessuna vendita disponibile per questo PDV." }: {
  sales: PdvSaleDetail[];
  emptyMessage?: string;
}) {
  const rawMetrics = Array.from(
    sales.reduce((totals, sale) => {
      for (const contribution of sale.contributions || []) {
        const current = totals.get(contribution.key);
        if (current) current.value += contribution.value;
        else totals.set(contribution.key, { ...contribution });
      }
      return totals;
    }, new Map<string, PdvSaleContribution>()).values(),
  );
  const ivaByPista = new Map(
    rawMetrics
      .filter((metric) => metric.key.startsWith("iva-pista:"))
      .map((metric) => [metric.key.slice("iva-pista:".length), metric.value]),
  );
  const hasVfMetrics = rawMetrics.some((metric) => metric.key.startsWith("vf:"));
  const hasExactCbColumn = rawMetrics.some((metric) => metric.key === "extra:cb");
  const metrics = Array.from(
    rawMetrics.reduce((totals, metric) => {
      if (hasVfMetrics && metric.key === "extra:cb") return totals;
      const normalized = canonicalMetric(metric);
      if (!normalized) return totals;
      if (
        !hasVfMetrics &&
        hasExactCbColumn &&
        normalized.canonicalKey === "pista:cb" &&
        metric.key !== "extra:cb"
      ) {
        return totals;
      }
      const current = totals.get(normalized.canonicalKey);
      if (current) current.value += normalized.value;
      else totals.set(normalized.canonicalKey, normalized);
      return totals;
    }, new Map<string, DisplayMetric>()).values(),
  )
    .map((metric) => metric.key.startsWith("pista:")
      ? { ...metric, iva: ivaByPista.get(metric.key.slice("pista:".length)) || 0 }
      : metric)
    .sort((a, b) => metricRank(a.key) - metricRank(b.key) || a.label.localeCompare(b.label, "it"));

  return (
    <div className="py-1.5 pl-8 pr-3 bg-muted/10" data-testid="pdv-sales-drilldown">
      {metrics.length === 0 ? (
        <p className="text-sm text-muted-foreground py-3">{emptyMessage}</p>
      ) : (
        <div className="max-w-2xl overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm">
          <div className="flex items-center gap-2 border-b bg-muted/35 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <BarChart3 className="h-3.5 w-3.5 text-primary" />
            Dettaglio volumi del PDV
          </div>
          {metrics.map((metric) => (
            (() => {
              const normalizedKey = metric.key.split(":").pop() || metric.key;
              const styleKey = metric.key.startsWith("telefono:")
                ? "telefono"
                : metric.key.includes("accessori") || metric.key.includes("accEuro")
                  ? "accessori"
                  : metric.key.includes("servizi") || metric.key.includes("srvEuro")
                    ? "servizi"
                    : normalizedKey;
              const style = METRIC_STYLE[styleKey] || METRIC_STYLE.default;
              const Icon = style.icon;
              return (
                <div
                  key={metric.key}
                  className="flex min-h-11 items-center justify-between gap-4 border-b border-border/60 px-3 py-2 last:border-0 hover:bg-muted/20"
                  data-testid={`pdv-metric-${metric.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                    <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md text-white ${style.iconClass}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="truncate">{metric.label}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {!!metric.iva && (
                      <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-300">
                        di cui {metric.iva} IVA
                      </span>
                    )}
                    <Badge
                      variant="outline"
                      className={`min-w-10 justify-center px-2.5 py-1 text-sm font-bold tabular-nums ${style.badgeClass}`}
                    >
                      {metric.unit === "euro" ? formatMoney(metric.value) : metric.value}
                    </Badge>
                  </span>
                </div>
              );
            })()
          ))}
        </div>
      )}
    </div>
  );
}