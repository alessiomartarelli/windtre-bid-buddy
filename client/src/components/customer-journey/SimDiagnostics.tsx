import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { exportCjDiagnosticsExcel } from "@/lib/customerJourneyDiagnosticsExport";
import { economicStateLabel, type CjGettoneJourney, type CjListFilters, type CjReportRow } from "@shared/customerJourney";
import { CJ_SIM_REASONS, type CjSimDiagnosticPage } from "@shared/customerJourneyDiagnostics";
import { apiUrl, routePath } from "@/lib/basePath";

class DiagnosticVersionChanged extends Error {}
const euro = (n: number) => n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });

export default function SimDiagnostics({ filters, from, to, onOpenJourney }: {
  rows: CjReportRow[]; selected: CjGettoneJourney[]; filters: CjListFilters;
  from: string; to: string; onOpenJourney: (id: string) => void;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const [generation, setGeneration] = useState(0);
  const context = JSON.stringify({ filters, from, to });
  const [pagination, setPagination] = useState({ context, version: "", page: 0 });
  const params = new URLSearchParams({ filters: JSON.stringify(filters), from, to });
  const load = async (detail: boolean, page: number, version: string | undefined, signal?: AbortSignal): Promise<CjSimDiagnosticPage> => {
    const requestParams = new URLSearchParams(params);
    if (version) requestParams.set("version", version);
    const response = await fetch(apiUrl(`/api/customer-journeys/report-mobile-sources?${requestParams}&detail=${detail ? 1 : 0}&page=${page}`),
      { credentials: "include", signal });
    if (response.status === 409) throw new DiagnosticVersionChanged("I dati vendite o CJ sono cambiati.");
    if (response.status === 401) throw new Error("401: Sessione scaduta");
    if (!response.ok) throw new Error("Dettaglio SIM non disponibile");
    return response.json();
  };
  const query = useQuery<CjSimDiagnosticPage>({
    queryKey: ["/api/customer-journeys/report-mobile-sources", context, generation, "summary"],
    queryFn: ({ signal }) => load(false, 0, undefined, signal),
    staleTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false, refetchOnMount: "always",
  });
  const version = query.data?.version;
  const page = pagination.context === context && pagination.version === version ? pagination.page : 0;
  // Commit changed contexts: returning to previous filters must not resurrect page two.
  if (pagination.context !== context || (version && pagination.version !== version)) {
    setPagination({ context, version: version ?? "", page: 0 });
  }
  const detailQuery = useQuery<CjSimDiagnosticPage>({
    queryKey: ["/api/customer-journeys/report-mobile-sources", context, generation, "detail", version, page],
    queryFn: ({ signal }) => load(true, page, version, signal), enabled: showDetail && !!version && !query.isFetching,
    retry: false,
    // A revisited page must validate its version rather than silently reuse cached rows.
    staleTime: 0, refetchOnMount: "always",
  });
  const reload = () => {
    setPagination({ context, version: "", page: 0 });
    setGeneration(v => v + 1);
  };
  const d = query.data?.diagnostics;
  const sessionExpired = query.error instanceof Error && query.error.message.startsWith("401:");
  if (detailQuery.error instanceof DiagnosticVersionChanged) {
    return <Card data-testid="cj-sim-diagnostics">
      <CardHeader><CardTitle className="text-base">SIM, esclusioni ed esiti economici</CardTitle></CardHeader>
      <CardContent><div role="alert" className="space-y-3 text-sm">
        <p>I dati vendite o CJ sono cambiati durante la consultazione. Ricarica la diagnostica per vedere riepilogo e pagine coerenti. Nessuna riconciliazione è stata avviata.</p>
        <Button variant="outline" size="sm" onClick={reload}>Ricarica diagnostica</Button>
      </div></CardContent>
    </Card>;
  }
  if (!d || query.isFetching || query.isError) {
    return <Card data-testid="cj-sim-diagnostics">
      <CardHeader>
        <CardTitle className="text-base">SIM, esclusioni ed esiti economici</CardTitle>
        <Button variant="outline" size="sm" data-testid="cj-sim-diagnostics-export" disabled>Scarica diagnostica Excel</Button>
      </CardHeader>
      <CardContent>
      {query.isError ? <div role="alert">
        {sessionExpired ? "Sessione scaduta. Accedi di nuovo per caricare il dettaglio SIM." : "Dettaglio SIM non disponibile."}
        {sessionExpired ? <Button variant="outline" size="sm" asChild><a href={routePath("/auth")}>Accedi di nuovo</a></Button>
          : <Button variant="outline" size="sm" onClick={reload}>Riprova</Button>}
      </div> : <p className="text-sm">Caricamento diagnostica SIM…</p>}
    </CardContent></Card>;
  }
  const sourceTotal = query.data?.sourceTotal ?? 0;
  const discrepancy = d.period - (query.data?.counts.admitted ?? 0);
  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(Math.max(sourceTotal, d.mobile.length, d.confirmed.length) / pageSize));
  return (
    <Card data-testid="cj-sim-diagnostics">
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-base">SIM, esclusioni ed esiti economici</CardTitle>
        <Button variant="outline" size="sm" data-testid="cj-sim-diagnostics-export"
          disabled={detailQuery.isFetching || detailQuery.isError}
          onClick={() => exportCjDiagnosticsExcel(d, filters, from, to)}>
          Scarica diagnostica Excel
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Clienti selezionati per prima SIM valida inserita nel periodo. I volumi cumulativi e gli esiti riguardano
          i loro articoli autorizzati nella finestra T0–T6, con gli stessi filtri del report.
        </p>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
          {[
            ["Clienti distinti", d.clients], ["SIM valide nel periodo", d.period],
            ["SIM successive (dopo il «al»)", d.later], ["SIM valide cumulative T0–T6", d.cumulative],
          ].map(([label, value]) => <div key={label} className="rounded-md bg-muted/40 p-3">
            <dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-semibold tabular-nums">{value}</dd>
          </div>)}
        </dl>
        {d.earlierOrUndated > 0 && <p className="text-sm">Altre SIM cumulative (precedenti o senza data): {d.earlierOrUndated}.</p>}
        {!to && <p className="text-xs text-muted-foreground">Imposta la data «al» per distinguere le SIM successive.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border p-3">
            <p className="text-sm">Gettone calcolato su piste con esito positivo esplicito</p>
            <p className="font-semibold">{euro(d.confirmedTotal)}</p>
            <p className="text-xs text-muted-foreground">Pagato / riaccreditato, DRMS o conferma manuale; smartphone senza esito esclusi.</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-sm">Gettone calcolato includendo smartphone presunti</p>
            <p className="font-semibold">{euro(d.includingPresumedTotal)}</p>
            <p className="text-xs text-muted-foreground">Valore totale storico conservato. Incremento dovuto al presunto: {euro(d.includingPresumedTotal - d.confirmedTotal)}.</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Sono calcoli sui contratti, non una prova di bonifico o di liquidazione effettiva del gettone CJ.</p>
        <div>
          <h3 className="text-sm font-semibold">Esiti DRMS delle SIM dei clienti selezionati (T0–T6)</h3>
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {[
              ["Pagato DRMS", d.outcomes.drmsPaid], ["Riaccreditato DRMS", d.outcomes.drmsRecredited],
              ["Annullato / stornato DRMS", d.outcomes.drmsNegative], ["Senza esito DRMS", d.outcomes.drmsNone],
            ].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-semibold">{value}</dd></div>)}
          </dl>
          <p className="text-xs text-muted-foreground mt-2">
            Conferme manuali positive: {d.outcomes.manualPositive}; stati manuali negativi: {d.outcomes.manualNegative};
            azzeramenti manuali: {d.outcomes.manualNone}. Sono sovrapposti agli esiti DRMS, non da sommare.
            Lo stato manuale prevale per il calcolo, anche se diverso dal DRMS.
          </p>
          <p className="text-xs text-muted-foreground mt-1">SIM con spunta manuale “gettone confermato”: {d.outcomes.manualGettone}.
            La spunta non è un esito DRMS e non modifica questi calcoli.</p>
        </div>
        <div>
          <h3 className="text-sm font-semibold">Riconciliazione articoli mobile BiSuite inseriti nel periodo</h3>
          <p className="text-xs text-muted-foreground">Tutte le categorie mobile CJ, incluse offerte escluse e vendite annullate; un solo motivo per articolo.
            Priorità: vendita annullata, esclusione commerciale, identità, aggancio, esito negativo, KO, finestra, coorte.
            Gli articoli non agganciati hanno lo stato di origine “inserito” (o annullato) e nessun esito CJ.</p>
          <>
            <p className="text-sm font-semibold mt-2">Articoli nel perimetro: {sourceTotal}</p>
            <dl className="grid gap-x-5 gap-y-1 sm:grid-cols-2 text-sm">
              {Object.entries(CJ_SIM_REASONS).map(([key, label]) => <div key={key} className="flex justify-between gap-2">
                <dt>{label}</dt><dd className="font-semibold">{query.data?.counts[key as keyof typeof CJ_SIM_REASONS]}</dd>
              </div>)}
            </dl>
            <p className={discrepancy ? "text-sm text-destructive mt-2" : "text-xs text-muted-foreground mt-2"}>
              Discrepanza SIM CJ nel periodo − articoli ammessi BiSuite: {discrepancy}.
              {discrepancy !== 0 && " I due flussi non coincidono: controlla gli agganci o le date. Nessuna correzione automatica eseguita."}
            </p>
          </>
        </div>
        <Button variant="outline" size="sm" onClick={() => {
          setPagination({ context, version: version!, page: 0 });
          setShowDetail(v => !v);
        }} aria-expanded={showDetail}>
          {showDetail ? "Nascondi contratti e articoli" : "Mostra contratti e articoli"}
        </Button>
        {showDetail && <div data-testid="cj-sim-detail" className="space-y-3 max-h-[32rem] overflow-y-auto">
          <div className="flex flex-wrap items-center gap-2" aria-label="Pagine dettaglio SIM">
            <Button size="sm" variant="outline" disabled={page === 0 || detailQuery.isFetching}
              onClick={() => setPagination({ context, version: version!, page: page - 1 })}>Precedente</Button>
            <span className="text-xs">Pagina {page + 1} di {totalPages} · massimo 50 righe per sezione</span>
            <Button size="sm" variant="outline" disabled={page + 1 >= totalPages || detailQuery.isFetching}
              onClick={() => setPagination({ context, version: version!, page: page + 1 })}>Successiva</Button>
          </div>
          <h3 className="text-sm font-semibold">Articoli del periodo e motivo</h3>
          {detailQuery.isPending && <p className="text-sm">Caricamento pagina…</p>}
          {detailQuery.isError && <div role="alert" className="text-sm text-destructive">
            Pagina non disponibile. <Button size="sm" variant="outline" onClick={() => detailQuery.refetch()}>Riprova</Button>
          </div>}
          {detailQuery.isSuccess && !detailQuery.data.details.length && <p className="text-xs text-muted-foreground">Nessun articolo in questa pagina.</p>}
          {!detailQuery.isFetching && !detailQuery.isError && detailQuery.data?.details.map(({ source: s, row, reason }, index) => <div data-testid="cj-sim-source-row" key={`${s.saleId}:${s.articleId}:${index}`} className="rounded-md border p-3 text-xs space-y-1">
            <p className="font-semibold">{s.cliente || "Senza identità"} · Vendita {s.bisuiteId} · Articolo {s.articleId ?? "senza ID"}</p>
            <p className="break-words">{s.descrizione || s.tipologia} · {s.insertedAt?.slice(0, 10) || "senza data"} · {row?.pdv ?? s.pdv} · {row?.addetto ?? s.addetto}</p>
            <p>{CJ_SIM_REASONS[reason]} · Contratto: {row?.codiceContratto || s.contract || "non disponibile"}</p>
            {row && <Button size="sm" variant="link" onClick={() => onOpenJourney(row.journeyId)}>Apri scheda cliente</Button>}
          </div>)}
          <h3 className="text-sm font-semibold">Esiti SIM dei clienti selezionati, incluse successive e negative</h3>
          {d.mobile.slice(page * pageSize, (page + 1) * pageSize).map((r, index) => <div data-testid="cj-sim-outcome-row" key={r.itemId ?? index} className="rounded-md border p-3 text-xs space-y-1">
            <p className="font-semibold">{r.cliente} · Contratto {r.codiceContratto || "non disponibile"}</p>
            <p className="break-words">{r.descrizione} · {r.insertedAt?.slice(0, 10) || "senza data"}</p>
            <p>DRMS: {economicStateLabel(r.drmsOutcomeState)} · Stato utilizzato: {economicStateLabel(r.economicState)}
              {r.economicStateManual ? " (manuale)" : " (non manuale)"}</p>
            {r.gettoneConfirmed && <p>Spunta manuale “gettone confermato”; non è un esito DRMS.</p>}
            <Button size="sm" variant="link" onClick={() => onOpenJourney(r.journeyId)}>Apri scheda cliente</Button>
          </div>)}
          <h3 className="text-sm font-semibold">Gettoni calcolati per cliente</h3>
          {d.confirmed.slice(page * pageSize, (page + 1) * pageSize).map(j => <div data-testid="cj-sim-gettone-row" key={j.journeyId} className="rounded-md border p-3 text-xs">
            <p>Base stimata {euro(j.base)} · extra {euro(j.extra)} ({j.extraCoppie} coppie)</p>
            <p>{j.cliente}: esiti positivi {euro(j.real)} · inclusi presunti {euro(j.includingPresumed)}</p>
            <Button size="sm" variant="link" onClick={() => onOpenJourney(j.journeyId)}>Apri scheda cliente</Button>
          </div>)}
        </div>}
      </CardContent>
    </Card>
  );
}
