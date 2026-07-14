// Report vendite giornaliero (Task #239): logica PURA di aggregazione e
// formattazione del messaggio Telegram con il riepilogo delle vendite del
// giorno, coerente con la pagina "Vendite BiSuite". Nessun import runtime
// oltre alla classificazione condivisa: caricabile via loader tsx nei test
// senza dev server né DB.
import {
  classifySaleArticles,
  PISTA_CANVASS_LABELS,
  TYPE_LABELS,
  type ArticleType,
  type PistaCanvass,
} from "./bisuiteClassification";
import { buildCalendar, italianHolidays } from "./incentivazione";
import {
  buildDirettoreCommento,
  fasciaFromTimeLabel,
  EMPTY_FORECAST,
  type ForecastConfig,
  type Fascia,
} from "./venditeCommento";

// Shape minimale della vendita necessaria al report: sottoinsieme di
// `BisuiteSale` (shared/schema.ts) senza dipendere da Drizzle.
export interface VenditaReportRow {
  stato: string | null;
  totale: string | null;
  codicePos: string | null;
  nomeNegozio: string | null;
  /** Addetto vendita (opzionale: usato dal report HTML per addetto). */
  nomeAddetto?: string | null;
  rawData: unknown;
}

/** Categoria con pezzi e fatturato (per il drill-down PDV/addetto). */
export interface CategoriaImportoAggregate {
  categoria: string;
  pezzi: number;
  importo: number;
}

/**
 * Dettaglio drill-down di un PDV o addetto (Task #251): canvass venduti
 * per pista + categorie Prodotti/Servizi con fatturato. Stessa
 * classificazione articoli dei totali globali (ANNULLATA già escluse).
 */
export interface ReportDrilldown {
  /** Pezzi canvass per pista. */
  countByPista: Partial<Record<PistaCanvass, number>>;
  /**
   * Di cui pezzi a clienti Business (P.IVA) per pista (Task #282): lo split
   * P.IVA/CF a livello di addetto/negozio serve al punteggio performance
   * (le attivazioni P.IVA valgono il doppio). Determinato da
   * `saleCustomerKind` (tipo cliente della vendita), non dalla descrizione.
   */
  businessCountByPista: Partial<Record<PistaCanvass, number>>;
  /** Categorie Prodotti (accessori ecc.), ordinate per fatturato↓. */
  prodottiByCategoria: CategoriaImportoAggregate[];
  /** Categorie Servizi, ordinate per fatturato↓. */
  serviziByCategoria: CategoriaImportoAggregate[];
}

export interface PdvReportAggregate {
  codicePos: string;
  nomeNegozio: string;
  vendite: number;
  importo: number;
  /** Punteggio performance pesato (Task #282), criterio di classifica. */
  punteggio: number;
  /** Drill-down del negozio (Task #251). */
  dettaglio: ReportDrilldown;
}

export interface AddettoReportAggregate {
  /** Grafia visualizzata (prima occorrenza incontrata). */
  nomeAddetto: string;
  vendite: number;
  importo: number;
  /** Punteggio performance pesato (Task #282), criterio di classifica. */
  punteggio: number;
  /** Drill-down dell'addetto (Task #251). */
  dettaglio: ReportDrilldown;
}

export interface PistaCategoriaAggregate {
  /** Nome categoria BiSuite (es. "UNTIED", "TIED CF"). */
  categoria: string;
  pezzi: number;
}

/**
 * Ripartizione del fatturato per modalità di pagamento. Finanziato e VAR
 * (credito) sono ESATTI (importi per-articolo BiSuite); il resto del
 * prezzo è ripartito proporzionalmente sul mix di incasso dello
 * scontrino (contanti / POS / altro), che BiSuite espone solo a livello
 * vendita. Vendita senza mix di incasso ⇒ il resto finisce in `altro`.
 */
export interface PagamentoSplit {
  contanti: number;
  pos: number;
  finanziato: number;
  /** VAR / vendite a credito (importoCredito per-articolo). */
  varCredito: number;
  /** Bonifici, assegni, buoni, coupon, non scontrinato, altri. */
  altro: number;
}

export function emptyPagamentoSplit(): PagamentoSplit {
  return { contanti: 0, pos: 0, finanziato: 0, varCredito: 0, altro: 0 };
}

export interface CategoriaReportAggregate {
  /** Nome categoria BiSuite (es. "TELEFONIA", "ACCESSORI"). */
  categoria: string;
  pezzi: number;
  /** Fatturato (somma prezzi articolo, come amountByType). */
  importo: number;
  /** Fatturato della categoria diviso per modalità di pagamento. */
  pagamenti: PagamentoSplit;
}

/** Pezzi e fatturato di un raggruppamento (es. energia per tipo cliente). */
export interface PezziImporto {
  pezzi: number;
  importo: number;
}

/**
 * Split della pista energia per tipo di cliente (Task #263): Privati
 * (persone fisiche, codice fiscale) vs Business (P.IVA / clienti azienda).
 * Il tipo cliente è derivato da `rawData.cliente` della vendita, NON dalla
 * classificazione articoli (che non distingue CF/IVA per l'energia).
 */
export interface EnergiaByCliente {
  privato: PezziImporto;
  business: PezziImporto;
}

export interface DailyReportAggregates {
  /** Vendite non annullate considerate nel report. */
  vendite: number;
  /** Somma dei totali vendita (campo `totale`). */
  importo: number;
  countByType: Record<ArticleType, number>;
  amountByType: Record<ArticleType, number>;
  countByPista: Partial<Record<PistaCanvass, number>>;
  amountByPista: Partial<Record<PistaCanvass, number>>;
  /**
   * Pezzi per pista dei soli clienti Business (P.IVA), determinati da
   * `saleCustomerKind(rawData)` a livello vendita. Usato per il "di cui
   * IVA" di Mobile/Fisso nel commento forecast.
   */
  businessCountByPista: Partial<Record<PistaCanvass, number>>;
  /**
   * Split della pista energia per tipo cliente Privati (CF) vs Business
   * (P.IVA), pezzi e fatturato. Presente anche quando non c'è energia
   * (bucket a zero).
   */
  energiaByCliente: EnergiaByCliente;
  /**
   * Dettaglio della pista assicurazioni per categoria BiSuite (es.
   * ASSICURAZIONI, ASSICURAZIONI BUSINESS PRO, WINDTRE SECURITY PRO GA):
   * pezzi e fatturato, ordinato per pezzi decrescenti.
   */
  assicurazioniDettaglio: CategoriaImportoAggregate[];
  /**
   * Breakdown per categoria dentro ogni pista (es. mobile ⇒ UNTIED/TIED CF),
   * ordinato per pezzi decrescenti. Usato dalle card pista del report HTML.
   */
  categorieByPista: Partial<Record<PistaCanvass, PistaCategoriaAggregate[]>>;
  /**
   * Dettaglio Prodotti per categoria (pezzi, fatturato, split per
   * modalità di pagamento), ordinato per fatturato decrescente.
   */
  prodottiByCategoria: CategoriaReportAggregate[];
  /**
   * Dettaglio Servizi per categoria, stessa shape dei prodotti. I totali
   * servizi (pezzi/fatturato) restano in countByType/amountByType.
   */
  serviziByCategoria: CategoriaReportAggregate[];
  /** Aggregato per punto vendita, ordinato per importo decrescente. */
  perPdv: PdvReportAggregate[];
  /**
   * Aggregato per addetto (grouping case-insensitive sul nominativo),
   * ordinato per importo decrescente. Usato dal report HTML allegato.
   */
  perAddetto: AddettoReportAggregate[];
}

function isAnnullata(stato: string | null | undefined): boolean {
  return (stato ?? "").trim().toUpperCase() === "ANNULLATA";
}

function parseTotale(totale: string | null | undefined): number {
  const n = parseFloat(totale ?? "0");
  return Number.isFinite(n) ? n : 0;
}

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Mix di incasso a livello scontrino letto da `rawData.pagamento`
 * (contanti / POS / altro = bonifici+assegni+buoni+coupon+non
 * scontrinato+altri). Serve a ripartire proporzionalmente sui singoli
 * articoli la parte di prezzo non finanziata/a credito.
 */
function saleIncassoMix(rawData: unknown): { contanti: number; pos: number; altro: number; tot: number } {
  const pag = (rawData as { pagamento?: Record<string, unknown> } | null | undefined)?.pagamento;
  // Clamp a >= 0: valori negativi (storni/rettifiche) non devono generare
  // bucket negativi o distorcere la ripartizione proporzionale.
  const nn = (v: unknown) => Math.max(toNum(v), 0);
  const contanti = nn(pag?.contanti);
  const pos = nn(pag?.pagamentiElettronici);
  const altro =
    nn(pag?.nonScontrinato) +
    nn(pag?.nonScontrinatoPos) +
    nn(pag?.bonifici) +
    nn(pag?.assegni) +
    nn(pag?.buoni) +
    nn(pag?.coupon) +
    nn(pag?.altriPagamenti);
  return { contanti, pos, altro, tot: contanti + pos + altro };
}

/**
 * Determina il tipo di cliente di una vendita da `rawData.cliente` per lo
 * split Energia Privati (CF) vs Business (P.IVA): Business se `clienteTipo`
 * è GIURIDICA/PROFESSIONISTA OPPURE è presente la P.IVA, altrimenti Privato
 * (codice fiscale o cliente non identificabile ⇒ default prudente Privato).
 */
export function saleCustomerKind(rawData: unknown): "privato" | "business" {
  const cliente = (rawData as { cliente?: Record<string, unknown> } | null | undefined)?.cliente ?? {};
  const piva = String(cliente.piva ?? "").toUpperCase().trim();
  const tipo = String(cliente.clienteTipo ?? "").toUpperCase().trim();
  const isAzienda = tipo === "GIURIDICA" || tipo === "PROFESSIONISTA";
  if (isAzienda || piva) return "business";
  return "privato";
}

/**
 * Distingue le offerte energia CF (Consumer) vs IVA (Business) dalla
 * DESCRIZIONE dell'offerta, non dal tipo cliente della vendita: il tipo
 * cliente è inaffidabile (offerte MICROBUSINESS vendute a clienti registrati
 * come privati e viceversa), mentre la descrizione dell'offerta dice sempre
 * se è consumer o business. Business ⇒ la descrizione contiene "BUSINESS"
 * (copre "MICROBUSINESS" e "CLIENTE BUSINESS"); altrimenti Consumer (CF).
 */
export function energiaClienteFromDescrizione(descrizione: string): "privato" | "business" {
  return descrizione.toUpperCase().includes("BUSINESS") ? "business" : "privato";
}

/**
 * Aggrega le vendite del giorno come la pagina Vendite BiSuite:
 * - le vendite ANNULLATA sono ESCLUSE da tutti i conteggi;
 * - pezzi/importi per Tipo e Pista sono a livello articolo
 *   (classifySaleArticles su rawData);
 * - l'importo totale e quello per PDV usano il campo `totale` della vendita.
 */
export function aggregateDailyReport(
  rows: VenditaReportRow[],
  weights: PerformanceWeightsConfig = DEFAULT_PERFORMANCE_WEIGHTS,
): DailyReportAggregates {
  const countByType: Record<ArticleType, number> = { canvass: 0, prodotti: 0, servizi: 0 };
  const amountByType: Record<ArticleType, number> = { canvass: 0, prodotti: 0, servizi: 0 };
  const countByPista: Partial<Record<PistaCanvass, number>> = {};
  const amountByPista: Partial<Record<PistaCanvass, number>> = {};
  const businessCountByPista: Partial<Record<PistaCanvass, number>> = {};
  const catByPista: Partial<Record<PistaCanvass, Map<string, number>>> = {};
  const catByType: Record<"prodotti" | "servizi", Map<string, CategoriaReportAggregate>> = {
    prodotti: new Map(),
    servizi: new Map(),
  };
  const energiaByCliente: EnergiaByCliente = {
    privato: { pezzi: 0, importo: 0 },
    business: { pezzi: 0, importo: 0 },
  };
  const assicurazioniMap = new Map<string, CategoriaImportoAggregate>();
  // Accumulatore del drill-down per singolo PDV/addetto (Task #251).
  interface DrillAcc {
    countByPista: Partial<Record<PistaCanvass, number>>;
    businessCountByPista: Partial<Record<PistaCanvass, number>>;
    prodotti: Map<string, CategoriaImportoAggregate>;
    servizi: Map<string, CategoriaImportoAggregate>;
  }
  const newDrillAcc = (): DrillAcc => ({ countByPista: {}, businessCountByPista: {}, prodotti: new Map(), servizi: new Map() });
  const pdvMap = new Map<string, Omit<PdvReportAggregate, "dettaglio" | "punteggio">>();
  const addettoMap = new Map<string, Omit<AddettoReportAggregate, "dettaglio" | "punteggio">>();
  const pdvDrill = new Map<string, DrillAcc>();
  const addettoDrill = new Map<string, DrillAcc>();
  let vendite = 0;
  let importo = 0;

  for (const row of rows) {
    if (isAnnullata(row.stato)) continue;
    vendite++;
    const tot = parseTotale(row.totale);
    importo += tot;

    // Chiavi PDV/addetto calcolate PRIMA del loop articoli: servono anche
    // agli accumulatori del drill-down per-articolo.
    const key = (row.codicePos ?? "").trim() || "N/D";
    const addettoName = (row.nomeAddetto ?? "").trim() || "N/D";
    const addettoKey = addettoName.toLowerCase();
    let pdvAcc = pdvDrill.get(key);
    if (!pdvAcc) { pdvAcc = newDrillAcc(); pdvDrill.set(key, pdvAcc); }
    let addAcc = addettoDrill.get(addettoKey);
    if (!addAcc) { addAcc = newDrillAcc(); addettoDrill.set(addettoKey, addAcc); }

    const sc = classifySaleArticles(row.rawData);
    const custKind = saleCustomerKind(row.rawData);
    for (const t of Object.keys(sc.countByType) as ArticleType[]) {
      countByType[t] += sc.countByType[t];
      amountByType[t] += sc.amountByType[t];
    }
    for (const [pista, count] of Object.entries(sc.countByPista) as [PistaCanvass, number][]) {
      countByPista[pista] = (countByPista[pista] ?? 0) + count;
      amountByPista[pista] = (amountByPista[pista] ?? 0) + (sc.amountByPista[pista] ?? 0);
      if (custKind === "business") {
        businessCountByPista[pista] = (businessCountByPista[pista] ?? 0) + count;
      }
    }
    const mix = saleIncassoMix(row.rawData);
    for (const article of sc.articles) {
      if (article.pista) {
        // Etichetta dei chip nella card "La gara delle piste". Per la maggior
        // parte delle piste è la categoria BiSuite (es. mobile ⇒ TIED CF /
        // UNTIED). Per assicurazioni ed energia la categoria è un unico bucket
        // ("ASSICURAZIONI" / "ENERGIA W3") che ripeterebbe il totale pista,
        // quindi usiamo un dettaglio più utile (Task #264):
        // - assicurazioni ⇒ la descrizione reale del prodotto (es. CASA
        //   ELETTRODOMESTICI, VIAGGI E VACANZE);
        // - energia ⇒ CF (Consumer) vs IVA (Business), riconosciuti dalla
        //   descrizione dell'offerta (vedi energiaClienteFromDescrizione).
        const catLabel = article.categoriaNome.trim() || "Altro";
        let chipLabel = catLabel;
        if (article.pista === "assicurazioni") {
          chipLabel = article.descrizione.trim() || article.tipologiaNome.trim() || catLabel;
        } else if (article.pista === "energia") {
          chipLabel = energiaClienteFromDescrizione(article.descrizione) === "business" ? "IVA" : "CF";
        }
        const map = catByPista[article.pista] ?? new Map<string, number>();
        map.set(chipLabel, (map.get(chipLabel) ?? 0) + 1);
        catByPista[article.pista] = map;
        // Drill-down: canvass per pista del PDV e dell'addetto.
        pdvAcc.countByPista[article.pista] = (pdvAcc.countByPista[article.pista] ?? 0) + 1;
        addAcc.countByPista[article.pista] = (addAcc.countByPista[article.pista] ?? 0) + 1;
        // Split P.IVA/CF per pista al livello di addetto/negozio (Task #282):
        // determinato dal tipo cliente della vendita (`custKind`), coerente
        // con `businessCountByPista` aggregato. Serve al punteggio performance.
        if (custKind === "business") {
          pdvAcc.businessCountByPista[article.pista] = (pdvAcc.businessCountByPista[article.pista] ?? 0) + 1;
          addAcc.businessCountByPista[article.pista] = (addAcc.businessCountByPista[article.pista] ?? 0) + 1;
        }
        // Split energia CF (Consumer) vs Business (P.IVA) dalla descrizione
        // dell'offerta, non dal tipo cliente della vendita (Task #264).
        if (article.pista === "energia") {
          const kind = energiaClienteFromDescrizione(article.descrizione);
          energiaByCliente[kind].pezzi++;
          energiaByCliente[kind].importo += article.prezzo;
        }
        // Dettaglio assicurazioni per PRODOTTO (Task #264): la categoria
        // BiSuite della pista è sempre l'unico bucket "ASSICURAZIONI", quindi
        // raggruppare per categoria darebbe una sola riga che ripete il totale
        // pista. Usiamo la descrizione reale del prodotto (tipologia +
        // descrizione), con fallback alla categoria se entrambe assenti.
        if (article.pista === "assicurazioni") {
          const assLabel =
            [article.tipologiaNome.trim(), article.descrizione.trim()].filter(Boolean).join(" — ") || catLabel;
          const entry = assicurazioniMap.get(assLabel) ?? { categoria: assLabel, pezzi: 0, importo: 0 };
          entry.pezzi++;
          entry.importo += article.prezzo;
          assicurazioniMap.set(assLabel, entry);
        }
      }

      // Dettaglio Prodotti/Servizi per categoria con split pagamenti:
      // finanziato e VAR sono esatti (per-articolo); il resto del prezzo
      // è ripartito sul mix di incasso dello scontrino, oppure in
      // `altro` se la vendita non espone alcun mix.
      if (article.type === "prodotti" || article.type === "servizi") {
        const catLabel = article.categoriaNome.trim() || "Altro";
        // Drill-down: categoria con pezzi e fatturato per PDV e addetto.
        for (const acc of [pdvAcc, addAcc]) {
          const drillMap = acc[article.type];
          const drillEntry = drillMap.get(catLabel) ?? { categoria: catLabel, pezzi: 0, importo: 0 };
          drillEntry.pezzi++;
          drillEntry.importo += article.prezzo;
          drillMap.set(catLabel, drillEntry);
        }
        const map = catByType[article.type];
        const entry = map.get(catLabel) ?? {
          categoria: catLabel,
          pezzi: 0,
          importo: 0,
          pagamenti: emptyPagamentoSplit(),
        };
        entry.pezzi++;
        entry.importo += article.prezzo;
        // Invariante: la somma dei bucket per-articolo == prezzo articolo.
        // Il finanziato è cappato al prezzo, il VAR al residuo dopo il
        // finanziato, così fin+var non può mai superare il prezzo.
        const prezzo = Math.max(article.prezzo, 0);
        const fin = Math.min(Math.max(article.importoFinanziato, 0), prezzo);
        const varC = Math.min(Math.max(article.importoCredito, 0), prezzo - fin);
        entry.pagamenti.finanziato += fin;
        entry.pagamenti.varCredito += varC;
        const resto = Math.max(prezzo - fin - varC, 0);
        if (resto > 0) {
          if (mix.tot > 0) {
            entry.pagamenti.contanti += (resto * mix.contanti) / mix.tot;
            entry.pagamenti.pos += (resto * mix.pos) / mix.tot;
            entry.pagamenti.altro += (resto * mix.altro) / mix.tot;
          } else {
            entry.pagamenti.altro += resto;
          }
        }
        map.set(catLabel, entry);
      }
    }

    const existing = pdvMap.get(key);
    if (existing) {
      existing.vendite++;
      existing.importo += tot;
      if (!existing.nomeNegozio && row.nomeNegozio) existing.nomeNegozio = row.nomeNegozio.trim();
    } else {
      pdvMap.set(key, {
        codicePos: key,
        nomeNegozio: (row.nomeNegozio ?? "").trim(),
        vendite: 1,
        importo: tot,
      });
    }

    // Per addetto: grouping case-insensitive (le grafie diverse dello
    // stesso nominativo si fondono, come nelle gare addetto).
    const existingAdd = addettoMap.get(addettoKey);
    if (existingAdd) {
      existingAdd.vendite++;
      existingAdd.importo += tot;
    } else {
      addettoMap.set(addettoKey, { nomeAddetto: addettoName, vendite: 1, importo: tot });
    }
  }

  // Finalizza il drill-down: array categorie ordinati per fatturato↓.
  const sortDrillCategorie = (map: Map<string, CategoriaImportoAggregate>): CategoriaImportoAggregate[] =>
    Array.from(map.values()).sort(
      (a, b) => b.importo - a.importo || b.pezzi - a.pezzi || a.categoria.localeCompare(b.categoria, "it"),
    );
  const finalizeDrill = (acc: DrillAcc | undefined): ReportDrilldown => ({
    countByPista: acc?.countByPista ?? {},
    businessCountByPista: acc?.businessCountByPista ?? {},
    prodottiByCategoria: acc ? sortDrillCategorie(acc.prodotti) : [],
    serviziByCategoria: acc ? sortDrillCategorie(acc.servizi) : [],
  });

  // Classifiche ordinate per PUNTEGGIO performance (Task #282), non più per
  // fatturato: il fatturato resta come informazione mostrata ma non è più il
  // criterio. Tie-break su fatturato, poi vendite, poi nome (stabile).
  const perPdv: PdvReportAggregate[] = Array.from(pdvMap.entries())
    .map(([k, p]) => {
      const dettaglio = finalizeDrill(pdvDrill.get(k));
      return { ...p, dettaglio, punteggio: performanceScore(dettaglio, weights) };
    })
    .sort(
      (a, b) =>
        b.punteggio - a.punteggio ||
        b.importo - a.importo ||
        b.vendite - a.vendite ||
        a.codicePos.localeCompare(b.codicePos, "it"),
    );
  const perAddetto: AddettoReportAggregate[] = Array.from(addettoMap.entries())
    .map(([k, p]) => {
      const dettaglio = finalizeDrill(addettoDrill.get(k));
      return { ...p, dettaglio, punteggio: performanceScore(dettaglio, weights) };
    })
    .sort(
      (a, b) =>
        b.punteggio - a.punteggio ||
        b.importo - a.importo ||
        b.vendite - a.vendite ||
        a.nomeAddetto.localeCompare(b.nomeAddetto, "it"),
    );

  const categorieByPista: Partial<Record<PistaCanvass, PistaCategoriaAggregate[]>> = {};
  for (const [pista, map] of Object.entries(catByPista) as [PistaCanvass, Map<string, number>][]) {
    categorieByPista[pista] = Array.from(map.entries())
      .map(([categoria, pezzi]) => ({ categoria, pezzi }))
      .sort((a, b) => b.pezzi - a.pezzi || a.categoria.localeCompare(b.categoria, "it"));
  }

  const sortCategorie = (map: Map<string, CategoriaReportAggregate>): CategoriaReportAggregate[] =>
    Array.from(map.values()).sort(
      (a, b) => b.importo - a.importo || b.pezzi - a.pezzi || a.categoria.localeCompare(b.categoria, "it"),
    );

  return {
    vendite,
    importo,
    countByType,
    amountByType,
    countByPista,
    amountByPista,
    businessCountByPista,
    energiaByCliente,
    assicurazioniDettaglio: Array.from(assicurazioniMap.values()).sort(
      (a, b) => b.pezzi - a.pezzi || b.importo - a.importo || a.categoria.localeCompare(b.categoria, "it"),
    ),
    categorieByPista,
    prodottiByCategoria: sortCategorie(catByType.prodotti),
    serviziByCategoria: sortCategorie(catByType.servizi),
    perPdv,
    perAddetto,
  };
}

// ---------------------------------------------------------------------------
// Trend giornaliero (Task #250): serie per-giorno usata dal report HTML per
// grafici di andamento, sparkline per pista e confronti oggi/ieri/media.
// ---------------------------------------------------------------------------

/** Riga vendita con la data: serve solo al bucketing per giorno. */
export interface VenditaTrendRow extends VenditaReportRow {
  dataVendita?: Date | string | null;
}

export interface TrendDay {
  /** Giorno YYYY-MM-DD (data italiana della vendita). */
  ymd: string;
  vendite: number;
  importo: number;
  countByPista: Partial<Record<PistaCanvass, number>>;
}

/**
 * Estrae il giorno YYYY-MM-DD da `dataVendita`. La colonna è un timestamp
 * senza timezone che contiene già il wall time italiano: per i Date usiamo
 * i getter locali (pg li parse-a come ora locale), per le stringhe il
 * prefisso YYYY-MM-DD. Valore assente o non riconoscibile ⇒ null.
 */
export function trendYmdOf(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const mm = String(v.getMonth() + 1).padStart(2, "0");
    const dd = String(v.getDate()).padStart(2, "0");
    return `${v.getFullYear()}-${mm}-${dd}`;
  }
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v).trim());
  return m ? m[1] : null;
}

/** Somma `days` giorni (anche negativi) a un YYYY-MM-DD, in aritmetica UTC. */
export function addYmdDays(ymd: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days));
  return d.toISOString().slice(0, 10);
}

/**
 * Costruisce la serie per-giorno nell'intervallo [fromYMD..toYMD] (estremi
 * inclusi, giorni mancanti riempiti a zero, ordine crescente). Le vendite
 * ANNULLATA e le righe senza data riconoscibile o fuori intervallo sono
 * escluse. Intervallo non valido o rovesciato ⇒ [].
 */
export function buildDailyTrend(rows: VenditaTrendRow[], fromYMD: string, toYMD: string): TrendDay[] {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(fromYMD.trim()) || !re.test(toYMD.trim()) || fromYMD > toYMD) return [];

  const byDay = new Map<string, TrendDay>();
  for (let ymd = fromYMD; ymd <= toYMD; ymd = addYmdDays(ymd, 1)) {
    byDay.set(ymd, { ymd, vendite: 0, importo: 0, countByPista: {} });
  }

  for (const row of rows) {
    if (isAnnullata(row.stato)) continue;
    const ymd = trendYmdOf(row.dataVendita);
    if (!ymd) continue;
    const day = byDay.get(ymd);
    if (!day) continue;
    day.vendite++;
    day.importo += parseTotale(row.totale);
    const sc = classifySaleArticles(row.rawData);
    for (const [pista, count] of Object.entries(sc.countByPista) as [PistaCanvass, number][]) {
      day.countByPista[pista] = (day.countByPista[pista] ?? 0) + count;
    }
  }

  return Array.from(byDay.values());
}

/** Primo giorno del mese di un YYYY-MM-DD (es. "2026-07-15" ⇒ "2026-07-01"). */
export function monthStartYmd(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(ymd.trim());
  return m ? `${m[1]}-${m[2]}-01` : ymd;
}

/** Etichetta italiana del mese di un YYYY-MM-DD (es. "luglio 2026"). */
export function monthLabelOf(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(ymd.trim());
  if (!m) return ymd;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, 1));
  return d.toLocaleDateString("it-IT", { month: "long", year: "numeric", timeZone: "UTC" });
}

export interface DayHistoryEntry {
  ymd: string;
  aggregates: DailyReportAggregates;
}

/**
 * Storico per-giorno con aggregati COMPLETI (stessa shape del report
 * giornaliero) nell'intervallo [fromYMD..toYMD]: estremi inclusi, giorni
 * senza vendite presenti con aggregati a zero, ordine crescente. Serve
 * alle pagine navigabili dell'allegato HTML. Intervallo non valido o
 * rovesciato ⇒ [].
 */
export function buildDailyHistory(
  rows: VenditaTrendRow[],
  fromYMD: string,
  toYMD: string,
): DayHistoryEntry[] {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(fromYMD.trim()) || !re.test(toYMD.trim()) || fromYMD > toYMD) return [];

  const byDay = new Map<string, VenditaTrendRow[]>();
  for (let ymd = fromYMD; ymd <= toYMD; ymd = addYmdDays(ymd, 1)) {
    byDay.set(ymd, []);
  }
  for (const row of rows) {
    const ymd = trendYmdOf(row.dataVendita);
    if (!ymd) continue;
    byDay.get(ymd)?.push(row);
  }
  return Array.from(byDay.entries()).map(([ymd, dayRows]) => ({
    ymd,
    aggregates: aggregateDailyReport(dayRows),
  }));
}

/**
 * Variazione percentuale arrotondata di `current` rispetto a `previous`.
 * `previous` non positivo o non finito ⇒ null (delta non calcolabile).
 */
export function pctDelta(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous <= 0 || !Number.isFinite(current)) return null;
  return Math.round(((current - previous) / previous) * 100);
}

// ---------------------------------------------------------------------------
// Proiezione a fine mese: stima di ogni KPI a fine mese in base ai giorni
// lavorativi trascorsi, riusando il calendario giorni-lavorativi
// dell'Incentivazione (festività nazionali IT + Lunedì dell'Angelo).
// ---------------------------------------------------------------------------

/** Categoria BiSuite dei telefoni (prodotti) usata per la proiezione. */
const TELEFONI_CATEGORIA = "TELEFONIA";

/** Pezzi Telefoni (categoria TELEFONIA) dagli aggregati prodotti. */
export function telefoniPezziOf(a: DailyReportAggregates): number {
  const t = a.prodottiByCategoria.find((c) => c.categoria.trim().toUpperCase() === TELEFONI_CATEGORIA);
  return t?.pezzi ?? 0;
}

/** Pezzi Business (P.IVA) di una pista dagli aggregati. */
export function businessPezziOf(a: DailyReportAggregates, pista: PistaCanvass): number {
  return a.businessCountByPista[pista] ?? 0;
}

/** Fatturato Accessori (categoria ACCESSORI) dagli aggregati prodotti. */
export function accessoriImportoOf(a: DailyReportAggregates): number {
  const x = a.prodottiByCategoria.find((c) => c.categoria.trim().toUpperCase() === "ACCESSORI");
  return x?.importo ?? 0;
}

// ---------------------------------------------------------------------------
// Punteggio performance (Task #282): "il migliore" e le classifiche
// addetti/negozi non si misurano più sul fatturato ma su un punteggio pesato
// per pista. Ogni attivazione vale i punti della sua pista; le attivazioni a
// clienti P.IVA (Business) valgono il doppio. I telefoni contano a pezzo
// (flat, nessun raddoppio: sono un prodotto, non un'attivazione). Fatturato
// accessori/servizi resta FUORI dal punteggio (menzione a parte).
// ---------------------------------------------------------------------------

/** Punti per attivazione di ciascuna pista (parte CF; la P.IVA raddoppia). */
export const PERFORMANCE_WEIGHTS: Record<PistaCanvass, number> = {
  mobile: 1,
  fisso: 3,
  energia: 2,
  assicurazioni: 2,
  protecta: 10,
  cb: 0.5,
  // Pista P.IVA del canvass VF (Task #317): usata solo dalla pagina Vendite
  // BiSuite; il report Telegram resta WindTre-only, peso allineato al mobile.
  iva: 1,
};

/** Punti per ogni telefono venduto (categoria TELEFONIA), valore flat. */
export const TELEFONI_WEIGHT = 1;

/** Le attivazioni a cliente P.IVA (Business) valgono il doppio del CF. */
export const IVA_PIVA_MULTIPLIER = 2;

/**
 * Pesi del punteggio performance configurabili per organizzazione (Task #283):
 * i punti per pista, i punti per telefono e il moltiplicatore P.IVA non sono
 * più costanti hardcoded ma leggibili da gara_config (per-org/per-mese) con
 * fallback ai default di sistema. Consente al direttore di valorizzare
 * diversamente le piste senza modifiche al codice.
 */
export interface PerformanceWeightsConfig {
  /** Punti per attivazione di ciascuna pista (parte CF). */
  pesi: Record<PistaCanvass, number>;
  /** Punti per ogni telefono venduto (categoria TELEFONIA), flat. */
  telefoni: number;
  /** Moltiplicatore delle attivazioni a cliente P.IVA (Business). */
  ivaMultiplier: number;
}

/** Config di default (costanti di sistema), usata come fallback. */
export const DEFAULT_PERFORMANCE_WEIGHTS: PerformanceWeightsConfig = {
  pesi: { ...PERFORMANCE_WEIGHTS },
  telefoni: TELEFONI_WEIGHT,
  ivaMultiplier: IVA_PIVA_MULTIPLIER,
};

/**
 * Normalizza il blocco pesi salvato in config (i campi possono arrivare come
 * stringhe dal form). Ogni campo non numerico o non valido ricade sul default
 * di sistema (fallback per-campo): i pesi pista e i punti telefono accettano
 * valori >= 0; il moltiplicatore P.IVA accetta valori >= 1 (un moltiplicatore
 * < 1 renderebbe la P.IVA meno di un CF, contro la semantica).
 */
export function parsePerformanceWeights(raw: unknown): PerformanceWeightsConfig {
  const o = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown, min: number, fallback: number): number => {
    if (v === null || v === undefined || v === "") return fallback;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
    return Number.isFinite(n) && n >= min ? n : fallback;
  };
  const pesi = {} as Record<PistaCanvass, number>;
  for (const pista of Object.keys(PERFORMANCE_WEIGHTS) as PistaCanvass[]) {
    pesi[pista] = num(o[pista], 0, PERFORMANCE_WEIGHTS[pista]);
  }
  return {
    pesi,
    telefoni: num(o.telefoni, 0, TELEFONI_WEIGHT),
    ivaMultiplier: num(o.ivaMultiplier, 1, IVA_PIVA_MULTIPLIER),
  };
}

/**
 * Punteggio performance di un drill-down (addetto o negozio): somma pesata
 * delle attivazioni per pista con raddoppio della quota P.IVA, più i
 * telefoni a pezzo. Non include il fatturato accessori/servizi. I pesi sono
 * configurabili (Task #283); assenti ⇒ default di sistema.
 */
export function performanceScore(
  d: ReportDrilldown,
  weights: PerformanceWeightsConfig = DEFAULT_PERFORMANCE_WEIGHTS,
): number {
  let score = 0;
  for (const pista of Object.keys(weights.pesi) as PistaCanvass[]) {
    const w = weights.pesi[pista];
    const totale = d.countByPista[pista] ?? 0;
    const business = Math.min(d.businessCountByPista[pista] ?? 0, totale);
    const cf = totale - business;
    score += cf * w + business * w * weights.ivaMultiplier;
  }
  const telefoni = d.prodottiByCategoria.find(
    (c) => c.categoria.trim().toUpperCase() === TELEFONI_CATEGORIA,
  );
  score += (telefoni?.pezzi ?? 0) * weights.telefoni;
  return score;
}

/** Formatta un punteggio performance in stile it-IT (max 1 decimale). */
export function fmtPunti(v: number): string {
  const r = Math.round(v * 10) / 10;
  const s = Number.isInteger(r) ? String(r) : r.toFixed(1).replace(".", ",");
  return `${s} ${r === 1 ? "punto" : "punti"}`;
}

/** Nome mostrato di un negozio: ragione sociale se presente, altrimenti codice. */
function pdvNome(p: PdvReportAggregate): string {
  return (p.nomeNegozio ?? "").trim() || p.codicePos;
}

/** Vincitore di una classifica con il valore associato. */
export interface DrilldownWinner {
  nome: string;
  valore: number;
}

/**
 * Miglior addetto e miglior negozio per PUNTEGGIO performance (Task #282).
 * `perAddetto`/`perPdv` sono già ordinati per punteggio↓: si prende il primo
 * con punteggio>0 e nome valido (esclude "N/D").
 */
export function topPerformer(a: DailyReportAggregates): {
  addetto: DrilldownWinner | null;
  negozio: DrilldownWinner | null;
} {
  const add = a.perAddetto.find((x) => x.nomeAddetto !== "N/D" && x.punteggio > 0);
  const pdv = a.perPdv.find((x) => pdvNome(x) !== "N/D" && x.punteggio > 0);
  return {
    addetto: add ? { nome: add.nomeAddetto, valore: add.punteggio } : null,
    negozio: pdv ? { nome: pdvNome(pdv), valore: pdv.punteggio } : null,
  };
}

/** Vincitore di una classifica col suo drill-down (per descrivere i pezzi). */
export interface DrilldownWinnerDetail {
  nome: string;
  dettaglio: ReportDrilldown;
}

/**
 * Come `topPerformer` ma restituisce anche il drill-down del vincitore, così
 * il commento può citare i pezzi effettivi (canvass + telefoni) invece del
 * punteggio. Stesso criterio: primo per punteggio↓, escluso "N/D".
 */
export function topPerformerDetail(a: DailyReportAggregates): {
  addetto: DrilldownWinnerDetail | null;
  negozio: DrilldownWinnerDetail | null;
} {
  const add = a.perAddetto.find((x) => x.nomeAddetto !== "N/D" && x.punteggio > 0);
  const pdv = a.perPdv.find((x) => pdvNome(x) !== "N/D" && x.punteggio > 0);
  return {
    addetto: add ? { nome: add.nomeAddetto, dettaglio: add.dettaglio } : null,
    negozio: pdv ? { nome: pdvNome(pdv), dettaglio: pdv.dettaglio } : null,
  };
}

/** Pezzi canvass totali (tutte le piste) di un drill-down. */
export function canvassPezziOf(d: ReportDrilldown): number {
  return Object.values(d.countByPista).reduce<number>((s, n) => s + (n ?? 0), 0);
}

/** Pezzi telefoni (categoria TELEFONIA) di un drill-down. */
export function telefoniPezziDrill(d: ReportDrilldown): number {
  const t = d.prodottiByCategoria.find(
    (c) => c.categoria.trim().toUpperCase() === TELEFONI_CATEGORIA,
  );
  return t?.pezzi ?? 0;
}

/**
 * Miglior venditore di WindTre Protetti (pista `protecta`) per pezzi, tra
 * addetti e negozi (Task #282): usato per le congratulazioni sempre citate.
 * Restituisce null se nessuno ha venduto Protetti.
 */
export function bestProtettiSeller(a: DailyReportAggregates): {
  addetto: DrilldownWinner | null;
  negozio: DrilldownWinner | null;
} {
  const bestBy = <T,>(
    items: T[],
    getNome: (x: T) => string,
    getDrill: (x: T) => ReportDrilldown,
  ): DrilldownWinner | null => {
    let win: DrilldownWinner | null = null;
    for (const it of items) {
      const nome = getNome(it);
      if (!nome || nome === "N/D") continue;
      const v = getDrill(it).countByPista.protecta ?? 0;
      if (v > 0 && (win === null || v > win.valore)) win = { nome, valore: v };
    }
    return win;
  };
  return {
    addetto: bestBy(a.perAddetto, (x) => x.nomeAddetto, (x) => x.dettaglio),
    negozio: bestBy(a.perPdv, (x) => pdvNome(x), (x) => x.dettaglio),
  };
}

// ---------------------------------------------------------------------------
// Migliori per KPI: miglior addetto e miglior negozio per ciascun KPI
// commerciale (TELCO, New Core, Telefoni, Accessori, Servizi), calcolati
// dai drill-down per-addetto/per-PDV già presenti negli aggregati. Usato
// dal report HTML (pagina giorno e "Totale mese", maturato senza
// proiezione) e dal commento discorsivo.
// ---------------------------------------------------------------------------

export type TopKpiKey = "telco" | "newcore" | "telefoni" | "accessori" | "servizi";

export interface TopKpiWinner {
  /** Nominativo addetto o nome negozio (fallback codice POS). */
  nome: string;
  /** Valore del KPI (pezzi o €, secondo `unit` della voce). */
  valore: number;
}

export interface TopKpiEntry {
  key: TopKpiKey;
  label: string;
  unit: "pz" | "€";
  /** Miglior addetto (escluso "N/D"); null se nessuno sopra zero. */
  addetto: TopKpiWinner | null;
  /** Miglior negozio; null se nessuno sopra zero. */
  negozio: TopKpiWinner | null;
}

/** Valore di un KPI dal drill-down di un addetto/negozio. */
function drilldownKpiValue(d: ReportDrilldown, key: TopKpiKey): number {
  switch (key) {
    case "telco":
      return (d.countByPista.fisso ?? 0) + (d.countByPista.mobile ?? 0);
    case "newcore":
      return (d.countByPista.assicurazioni ?? 0) + (d.countByPista.energia ?? 0);
    case "telefoni":
      return (
        d.prodottiByCategoria.find((c) => c.categoria.trim().toUpperCase() === TELEFONI_CATEGORIA)
          ?.pezzi ?? 0
      );
    case "accessori":
      return (
        d.prodottiByCategoria.find((c) => c.categoria.trim().toUpperCase() === "ACCESSORI")
          ?.importo ?? 0
      );
    case "servizi":
      return d.serviziByCategoria.reduce((s, c) => s + c.importo, 0);
  }
}

const TOP_KPI_DEFS: ReadonlyArray<{ key: TopKpiKey; label: string; unit: "pz" | "€" }> = [
  { key: "telco", label: "TELCO", unit: "pz" },
  { key: "newcore", label: "New Core", unit: "pz" },
  { key: "telefoni", label: "Telefoni", unit: "pz" },
  { key: "accessori", label: "Accessori", unit: "€" },
  { key: "servizi", label: "Servizi", unit: "€" },
];

/**
 * Migliori per KPI dagli aggregati di un periodo (giorno o mese-a-oggi):
 * per ogni KPI il miglior addetto (escluso "N/D") e il miglior negozio.
 * Pareggi deterministici: a parità di valore vince chi viene prima
 * nell'ordinamento esistente per importo totale decrescente (strettamente
 * maggiore per superare). KPI a zero per tutti (né addetto né negozio) ⇒
 * la voce non compare nel risultato.
 */
export function buildTopPerKpi(a: DailyReportAggregates): TopKpiEntry[] {
  const best = <T,>(
    items: T[],
    getDrill: (x: T) => ReportDrilldown,
    getNome: (x: T) => string,
    key: TopKpiKey,
  ): TopKpiWinner | null => {
    let win: TopKpiWinner | null = null;
    for (const it of items) {
      const nome = getNome(it);
      if (!nome || nome === "N/D") continue;
      const valore = drilldownKpiValue(getDrill(it), key);
      if (valore > 0 && (win === null || valore > win.valore)) win = { nome, valore };
    }
    return win;
  };
  const out: TopKpiEntry[] = [];
  for (const def of TOP_KPI_DEFS) {
    const addetto = best(a.perAddetto, (x) => x.dettaglio, (x) => x.nomeAddetto, def.key);
    const negozio = best(a.perPdv, (x) => x.dettaglio, (x) => x.nomeNegozio || x.codicePos, def.key);
    if (addetto || negozio) out.push({ ...def, addetto, negozio });
  }
  return out;
}

/**
 * Giorni lavorativi del mese di `ymd` per tipo negozio, trascorsi (fino a
 * `ymd` incluso) e totali:
 * - `cc` (Corner/CC): tutti i giorni tranne le festività nazionali (incluse
 *   le domeniche);
 * - `strada`: tutti i giorni tranne domeniche e festività nazionali.
 * Input non valido ⇒ null.
 */
export function monthWorkingDaysByType(
  ymd: string,
): { cc: { elapsed: number; total: number }; strada: { elapsed: number; total: number } } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const year = +m[1];
  const month1 = +m[2];
  const day = +m[3];
  const monthIdx = month1 - 1;
  const holidays = new Set(italianHolidays(year));
  const lastDay = new Date(year, month1, 0).getDate();
  const iso = (d: number) =>
    `${year}-${String(month1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const cc = { elapsed: 0, total: 0 };
  const strada = { elapsed: 0, total: 0 };
  for (let d = 1; d <= lastDay; d++) {
    if (holidays.has(iso(d))) continue;
    const dow = new Date(year, monthIdx, d).getDay();
    const elapsed = d <= day;
    // CC: tutti i giorni feriali+festivi tranne le festività (domenica inclusa).
    cc.total++;
    if (elapsed) cc.elapsed++;
    // Strada: escludiamo anche la domenica (dow === 0).
    if (dow !== 0) {
      strada.total++;
      if (elapsed) strada.elapsed++;
    }
  }
  return { cc, strada };
}

/**
 * Giorni lavorativi del mese di `ymd`: trascorsi (fino a `ymd` incluso) e
 * totali. Esclude weekend e festività nazionali italiane. Input non
 * valido ⇒ null.
 */
export function monthWorkingDays(ymd: string): { elapsed: number; total: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const year = +m[1];
  const month1 = +m[2];
  const day = +m[3];
  // Mezzogiorno per evitare ambiguità di fuso nel confronto interno del
  // calendario; `day` cade sempre dentro il mese selezionato.
  const now = new Date(year, month1 - 1, day, 12, 0, 0);
  const cal = buildCalendar(year, month1, italianHolidays(year), now);
  return { elapsed: cal.el, total: cal.tot };
}

/** Conteggio negozi per tipo, usato per pesare i calendari CC/strada. */
export interface StoreTypeCounts {
  numeroNegoziCc: number | null;
  numeroNegoziStrada: number | null;
}

/**
 * Giorni lavorativi del mese di `ymd` (trascorsi/totali) da usare per passo
 * e proiezioni, tenendo conto della divisione CC/strada:
 * - se sono configurati i conteggi negozi CC/strada, si mediano i due
 *   calendari pesati sul numero di negozi (CC lavora anche la domenica,
 *   strada no) → proiezione "reale" dei negozi;
 * - altrimenti si ricade sui soli **giorni feriali** (calendario strada:
 *   lunedì–sabato, esclude domeniche e festività nazionali).
 * Data non valida ⇒ null.
 */
export function blendedWorkingDays(
  ymd: string,
  counts?: StoreTypeCounts,
): { elapsed: number; total: number } | null {
  const wdt = monthWorkingDaysByType(ymd);
  if (!wdt) return null;
  const nCc = counts?.numeroNegoziCc ?? 0;
  const nStrada = counts?.numeroNegoziStrada ?? 0;
  const nTot = nCc + nStrada;
  if (nTot > 0) {
    return {
      total: (nCc * wdt.cc.total + nStrada * wdt.strada.total) / nTot,
      elapsed: (nCc * wdt.cc.elapsed + nStrada * wdt.strada.elapsed) / nTot,
    };
  }
  // Fallback: soli giorni feriali (lun–sab), come il calendario "strada".
  const total = wdt.strada.total;
  return { total, elapsed: total > 0 ? Math.min(wdt.strada.elapsed, total) : wdt.strada.elapsed };
}

/**
 * Proietta un valore maturato a fine mese in proporzione ai giorni
 * lavorativi. Giorni trascorsi o totali non positivi ⇒ null (non
 * calcolabile: mese non ancora iniziato o dato mancante).
 */
export function projectMonthEnd(value: number, elapsedWorkingDays: number, totalWorkingDays: number): number | null {
  if (elapsedWorkingDays <= 0 || totalWorkingDays <= 0) return null;
  return (value / elapsedWorkingDays) * totalWorkingDays;
}

/** Unità di misura di un KPI di proiezione. */
export type ProjectionUnit = "pz" | "€";

/**
 * Voce di proiezione di un singolo KPI: chiave stabile, etichetta, unità,
 * valore maturato nel mese e stima a fine mese (arrotondata).
 */
export interface ProjectionEntry {
  key: string;
  label: string;
  unit: ProjectionUnit;
  maturato: number;
  proiezione: number | null;
}

export interface MonthEndProjection {
  /** Etichetta italiana del mese (es. "luglio 2026"). */
  label: string;
  elapsedWorkingDays: number;
  totalWorkingDays: number;
  /**
   * Proiezione a fine mese per OGNI KPI: volumi per pista (Mobile, di cui
   * P.IVA, Fisso, di cui P.IVA, Energia, Assicurazioni, Protetti, Cb),
   * Telefoni (pezzi), Accessori e Servizi (fatturato €).
   */
  kpis: ProjectionEntry[];
}

/**
 * Costruisce la proiezione a fine mese di TUTTI i KPI (uno per riga, stessa
 * granularità del forecast/obiettivi) a partire dagli aggregati del mese in
 * corso e dalla data del report. Data non valida ⇒ null.
 */
export function buildMonthEndProjection(
  ymd: string,
  monthAgg: DailyReportAggregates,
  storeCounts?: StoreTypeCounts,
): MonthEndProjection | null {
  const wd = blendedWorkingDays(ymd, storeCounts);
  if (!wd) return null;
  const round = (v: number | null): number | null => (v === null ? null : Math.round(v));
  const mk = (key: string, label: string, unit: ProjectionUnit, maturato: number): ProjectionEntry => ({
    key,
    label,
    unit,
    maturato,
    proiezione: round(projectMonthEnd(maturato, wd.elapsed, wd.total)),
  });
  const kpis: ProjectionEntry[] = [
    mk("mobile", "Mobile", "pz", monthAgg.countByPista.mobile ?? 0),
    mk("mobileIva", "Mobile P.IVA", "pz", businessPezziOf(monthAgg, "mobile")),
    mk("fisso", "Fisso", "pz", monthAgg.countByPista.fisso ?? 0),
    mk("fissoIva", "Fisso P.IVA", "pz", businessPezziOf(monthAgg, "fisso")),
    mk("energia", "Energia", "pz", monthAgg.countByPista.energia ?? 0),
    mk("assicurazioni", "Assicurazioni", "pz", monthAgg.countByPista.assicurazioni ?? 0),
    mk("protetti", "Protetti", "pz", monthAgg.countByPista.protecta ?? 0),
    mk("cb", "Cb", "pz", monthAgg.countByPista.cb ?? 0),
    mk("telefoni", "Telefoni", "pz", telefoniPezziOf(monthAgg)),
    mk("accessori", "Accessori", "€", accessoriImportoOf(monthAgg)),
    mk("servizi", "Servizi", "€", monthAgg.amountByType.servizi),
  ];
  return {
    label: monthLabelOf(ymd),
    elapsedWorkingDays: wd.elapsed,
    totalWorkingDays: wd.total,
    kpis,
  };
}

// Ordine fisso delle piste nel messaggio (stesso ordine della UI).
export const REPORT_PISTA_ORDER: PistaCanvass[] = [
  "mobile",
  "fisso",
  "cb",
  "assicurazioni",
  "protecta",
  "energia",
];

export const REPORT_TYPE_ORDER: ArticleType[] = ["canvass", "prodotti", "servizi"];

/** Formatta un importo in euro stile it-IT (1.234,56 €), stabile cross-locale. */
export function fmtEuro(v: number): string {
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  const [intPart, decPart] = abs.toFixed(2).split(".");
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${withThousands},${decPart} €`;
}

function escapeTelegramHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Formatta una data YYYY-MM-DD come DD/MM/YYYY per l'intestazione.
 * Input non valido → restituito com'è (già escapato a valle).
 */
export function fmtReportDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// ---------------------------------------------------------------------------
// Commento "da direttore vendite" (Task #266): il messaggio di testo Telegram
// non è più un elenco di vendite ma un commento discorsivo che confronta
// l'andamento con un forecast mensile configurabile per organizzazione. Tutti
// i numeri di dettaglio restano nell'allegato HTML. Nessuna AI: frasi
// predefinite a fasce, selezionate in modo deterministico dalla data così da
// variare giorno per giorno restando testabili.
// ---------------------------------------------------------------------------


export interface TelegramReportParams {
  orgName: string;
  /** Data italiana del report in formato YYYY-MM-DD. */
  dateYMD: string;
  /** Etichetta oraria (es. "13:30") mostrata nell'intestazione. */
  timeLabel?: string;
  /** Aggregati del giorno (parziale o pieno). */
  aggregates: DailyReportAggregates;
  /**
   * Aggregati mese-a-oggi per passo e proiezioni del commento. Assente ⇒
   * si usa il giorno come fallback (proiezioni poco significative).
   */
  monthAggregates?: DailyReportAggregates;
  /** Forecast mensile configurato. Assente ⇒ commento senza valutazione. */
  forecast?: ForecastConfig;
  /** Fascia esplicita; se assente derivata da `timeLabel`. */
  fascia?: Fascia;
}

/**
 * Costruisce il messaggio Telegram (parse_mode HTML): intestazione (data,
 * org, fascia) + commento discorsivo in stile "direttore vendite"
 * (`buildDirettoreCommento`). Il dettaglio completo delle vendite resta
 * nell'allegato HTML, non più nel testo. Le vendite ANNULLATA sono già
 * escluse dagli aggregati.
 */
export function buildTelegramReportMessage(p: TelegramReportParams): string {
  const a = p.aggregates;
  const fascia = p.fascia ?? fasciaFromTimeLabel(p.timeLabel);
  const lines: string[] = [];
  const header = `📊 <b>Report vendite ${escapeTelegramHtml(fmtReportDate(p.dateYMD))}</b>` +
    (p.timeLabel ? ` — ${escapeTelegramHtml(p.timeLabel)}` : "");
  lines.push(header);
  lines.push(`🏢 ${escapeTelegramHtml(p.orgName)}`);
  lines.push("");

  const forecast = p.forecast ?? EMPTY_FORECAST;
  const month = p.monthAggregates ?? a;
  // Giorni lavorativi (passo/proiezioni): calcolati in automatico per il mese
  // in corso, mediati sul numero di negozi CC/strada configurato (i due tipi
  // hanno calendari diversi: CC include le domeniche, strada no). Senza
  // conteggi negozi si ricade sui soli giorni feriali (lun–sab). Stessa
  // logica della card "Proiezione fine mese" per coerenza tra testo e HTML.
  const wd = blendedWorkingDays(p.dateYMD, forecast);
  const total = wd?.total ?? 0;
  const elapsed = wd?.elapsed ?? 0;

  lines.push(
    buildDirettoreCommento({
      fascia,
      dateYMD: p.dateYMD,
      forecast,
      today: a,
      month,
      elapsedWorkingDays: elapsed,
      totalWorkingDays: total,
    }),
  );

  return lines.join("\n");
}
