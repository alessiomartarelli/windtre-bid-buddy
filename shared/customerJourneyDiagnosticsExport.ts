import { economicStateLabel, isCjItemActive, type CjListFilters } from "./customerJourney";
import { CJ_SIM_REASONS, inCjInsertPeriod, type reconcileCjMobile } from "./customerJourneyDiagnostics";
import { cjAppliedFilterMetadata } from "./customerJourneyExport";

export type CjSimDiagnostics = ReturnType<typeof reconcileCjMobile>;
export type DiagnosticCell = string | number;
export interface DiagnosticSheet {
  name: string;
  rows: DiagnosticCell[][];
}

export const CJ_DIAGNOSTICS_PAYMENT_WARNING =
  "Sono calcoli sui contratti, non una prova di bonifico o di liquidazione effettiva del gettone CJ.";

/** Only consumes the same reconciled, authorized snapshot rendered by SimDiagnostics. */
export function buildCjDiagnosticsSheets(
  d: CjSimDiagnostics, filters: CjListFilters, from: string, to: string,
): DiagnosticSheet[] {
  const outcomeCells = (r?: CjSimDiagnostics["mobile"][number]): DiagnosticCell[] => r ? [
    r.state, economicStateLabel(r.drmsOutcomeState), economicStateLabel(r.economicState),
    r.economicStateManual ? "Manuale" : "Non manuale",
    r.economicStateManual && (r.drmsOutcomeState ?? null) !== (r.economicState ?? null) ? "Sì" : "No",
    r.gettoneConfirmed ? "Sì" : "No",
  ] : ["Non agganciato", "Non disponibile", "Non disponibile", "Non disponibile", "Non disponibile", "Non disponibile"];
  const outcomeHeaders = [
    "Stato operativo", "Esito DRMS", "Stato economico utilizzato", "Origine stato utilizzato",
    "Discrepanza manuale / DRMS", "Spunta manuale gettone confermato",
  ];
  const additionalFilterRows = cjAppliedFilterMetadata(filters)
    .filter(({ label }) => ["PDV origine", "PDV destinazione effettiva", "Ragione sociale"].includes(label))
    .map(({ label, value }): DiagnosticCell[] => [label, value]);
  return [
    {
      name: "Riepilogo",
      rows: [
        ["Voce", "Valore"],
        ["Dal (inserimento prima SIM valida)", from || "Senza limite"],
        ["Al (inserimento prima SIM valida)", to || "Senza limite"],
        ["Tipo cliente", filters.typeFilter],
        ["PDV", filters.pdvFilter.join(" · ") || "Tutti"],
        ["Addetto", filters.addettoFilter], ["Stato", filters.stateFilter],
        ["Ricerca", filters.search],
        ...additionalFilterRows,
        ["Perimetro", "Solo dati autorizzati, stessi filtri di Analisi gettoni. Clienti acquisiti nel periodo; articoli dei clienti nella finestra solare T0–T5 inclusi."],
        ["Date", "Periodo SIM e articoli BiSuite: data inserimento. Finestra T0–T5: data evento e mese T0 della CJ, in UTC."],
        ["Clienti distinti", d.clients],
        ["SIM valide nel periodo", d.period],
        ["SIM successive (dopo il «al»)", d.later],
        ["Altre SIM cumulative (precedenti o senza data)", d.earlierOrUndated],
        ["SIM valide cumulative T0–T5", d.cumulative],
        ["Distinzione successive", to ? `Inserite dopo ${to}` : "Imposta la data «al» per distinguere le SIM successive."],
        ["Articoli BiSuite nel periodo e nel perimetro", d.sourceTotal],
        ...Object.entries(CJ_SIM_REASONS).map(([key, label]): DiagnosticCell[] =>
          [label, d.counts[key as keyof typeof CJ_SIM_REASONS]]),
        ["Discrepanza SIM CJ nel periodo − articoli ammessi BiSuite", d.discrepancy],
        ["Discrepanze", "I flussi possono non coincidere: controllare agganci e date. Nessuna correzione automatica."],
        ["Priorità motivi esclusivi", "Vendita annullata, esclusione commerciale, identità, aggancio, esito negativo, KO, finestra, coorte. Un solo motivo per articolo."],
        ["SIM pagate DRMS", d.outcomes.drmsPaid],
        ["SIM riaccreditate DRMS", d.outcomes.drmsRecredited],
        ["SIM annullate / stornate DRMS", d.outcomes.drmsNegative],
        ["SIM senza esito DRMS", d.outcomes.drmsNone],
        ["Conferme manuali positive", d.outcomes.manualPositive],
        ["Stati manuali negativi", d.outcomes.manualNegative],
        ["Azzeramenti manuali", d.outcomes.manualNone],
        ["SIM con spunta manuale gettone confermato", d.outcomes.manualGettone],
        ["DRMS e manuale", "Sono sovrapposti, non da sommare. Lo stato manuale prevale, anche se diverso dal DRMS. La spunta gettone confermato non è un esito DRMS e non modifica i calcoli."],
        ["Gettone base + extra con esito positivo esplicito (EUR)", d.confirmedTotal],
        ["Gettone base stimato (EUR)", d.confirmed.reduce((sum, j) => sum + j.base, 0)],
        ["Extra SIM–smartphone stimati (EUR)", d.confirmed.reduce((sum, j) => sum + j.extra, 0)],
        ["Coppie aggiuntive", d.confirmed.reduce((sum, j) => sum + j.extraCoppie, 0)],
        ["Gettone includendo smartphone presunti (EUR)", d.includingPresumedTotal],
        ["Incremento dovuto al presunto (EUR)", d.includingPresumedTotal - d.confirmedTotal],
        ["Esiti positivi", "Pagato / riaccreditato, DRMS o conferma manuale; smartphone senza esito esclusi dal calcolo su esiti positivi. Il totale inclusi presunti conserva il valore storico."],
        ["Avvertenza", CJ_DIAGNOSTICS_PAYMENT_WARNING],
      ],
    },
    {
      name: "Articoli BiSuite",
      rows: [
        ["ID vendita", "Vendita BiSuite", "ID articolo", "ID CJ", "Cliente", "Identità", "Tipo cliente",
          "PDV", "Addetto", "Categoria", "Tipologia", "Descrizione", "Inserito il", "Contratto",
          "Vendita annullata", "Codice motivo esclusivo", "Motivo esclusivo", ...outcomeHeaders],
        ...d.details.map(({ source: s, row: r, reason }): DiagnosticCell[] => [
          s.saleId, String(s.bisuiteId), s.articleId == null ? "" : String(s.articleId),
          r?.journeyId ?? "", s.cliente, s.customerKey, s.customerType,
          r?.pdv ?? s.pdv, r?.addetto ?? s.addetto, s.categoria, s.tipologia, s.descrizione,
          s.insertedAt?.slice(0, 10) ?? "", r?.codiceContratto || s.contract,
          s.cancelled ? "Sì" : "No", reason, CJ_SIM_REASONS[reason], ...outcomeCells(r),
        ]),
      ],
    },
    {
      name: "Contratti SIM CJ",
      rows: [
        ["ID CJ", "ID articolo CJ", "ID vendita", "ID articolo BiSuite", "Cliente", "Identità",
          "Tipo cliente", "PDV origine", "PDV destinazione effettiva", "PDV destinazione manuale",
          "Addetto", "Contratto", "Categoria", "Tipologia", "Descrizione",
          "T0 apertura", "Data evento", "Inserito il", "Periodo inserimento", "Contribuisce alle SIM valide cumulative",
          ...outcomeHeaders],
        ...d.mobile.map((r): DiagnosticCell[] => [
          r.journeyId, r.itemId ?? "", r.bisuiteSaleId ?? "",
          r.bisuiteArticleId == null ? "" : String(r.bisuiteArticleId),
          r.cliente, r.customerKey, r.customerType, r.pdvOrigine || r.pdv,
          r.pdvDestinazioneEffettiva || "Senza destinazione", r.pdvDestinazione || "",
          r.addetto, r.codiceContratto ?? "",
          r.categoria ?? "", r.tipologia ?? "", r.descrizione ?? "",
          r.openedAt?.slice(0, 10) ?? "", r.eventDate?.slice(0, 10) ?? "", r.insertedAt?.slice(0, 10) ?? "",
          inCjInsertPeriod(r.insertedAt, from, to) ? "Nel periodo"
            : to && r.insertedAt && r.insertedAt.slice(0, 10) > to ? "Successiva" : "Precedente o senza data",
          isCjItemActive(r) ? "Sì" : "No", ...outcomeCells(r),
        ]),
      ],
    },
    {
      name: "Gettoni per cliente",
      rows: [
        ["ID CJ", "Cliente", "Gettone esiti positivi (EUR)", "Gettone inclusi smartphone presunti (EUR)",
          "Incremento presunto (EUR)", "Avvertenza", "Base stimata (EUR)", "Extra stimati (EUR)", "Coppie aggiuntive",
          "Base esiti espliciti (EUR)", "Extra esiti espliciti (EUR)", "Gettone confermato manualmente (EUR)"],
        ...d.confirmed.map((j): DiagnosticCell[] => [
          j.journeyId, j.cliente, j.real, j.includingPresumed, j.includingPresumed - j.real,
          CJ_DIAGNOSTICS_PAYMENT_WARNING,
          j.base, j.extra, j.extraCoppie, j.baseExplicit, j.extraExplicit, j.manualConfirmed,
        ]),
      ],
    },
  ];
}
