import { Children } from "react";
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CjProgression } from "@shared/customerJourneyProgression";

const monthName = (value: string | null) => {
  if (!value) return "Mese non ricostruibile";
  const [year, month] = value.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("it-IT", { month: "long", year: "numeric" });
};
const number = (value: number) => value.toLocaleString("it-IT");

interface CohortProgressionProps {
  progression: CjProgression;
  cohortSelected: boolean;
  cohortMonth: string;
  onOpenJourney: (id: string) => void;
}

export default function CohortProgression({ progression, cohortSelected, cohortMonth, onOpenJourney }: CohortProgressionProps) {
  const hasFivePlus = progression.months.some(row => (row.bins[5] ?? 0) > 0);
  const todayLabel = new Date().toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });
  const periodLabel = (row: CjProgression["months"][number]) =>
    row.isPartial ? `Al ${todayLabel}` : `Fine ${new Date(Number(row.month.slice(0, 4)), Number(row.month.slice(5, 7)) - 1, 1).toLocaleDateString("it-IT", { month: "long" })}`;
  return <div className="space-y-4" data-testid="cj-progression">
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm" data-testid="cohort-evolution-table">
      <div className="border-b border-border px-4 py-4 sm:px-6">
        <h3 className="text-lg font-semibold tracking-tight">{cohortSelected ? `Evoluzione dei clienti di ${monthName(cohortMonth)}` : "Evoluzione clienti"}</h3>
        <p className="mt-1 text-xs text-muted-foreground">I conteggi includono i prodotti validi dei clienti ancora qualificati; il gruppo clienti mantiene il denominatore fisso, inclusi i non più qualificati.</p>
      </div>
      {!cohortSelected || progression.months.length === 0 ? <p className="p-6 text-sm text-muted-foreground">Non ci sono mesi confrontabili per questo gruppo clienti.</p> : <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-left text-sm">
          <thead className="bg-muted/45 text-muted-foreground"><tr>
            <th scope="col" className="sticky left-0 z-10 min-w-[220px] bg-muted/95 px-4 py-3 font-medium">Prodotti aggiuntivi oltre alla SIM</th>
            {progression.months.map(row => <th scope="col" key={row.month} className="whitespace-nowrap px-4 py-3 text-right font-medium capitalize">{periodLabel(row)}</th>)}
          </tr></thead>
          <tbody>
            {[0, 1, 2, 3, 4, ...(hasFivePlus ? [5] : [])].map(bin => <tr key={bin} className="border-t border-border">
              <th scope="row" className="sticky left-0 bg-card px-4 py-3 font-medium">{bin === 5 ? "5 o più prodotti" : `${bin} ${bin === 1 ? "prodotto" : "prodotti"}`}</th>
              {progression.months.map(row => <td key={row.month} className="px-4 py-3 text-right tabular-nums">{(row.bins[bin] ?? 0).toLocaleString("it-IT")}</td>)}
            </tr>)}
            <tr className="border-t border-border bg-muted/25 font-semibold">
              <th scope="row" className="sticky left-0 bg-muted/50 px-4 py-3">Clienti con almeno 1 prodotto</th>
              {progression.months.map(row => <td key={row.month} className="px-4 py-3 text-right tabular-nums">{row.withProducts.toLocaleString("it-IT")}</td>)}
            </tr>
            <tr className="border-t border-border font-semibold">
              <th scope="row" className="sticky left-0 bg-card px-4 py-3">% dei clienti</th>
              {progression.months.map(row => <td key={row.month} className="px-4 py-3 text-right tabular-nums">{row.percentage.toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</td>)}
            </tr>
          </tbody>
        </table>
      </div>}
    </section>
    <details className="group rounded-xl border border-border bg-card" data-testid="cohort-progression-details">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-muted-foreground marker:hidden hover:text-foreground">
        <span className="inline-flex items-center gap-2"><span className="transition-transform group-open:rotate-90">›</span> Dettagli della progressione e clienti non più qualificati</span>
      </summary>
      <div className="space-y-4 border-t border-border p-3 sm:p-4">
    <div className="grid gap-4 xl:grid-cols-2">
      <DetailTable
        title={`SIM attualmente cadute · ${number(progression.dropped.length)}`}
        caption="SIM eleggibili cadute per esito DRMS o stato CJ. Le SIM annullate nelle vendite sono escluse dalla CJ. La data resta vuota quando non è ricostruibile."
        empty="Nessuna SIM caduta nel perimetro selezionato."
        headers={["Cliente", "Negozio", "Addetto", "Mese / fonte", "Contratto SIM", "Prodotto", "Stato oggi", "Cliente in CJ", "Journey"]}
      >
        {progression.dropped.map((sim, index) => <tr key={`${sim.itemId}-${index}`} className="border-t border-border">
          <td className="px-3 py-3 font-medium">{sim.cliente}</td>
          <td className="px-3 py-3">{sim.pdv || "Non attribuito"}</td><td className="px-3 py-3">{sim.seller || "Non attribuito"}</td>
          <td className="whitespace-nowrap px-3 py-3">{monthName(sim.month)}<span className="block text-[10px] text-muted-foreground">{sim.source}</span></td>
          <td className="px-3 py-3 tabular-nums">{sim.contract || "Non disponibile"}</td><td className="px-3 py-3">{sim.product}</td>
          <td className="px-3 py-3"><Badge variant="outline" className="border-rose-500/30 text-rose-700 dark:text-rose-300">{sim.economicState || sim.state || "Non valido"}</Badge><span className="block text-[10px] text-muted-foreground">Operativo: {sim.state}</span></td>
          <td className="px-3 py-3">{sim.exited ? "Uscito: nessuna SIM valida" : "Ancora in CJ: altra SIM valida"}</td>
          <td className="px-3 py-3"><Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onOpenJourney(sim.journeyId)}>Apri</Button></td>
        </tr>)}
      </DetailTable>

      <DetailTable
        title="Cadute documentate nel tempo"
        caption="Movimenti di perdita con competenza DRMS o decisione manuale esplicita; include SIM poi recuperate."
        empty="Nessuna caduta documentata nel perimetro selezionato."
        headers={["Cliente", "Mese perdita", "Contratto SIM", "Fonte", "Stato SIM oggi"]}
      >
        {progression.falls.map((sim, index) => <tr key={`${sim.itemId}-${sim.month}-${index}`} className="border-t border-border">
          <td className="px-3 py-3 font-medium">{sim.cliente}</td><td className="whitespace-nowrap px-3 py-3">{monthName(sim.month)}</td>
          <td className="px-3 py-3 tabular-nums">{sim.contract || "Non disponibile"}</td><td className="px-3 py-3">{sim.source}</td>
          <td className="px-3 py-3"><Badge variant="outline" className={sim.currentlyDropped ? "border-rose-500/30 text-rose-700 dark:text-rose-300" : "border-emerald-600/30 text-emerald-700 dark:text-emerald-300"}>{sim.currentlyDropped ? "Caduta" : "Recuperata"}</Badge></td>
        </tr>)}
      </DetailTable>
    </div>

    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border p-4">
        <h3 className="font-semibold">Clienti non più qualificati per CJ · {number(progression.exitedCustomers.length)}</h3>
        <p className="mt-1 text-xs text-muted-foreground">Nessuna SIM eleggibile valida oggi. Sono separati dai clienti ancora nel journey grazie ad altre SIM valide; non vengono trasformati in clienti a zero piste.</p>
      </div>
      {progression.exitedCustomers.length === 0 ? <p className="p-5 text-sm text-muted-foreground">Nessun cliente uscito dal perimetro CJ attuale.</p> : <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="bg-muted/40 text-muted-foreground"><tr>{["Cliente", "Mese di acquisizione", "Negozio", "Addetto apertura", "Journey"].map(h => <th key={h} className="px-3 py-3 font-medium">{h}</th>)}</tr></thead>
          <tbody>{progression.exitedCustomers.map(customer => <tr key={customer.journeyId} className="border-t border-border">
            <td className="px-3 py-3 font-medium">{customer.cliente}</td><td className="whitespace-nowrap px-3 py-3 capitalize">{monthName(customer.cohort)}</td>
            <td className="px-3 py-3">{customer.pdv}</td><td className="px-3 py-3">{customer.opener}</td>
            <td className="px-3 py-3"><Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onOpenJourney(customer.journeyId)}>Apri journey</Button></td>
          </tr>)}</tbody>
        </table>
      </div>}
      <div className="flex flex-wrap gap-4 border-t border-border px-4 py-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><ArrowUpRight className="h-3.5 w-3.5 text-emerald-700" /> Vendite senza data: {number(progression.undatedSales)}</span>
        <span className="inline-flex items-center gap-1"><ArrowDownRight className="h-3.5 w-3.5 text-rose-700" /> SIM cadute senza mese: {number(progression.undatedDrops)}</span>
      </div>
    </section>
    <p className="rounded-lg bg-muted/40 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
      Metodo: gli stock commerciali sono ricalcolati sugli stati validi oggi, non sono fotografie di chiusura mensile. La data della perdita mensile deriva solo da competenza DRMS o decisione manuale esplicita; i casi senza data restano separati. Una SIM caduta non equivale a un cliente uscito se nel journey rimane un’altra SIM eleggibile valida. Il perimetro è quello delle schede conservate: eventuali schede già eliminate da precedenti riconciliazioni non possono essere ricostruite da questo storico.
    </p>
      </div>
    </details>
  </div>;
}

function DetailTable({ title, caption, empty, headers, children }: { title: string; caption: string; empty: string; headers: string[]; children: ReactNode }) {
  const hasRows = Children.count(children) > 0;
  return <section className="overflow-hidden rounded-xl border border-border bg-card">
    <div className="border-b border-border p-4"><h3 className="font-semibold">{title}</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{caption}</p></div>
    {hasRows ? <div className="max-h-[360px] overflow-auto"><table className="w-full min-w-[620px] text-left text-xs">
      <thead className="sticky top-0 bg-muted/90 text-muted-foreground"><tr>{headers.map(h => <th key={h} className="whitespace-nowrap px-3 py-2.5 font-medium">{h}</th>)}</tr></thead><tbody>{children}</tbody>
    </table></div> : <p className="p-5 text-sm text-muted-foreground">{empty}</p>}
  </section>;
}
