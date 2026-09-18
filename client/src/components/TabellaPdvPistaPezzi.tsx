import { Fragment, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { ArrowDown, ArrowUp, ArrowUpDown, Briefcase, ChevronDown, ChevronRight, Download, Flame, Percent, RefreshCw, Shield, ShieldCheck, Smartphone, Sparkles, Table as TableIcon, Wifi, Zap, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import { normalizeRsName } from "@shared/ragioneSociale";
import type { PezziExtraColKey, PistaCanvass } from "@/lib/bisuiteClassification";
import { emptyPezziExtra, sommaPezziExtra, type PezziExtraCounters } from "@shared/pdvPezziExtra";
import { PdvSalesDrilldown, type PdvSaleDetail } from "@/components/PdvSalesDrilldown";
import { buildPdvPezziColumns, type PdvPezziColumn } from "@shared/pdvPezziColumns";

// Tabella PDV × Pista (solo Pezzi) per la pagina Vendite BiSuite.
// Stessa struttura della tabella della Dashboard Gara Reale (RS espandibili
// nei loro PDV e colonne per pista con totale complessivo per colonna) ma alimentata
// dai conteggi pezzi già classificati nella pagina Vendite: quindi stesse
// esclusioni annullate e stessi filtri data/PDV/pista attivi.
// Energia: countByPista.energia include già i pezzi CF (consumer) e P.IVA
// (business), quindi la colonna Energia è già la somma delle due categorie.
// Task #470 — include anche la pista "protecta" (Windtre Protetti / Verisure
// per le org VF: la label arriva già tradotta via pistaLabels).
// Task #534 — l'elenco piste NON è più fisso WindTre: arriva via props dalla
// tassonomia condivisa (venditePisteForModel in shared/bisuiteClassification),
// quindi le org Vodafone/Fastweb vedono Mobile/Fisso/CB/Luce/Gas/IVA Mobile/
// IVA Wireline/VAS e le colonne extra IVA/CB spariscono (già piste).

// Stesse icone/colori della Tabella PDV × Pista della Dashboard Gara Reale
// (config piste in DashboardGaraReale.tsx): quadratino colorato + icona bianca.
const PISTA_HEADER_ICONS: Partial<Record<PistaCanvass, { icon: LucideIcon; color: string }>> = {
  mobile: { icon: Smartphone, color: "bg-blue-500" },
  fisso: { icon: Wifi, color: "bg-green-500" },
  energia: { icon: Zap, color: "bg-amber-500" },
  assicurazioni: { icon: Shield, color: "bg-purple-500" },
  protecta: { icon: ShieldCheck, color: "bg-rose-500" },
  // Piste Vodafone/Fastweb (Task #534)
  cb: { icon: RefreshCw, color: "bg-cyan-500" },
  luce: { icon: Zap, color: "bg-yellow-500" },
  gas: { icon: Flame, color: "bg-orange-500" },
  iva_mobile: { icon: Briefcase, color: "bg-sky-500" },
  iva_wireline: { icon: Percent, color: "bg-violet-500" },
  vas: { icon: Sparkles, color: "bg-teal-500" },
};

// Task #398 — colonne extra (stesse della vista Pezzi della Dashboard Gara):
// IVA pezzi, CB solo cambi piano, Telefoni, € Accessori/Servizi netto IVA.
// Task #470 — IVA e CB hanno icona/colore come le piste (stesso linguaggio
// visivo: quadratino colorato + icona bianca), coerenti con la Dashboard Gara.
const EXTRA_HEADER_ICONS: Partial<Record<PezziExtraColKey, { icon: LucideIcon; color: string }>> = {
  iva: { icon: Percent, color: "bg-slate-500" },
  cb: { icon: RefreshCw, color: "bg-cyan-500" },
};

const fmtVal = (v: number, euro: boolean) =>
  euro ? `${v.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €` : String(v);

export interface PdvPezziRow {
  codicePos: string;
  nomeNegozio: string;
  ragioneSociale: string;
  countByPista: Partial<Record<PistaCanvass, number>>;
  /** Contatori extra Task #398 (IVA, CB, Telefoni, € Accessori/Servizi). */
  pezziExtra?: PezziExtraCounters;
  vendite?: PdvSaleDetail[];
}

interface Props {
  rows: PdvPezziRow[];
  pistaLabels: Record<PistaCanvass, string>;
  /** Piste (in ordine) del modello brand attivo — tassonomia condivisa. */
  piste: readonly PistaCanvass[];
  /** Colonne extra da mostrare per il modello attivo. */
  extraColKeys: readonly PezziExtraColKey[];
}

type Cell = number;
type PdvSort = { pista: PistaCanvass; direction: "asc" | "desc" } | null;

type PdvEntry = {
  codicePos: string;
  nomeNegozio: string;
  perPista: Map<PistaCanvass, Cell>;
  extra: PezziExtraCounters;
  vendite: PdvSaleDetail[];
};

type RsEntry = {
  rsKey: string;
  displayName: string;
  perPista: Map<PistaCanvass, Cell>;
  extra: PezziExtraCounters;
  pdvList: PdvEntry[];
};

const comparePdvNameAndCode = (a: PdvEntry, b: PdvEntry) => {
  const byName = a.nomeNegozio.localeCompare(b.nomeNegozio, "it", { sensitivity: "base", numeric: true });
  return byName || a.codicePos.localeCompare(b.codicePos, "it", { sensitivity: "base", numeric: true });
};

const sortedPdvList = (pdvList: PdvEntry[], sort: PdvSort) => {
  if (!sort) return pdvList;
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...pdvList].sort((a, b) => {
    const byPista = (a.perPista.get(sort.pista) || 0) - (b.perPista.get(sort.pista) || 0);
    return byPista === 0 ? comparePdvNameAndCode(a, b) : byPista * direction;
  });
};

export function TabellaPdvPistaPezzi({ rows, pistaLabels, piste, extraColKeys }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedPdv, setExpandedPdv] = useState<Set<string>>(new Set());
  const [pdvSort, setPdvSort] = useState<PdvSort>(null);
  const { rsRows, totals, totalsExtra, hasExtra } = useMemo(() => {
    type RsAggregate = Omit<RsEntry, "rsKey" | "pdvList"> & { pdvs: Map<string, PdvEntry> };
    const rsMap = new Map<string, RsAggregate>();
    let hasExtra = false;

    for (const pdv of rows) {
      const rsName = pdv.ragioneSociale || "Senza RS";
      const rsKey = normalizeRsName(rsName);
      if (!rsMap.has(rsKey)) {
        rsMap.set(rsKey, { displayName: rsName, perPista: new Map(), extra: emptyPezziExtra(), pdvs: new Map() });
      }
      const entry = rsMap.get(rsKey)!;
      if (!entry.pdvs.has(pdv.codicePos)) {
        entry.pdvs.set(pdv.codicePos, { codicePos: pdv.codicePos, nomeNegozio: pdv.nomeNegozio, perPista: new Map(), extra: emptyPezziExtra(), vendite: [] });
      }
      const pdvEntry = entry.pdvs.get(pdv.codicePos)!;
      if (pdv.vendite?.length) pdvEntry.vendite.push(...pdv.vendite);
      for (const pista of piste) {
        const n = pdv.countByPista[pista] || 0;
        if (n === 0) continue;
        pdvEntry.perPista.set(pista, (pdvEntry.perPista.get(pista) || 0) + n);
        entry.perPista.set(pista, (entry.perPista.get(pista) || 0) + n);
      }
      if (pdv.pezziExtra) {
        hasExtra = true;
        sommaPezziExtra(pdvEntry.extra, pdv.pezziExtra);
        sommaPezziExtra(entry.extra, pdv.pezziExtra);
      }
    }

    const rsRows = Array.from(rsMap.entries())
      .map(([rsKey, data]) => ({
        rsKey,
        displayName: data.displayName,
        perPista: data.perPista,
        extra: data.extra,
        pdvList: Array.from(data.pdvs.values()).sort(comparePdvNameAndCode),
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    const totals = new Map<PistaCanvass, number>();
    const totalsExtra = emptyPezziExtra();
    for (const rs of rsRows) {
      for (const pista of piste) {
        const n = rs.perPista.get(pista) || 0;
        totals.set(pista, (totals.get(pista) || 0) + n);
      }
      sommaPezziExtra(totalsExtra, rs.extra);
    }
    return { rsRows, totals, totalsExtra, hasExtra };
  }, [rows, piste]);
  const columns = useMemo(
    () => buildPdvPezziColumns(piste, pistaLabels, extraColKeys, hasExtra),
    [piste, pistaLabels, extraColKeys, hasExtra],
  );
  const pistaColumns = columns.filter((column): column is Extract<PdvPezziColumn, { kind: "pista" }> => column.kind === "pista");
  const extraCols = columns.filter((column): column is Extract<PdvPezziColumn, { kind: "extra" }> => column.kind === "extra");

  const toggleRs = (rsKey: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(rsKey)) next.delete(rsKey); else next.add(rsKey);
      return next;
    });
  };
  const togglePdvSort = (pista: PistaCanvass) => {
    setPdvSort(current => (
      current?.pista === pista
        ? { pista, direction: current.direction === "asc" ? "desc" : "asc" }
        : { pista, direction: "asc" }
    ));
  };
  const togglePdv = (key: string) => {
    setExpandedPdv(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const allKeys = rsRows.map(r => r.rsKey);
  const allExpanded = allKeys.length > 0 && allKeys.every(k => expanded.has(k));
  const noneExpanded = expanded.size === 0;

  // Export: colonne extra dopo le piste. Gli importi € sono numerici
  // arrotondati a 2 decimali (niente immagini/icone in cella).
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const columnValue = (column: PdvPezziColumn, perPista: Map<PistaCanvass, number>, extra: PezziExtraCounters): number => {
    const value = column.kind === "pista" ? (perPista.get(column.key) || 0) : extra[column.key];
    return column.euro ? round2(value) : value;
  };

  const buildExportRows = () => {
    const header: (string | number)[] = ["Tipo", "Ragione Sociale", "Codice PDV", "Nome PDV"];
    for (const column of columns) header.push(column.exportLabel);
    const out: (string | number)[][] = [header];
    for (const rs of rsRows) {
      const rsRow: (string | number)[] = ["RS", rs.displayName, "", ""];
      for (const column of columns) rsRow.push(columnValue(column, rs.perPista, rs.extra));
      out.push(rsRow);
      for (const pdv of rs.pdvList) {
        const pdvRow: (string | number)[] = ["PDV", rs.displayName, pdv.codicePos, pdv.nomeNegozio];
        for (const column of columns) pdvRow.push(columnValue(column, pdv.perPista, pdv.extra));
        out.push(pdvRow);
      }
    }
    const totRow: (string | number)[] = ["TOTALE", "Totale complessivo", "", ""];
    for (const column of columns) totRow.push(columnValue(column, totals, totalsExtra));
    out.push(totRow);
    return out;
  };

  const baseFilename = () => `tabella-pdv-pista-volumi_vendite_${new Date().toISOString().slice(0, 10)}`;

  const exportExcel = () => {
    const ws = XLSX.utils.aoa_to_sheet(buildExportRows());
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "PDV x Pista (Volumi)");
    XLSX.writeFile(wb, `${baseFilename()}.xlsx`);
  };

  const exportCsv = () => {
    const ws = XLSX.utils.aoa_to_sheet(buildExportRows());
    const csv = XLSX.utils.sheet_to_csv(ws, { FS: ";" });
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${baseFilename()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportPdf = () => {
    const allRows = buildExportRows();
    if (allRows.length <= 1) return;
    const header = allRows[0] as string[];
    const body = allRows.slice(1).map(r => r.map(v => String(v)));
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFontSize(13);
    doc.text("Tabella PDV × Pista (Volumi) — Vendite", 8, 12);
    autoTable(doc, {
      startY: 18,
      head: [header],
      body,
      theme: "striped",
      headStyles: { fillColor: [59, 130, 246], fontSize: 8, halign: "center" },
      bodyStyles: { fontSize: 8 },
      styles: { cellPadding: 1.2, overflow: "linebreak" },
      columnStyles: { 0: { cellWidth: 14 }, 1: { cellWidth: 45 }, 2: { cellWidth: 22 }, 3: { cellWidth: 40 } },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index >= 4) data.cell.styles.halign = "right";
        if (data.section === "body" && body[data.row.index]?.[0] === "RS") {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [240, 244, 250];
        }
        if (data.section === "body" && body[data.row.index]?.[0] === "TOTALE") {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [219, 234, 254];
        }
      },
      margin: { left: 8, right: 8 },
    });
    doc.save(`${baseFilename()}.pdf`);
  };

  if (rsRows.length === 0) return null;

  return (
    <Card data-testid="card-tabella-pdv-pista-pezzi">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <TableIcon className="h-5 w-5 text-primary" />
            Tabella PDV × Pista (Volumi)
          </CardTitle>
          <div className="flex gap-2 flex-wrap items-center">
            <Button size="sm" variant="outline" className="h-8" onClick={() => setExpanded(new Set(allKeys))} disabled={allExpanded} data-testid="btn-pezzi-expand-all">Espandi tutto</Button>
            <Button size="sm" variant="outline" className="h-8" onClick={() => setExpanded(new Set())} disabled={noneExpanded} data-testid="btn-pezzi-collapse-all">Collassa tutto</Button>
            <Button size="sm" variant="outline" className="h-8" onClick={exportExcel} data-testid="btn-pezzi-export-excel">
              <Download className="h-3.5 w-3.5 mr-1" />Excel
            </Button>
            <Button size="sm" variant="outline" className="h-8" onClick={exportCsv} data-testid="btn-pezzi-export-csv">
              <Download className="h-3.5 w-3.5 mr-1" />CSV
            </Button>
            <Button size="sm" variant="outline" className="h-8" onClick={exportPdf} data-testid="btn-pezzi-export-pdf">
              <Download className="h-3.5 w-3.5 mr-1" />PDF
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollableTable>
          <div className="max-h-[500px] overflow-y-auto min-w-max">
          <table className="w-full text-sm min-w-max" data-testid="table-pdv-pista-pezzi">
            <thead>
              <tr className="border-b">
                <th className="text-left px-3 py-2 font-medium sticky left-0 top-0 bg-muted z-20 min-w-[180px]">RS / PDV</th>
                {pistaColumns.map(column => {
                  const p = column.key;
                  const conf = PISTA_HEADER_ICONS[p];
                  const Icon = conf?.icon;
                  const isActive = pdvSort?.pista === p;
                  const direction = isActive ? pdvSort.direction : null;
                  const SortIcon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ArrowUpDown;
                  const sortLabel = direction === "asc" ? "crescente" : direction === "desc" ? "decrescente" : "non applicato";
                  const nextDirectionLabel = direction === "asc" ? "decrescente" : "crescente";
                  return (
                    <th
                      key={p}
                      className="text-right px-3 py-2 font-medium whitespace-nowrap sticky top-0 bg-muted z-10"
                      data-testid={`th-pezzi-${p}`}
                      aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}
                    >
                      <button
                        type="button"
                        className="flex w-full items-center justify-end gap-1.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        onClick={() => togglePdvSort(p)}
                        aria-label={`Ordina i PDV per ${pistaLabels[p]} in ordine ${nextDirectionLabel}. Ordinamento attuale: ${sortLabel}.`}
                        title={`Ordina PDV per ${pistaLabels[p]} (${sortLabel})`}
                        data-testid={`btn-pezzi-sort-${p}`}
                      >
                        {Icon ? <div className={`p-1 rounded ${conf!.color} text-white`}><Icon className="h-3 w-3" /></div> : null}
                        <span>{column.label}</span>
                        <SortIcon className={`h-3.5 w-3.5 ${isActive ? "text-foreground" : "text-muted-foreground"}`} aria-hidden="true" />
                        <span className="sr-only">{`Ordinamento ${sortLabel}`}</span>
                      </button>
                    </th>
                  );
                })}
                {extraCols.map(c => {
                  const conf = EXTRA_HEADER_ICONS[c.key];
                  const ExtraIcon = conf?.icon;
                  return (
                    <th key={c.key} className="text-right px-3 py-2 font-medium whitespace-nowrap sticky top-0 bg-muted z-10" data-testid={`th-pezzi-${c.key}`}>
                      <div className="flex items-center justify-end gap-1.5">
                        {ExtraIcon ? <div className={`p-1 rounded ${conf!.color} text-white`}><ExtraIcon className="h-3 w-3" /></div> : null}
                        <span>{c.label}{c.euro ? <span className="text-[10px] font-normal opacity-60" title="Importo al netto IVA (÷1,22), come nella Dashboard Gara"> (netto IVA)</span> : null}</span>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rsRows.map(rs => (
                <RsGroup
                  key={rs.rsKey}
                  rs={rs}
                  expanded={expanded.has(rs.rsKey)}
                  onToggle={() => toggleRs(rs.rsKey)}
                  hasExtra={hasExtra}
                  pdvSort={pdvSort}
                   columns={columns}
                  expandedPdv={expandedPdv}
                  onTogglePdv={togglePdv}
                />
              ))}
              <tr className="border-t-2 font-bold bg-primary/5" data-testid="row-pezzi-totale">
                <td className="px-3 py-2 sticky left-0 bg-card z-10">Totale complessivo</td>
                 {columns.map(column => (
                   <td key={column.key} className="text-right px-3 py-2 tabular-nums" data-testid={`cell-pezzi-tot-${column.key}`}>
                     {fmtVal(columnValue(column, totals, totalsExtra), column.euro)}
                   </td>
                ))}
              </tr>
            </tbody>
          </table>
          </div>
        </ScrollableTable>
      </CardContent>
    </Card>
  );
}

function RsGroup({
  rs,
  expanded,
  onToggle,
  hasExtra,
  pdvSort,
  columns,
  expandedPdv,
  onTogglePdv,
}: {
  rs: RsEntry;
  expanded: boolean;
  onToggle: () => void;
  hasExtra: boolean;
  pdvSort: PdvSort;
  columns: readonly PdvPezziColumn[];
  expandedPdv: Set<string>;
  onTogglePdv: (key: string) => void;
}) {
  const pdvList = useMemo(() => sortedPdvList(rs.pdvList, pdvSort), [rs.pdvList, pdvSort]);
  // Id sicuri per aria-controls (niente spazi: lista separata da spazi).
  const idSafeKey = rs.rsKey.replace(/[^a-zA-Z0-9_-]/g, "_");
  const pdvRowId = (codicePos: string) => `pezzi-pdv-${idSafeKey}-${codicePos.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const controlledIds = pdvList.map(pdv => pdvRowId(pdv.codicePos)).join(" ");
  return (
    <>
      <tr
        className="border-b bg-muted/30 font-semibold cursor-pointer hover:bg-muted/50"
        onClick={onToggle}
        data-testid={`row-pezzi-rs-${rs.rsKey}`}
      >
        <td className="px-3 py-2 sticky left-0 bg-card z-10">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-left font-semibold"
            aria-expanded={expanded}
            aria-controls={controlledIds}
            aria-label={`${expanded ? "Comprimi" : "Espandi"} ${rs.displayName}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            data-testid={`btn-pezzi-rs-toggle-${rs.rsKey}`}
          >
            {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
            {rs.displayName}
          </button>
        </td>
        {columns.map(column => (
          <td key={column.key} className="text-right px-3 py-2 tabular-nums" data-testid={column.kind === "extra" ? `cell-pezzi-rs-${rs.rsKey}-${column.key}` : undefined}>
            {fmtVal(column.kind === "pista" ? (rs.perPista.get(column.key) || 0) : rs.extra[column.key], column.euro)}
          </td>
        ))}
      </tr>
      {expanded && pdvList.map(pdv => {
        const detailKey = `${rs.rsKey}|${pdv.codicePos}`;
        const detailExpanded = expandedPdv.has(detailKey);
        return (
          <Fragment key={pdv.codicePos}>
            <tr
              id={pdvRowId(pdv.codicePos)}
              className="border-b hover:bg-muted/30"
              data-testid={`row-pezzi-pdv-${pdv.codicePos}`}
            >
              <td className="px-3 py-1.5 pl-8 sticky left-0 bg-card z-10">
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-left rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onTogglePdv(detailKey)}
                  aria-expanded={detailExpanded}
                  aria-controls={`${pdvRowId(pdv.codicePos)}-details`}
                  data-testid={`btn-pezzi-pdv-toggle-${pdv.codicePos}`}
                >
                  {detailExpanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                  <div>
                    <div className="truncate max-w-[220px] font-medium">{pdv.nomeNegozio}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">{pdv.codicePos}</div>
                  </div>
                </button>
              </td>
              {columns.map(column => (
                <td key={column.key} className="text-right px-3 py-1.5 tabular-nums" data-testid={column.kind === "extra" ? `cell-pezzi-pdv-${pdv.codicePos}-${column.key}` : undefined}>
                  {fmtVal(column.kind === "pista" ? (pdv.perPista.get(column.key) || 0) : pdv.extra[column.key], column.euro)}
                </td>
              ))}
            </tr>
            {detailExpanded && (
              <tr id={`${pdvRowId(pdv.codicePos)}-details`} className="border-b">
                <td colSpan={1 + columns.length} className="p-0">
                  <PdvSalesDrilldown
                    sales={pdv.vendite}
                    columns={columns.map((column) => ({
                      key: column.key,
                      label: column.label.replace(/^€\s*/, ""),
                      unit: column.euro ? "euro" as const : "pezzi" as const,
                      value: column.kind === "pista" ? (pdv.perPista.get(column.key) || 0) : (pdv.extra[column.key] || 0),
                    }))}
                  />
                </td>
              </tr>
            )}
          </Fragment>
        );
      })}
    </>
  );
}
