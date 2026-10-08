import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CJ_SIM_REASONS, reconcileCjMobile, type CjMobileSource } from "@shared/customerJourneyDiagnostics";
import { economicStateLabel, type CjGettoneJourney, type CjListFilters, type CjReportRow } from "@shared/customerJourney";

const EMPTY_SOURCES: CjMobileSource[] = [];
const euro = (n: number) => n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });

export default function SimDiagnostics({ rows, selected, filters, from, to, onOpenJourney }: {
  rows: CjReportRow[]; selected: CjGettoneJourney[]; filters: CjListFilters;
  from: string; to: string; onOpenJourney: (id: string) => void;
}) {
  const query = useQuery<CjMobileSource[]>({ queryKey: ["/api/customer-journeys/report-mobile-sources"] });
  const [showDetail, setShowDetail] = useState(false);
  const d = useMemo(() => reconcileCjMobile(query.data ?? EMPTY_SOURCES, rows, selected, filters, from, to),
    [query.data, rows, selected, filters, from, to]);
  return (
    <Card data-testid="cj-sim-diagnostics">
      <CardHeader><CardTitle className="text-base">SIM, esclusioni ed esiti economici</CardTitle></CardHeader>
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
          {query.isPending ? <p className="text-sm">Caricamento dettaglio vendite…</p> : query.isError ? (
            <div role="alert" className="text-sm text-destructive">Dettaglio SIM non disponibile; nessun totale vendite è stato stimato.
              <Button variant="outline" size="sm" onClick={() => query.refetch()}>Riprova</Button>
            </div>
          ) : <>
            <p className="text-sm font-semibold mt-2">Articoli nel perimetro: {d.sourceTotal}</p>
            <dl className="grid gap-x-5 gap-y-1 sm:grid-cols-2 text-sm">
              {Object.entries(CJ_SIM_REASONS).map(([key, label]) => <div key={key} className="flex justify-between gap-2">
                <dt>{label}</dt><dd className="font-semibold">{d.counts[key as keyof typeof CJ_SIM_REASONS]}</dd>
              </div>)}
            </dl>
            <p className={d.discrepancy ? "text-sm text-destructive mt-2" : "text-xs text-muted-foreground mt-2"}>
              Discrepanza SIM CJ nel periodo − articoli ammessi BiSuite: {d.discrepancy}.
              {d.discrepancy !== 0 && " I due flussi non coincidono: controlla gli agganci o le date. Nessuna correzione automatica eseguita."}
            </p>
          </>}
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowDetail(v => !v)} aria-expanded={showDetail}>
          {showDetail ? "Nascondi contratti e articoli" : "Mostra contratti e articoli"}
        </Button>
        {showDetail && <div className="space-y-3 max-h-[32rem] overflow-y-auto">
          <h3 className="text-sm font-semibold">Articoli del periodo e motivo</h3>
          {d.details.map(({ source: s, row, reason }, index) => <div key={`${s.saleId}:${s.articleId}:${index}`} className="rounded-md border p-3 text-xs space-y-1">
            <p className="font-semibold">{s.cliente || "Senza identità"} · Vendita {s.bisuiteId} · Articolo {s.articleId ?? "senza ID"}</p>
            <p className="break-words">{s.descrizione || s.tipologia} · {s.insertedAt?.slice(0, 10) || "senza data"} · {row?.pdv ?? s.pdv} · {row?.addetto ?? s.addetto}</p>
            <p>{CJ_SIM_REASONS[reason]} · Contratto: {row?.codiceContratto || s.contract || "non disponibile"}</p>
            {row && <Button size="sm" variant="link" onClick={() => onOpenJourney(row.journeyId)}>Apri scheda cliente</Button>}
          </div>)}
          <h3 className="text-sm font-semibold">Esiti SIM dei clienti selezionati, incluse successive e negative</h3>
          {d.mobile.filter(r => r.driver === "mobile").map((r, index) => <div key={r.itemId ?? index} className="rounded-md border p-3 text-xs space-y-1">
            <p className="font-semibold">{r.cliente} · Contratto {r.codiceContratto || "non disponibile"}</p>
            <p className="break-words">{r.descrizione} · {r.insertedAt?.slice(0, 10) || "senza data"}</p>
            <p>DRMS: {economicStateLabel(r.drmsOutcomeState)} · Stato utilizzato: {economicStateLabel(r.economicState)}
              {r.economicStateManual ? " (manuale)" : " (non manuale)"}</p>
            {r.gettoneConfirmed && <p>Spunta manuale “gettone confermato”; non è un esito DRMS.</p>}
            <Button size="sm" variant="link" onClick={() => onOpenJourney(r.journeyId)}>Apri scheda cliente</Button>
          </div>)}
          <h3 className="text-sm font-semibold">Gettoni calcolati per cliente</h3>
          {d.confirmed.map(j => <div key={j.journeyId} className="rounded-md border p-3 text-xs">
            <p>{j.cliente}: esiti positivi {euro(j.real)} · inclusi presunti {euro(j.includingPresumed)}</p>
            <Button size="sm" variant="link" onClick={() => onOpenJourney(j.journeyId)}>Apri scheda cliente</Button>
          </div>)}
        </div>}
      </CardContent>
    </Card>
  );
}
