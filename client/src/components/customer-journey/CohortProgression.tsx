import { Children } from "react";
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, CircleHelp, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CjProgression } from "@shared/customerJourneyProgression";

const monthName = (value: string | null) => {
  if (!value) return "Mese non ricostruibile";
  const [year, month] = value.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("it-IT", { month: "long", year: "numeric" });
};
const number = (value: number) => value.toLocaleString("it-IT");
const signed = (value: number) => `${value > 0 ? "+" : ""}${number(value)}`;
const binLabels = ["0 piste", "1 pista", "2 piste", "3 piste", "4 piste", "5 o più"];

interface CohortProgressionProps {
  progression: CjProgression;
  cohortSelected: boolean;
  onOpenJourney: (id: string) => void;
}

export default function CohortProgression({ progression, cohortSelected, onOpenJourney }: CohortProgressionProps) {
  return <div className="space-y-4" data-testid="cj-progression">
    <section className="overflow-hidden rounded-xl border border-primary/20 bg-card">
      <div className="flex flex-col gap-3 border-b border-border bg-primary/[0.035] p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-primary/30 bg-primary/5">CONFRONTO A COORTE FISSA</Badge>
            <span className="text-xs text-muted-foreground">acquisti cumulativi per mese</span>
          </div>
          <h3 className="text-lg font-semibold tracking-tight">La stessa clientela, mese dopo mese</h3>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            Distribuzione cumulativa dei clienti per piste distinte acquistate. Il denominatore resta fisso e include chi oggi non ha più SIM valide; le uscite sono indicate separatamente.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 rounded-lg border border-border bg-background/70 px-3 py-2 text-xs text-muted-foreground">
          <Users className="h-4 w-4 text-primary" />
          I conteggi non sono volumi di contratti
        </div>
      </div>

      {!cohortSelected ? <div className="m-4 flex gap-3 rounded-lg border border-dashed border-primary/30 bg-primary/[0.035] p-4 sm:m-5">
        <CircleHelp className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div><p className="text-sm font-medium">Seleziona un solo mese di coorte</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Il confronto cumulativo è significativo su una clientela acquisita nello stesso mese. Seleziona un mese nel filtro “Mese coorte”; le SIM attualmente cadute restano consultabili qui sotto.</p></div>
      </div> : progression.months.length === 0 ? <p className="p-6 text-sm text-muted-foreground">Non ci sono mesi confrontabili per questa coorte.</p> : <>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-left text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="sticky left-0 z-10 bg-muted/90 px-3 py-3 font-medium">Mese</th>
                <th className="px-3 py-3 font-medium">Clienti fissi</th>
                <th className="px-3 py-3 font-medium">Clienti con SIM valida oggi</th>
                {binLabels.map(label => <th key={label} className="px-3 py-3 font-medium">{label}</th>)}
                <th className="px-3 py-3 font-medium">Prima pista</th>
                <th className="px-3 py-3 font-medium">Da 1 a 2+</th>
                <th className="px-3 py-3 font-medium">SIM cadute nel mese</th>
              </tr>
            </thead>
            <tbody>{progression.months.map((row, index) => <tr key={row.month} className={`border-t border-border ${row.isPartial ? "bg-primary/[0.035]" : ""}`}>
              <td className="sticky left-0 bg-card px-3 py-3 font-medium capitalize">{monthName(row.month)}{row.isPartial && <span className="ml-1 text-[10px] font-normal text-muted-foreground">· parziale</span>}</td>
              <td className="px-3 py-3 tabular-nums">{number(row.clients)}<span className="ml-1 text-muted-foreground">fissi</span></td>
              <td className="px-3 py-3 tabular-nums">{number(row.activeClients)}<span className="ml-1 text-muted-foreground">attivi</span><span className="block text-[10px] text-muted-foreground">{number(row.inactiveClients)} non più qualificati</span></td>
              {row.bins.map((count, bin) => <td key={bin} className="px-3 py-3 tabular-nums">
                <span className="font-medium">{number(count)}</span>
                {row.deltas && <span className={`ml-1 whitespace-nowrap text-[10px] ${row.deltas[bin] > 0 ? "text-emerald-700 dark:text-emerald-300" : row.deltas[bin] < 0 ? "text-rose-700 dark:text-rose-300" : "text-muted-foreground"}`}>
                  ({signed(row.deltas[bin])})
                </span>}
              </td>)}
              <td className="px-3 py-3 tabular-nums">{number(row.firstProduct)}</td>
              <td className="px-3 py-3 tabular-nums">{number(row.fromOneToMore)}</td>
              <td className="px-3 py-3 tabular-nums">{number(row.droppedSims)}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border px-4 py-3 text-[11px] text-muted-foreground">
          <span>Tra parentesi: differenza rispetto al mese precedente.</span>
          <span>Clienti con almeno una pista: {progression.months.at(-1)?.withProducts ?? 0} · {progression.months.at(-1)?.percentage.toLocaleString("it-IT", { maximumFractionDigits: 1 }) ?? "0"}% del denominatore.</span>
          <span>Clienti avanzati nell’ultimo mese: {progression.months.at(-1)?.advanced ?? 0}.</span>
        </div>
      </>}
    </section>

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
          <thead className="bg-muted/40 text-muted-foreground"><tr>{["Cliente", "Coorte", "Negozio", "Addetto apertura", "Journey"].map(h => <th key={h} className="px-3 py-3 font-medium">{h}</th>)}</tr></thead>
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
