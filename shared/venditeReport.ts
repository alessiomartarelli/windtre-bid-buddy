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
  /** Drill-down del negozio (Task #251). */
  dettaglio: ReportDrilldown;
}

export interface AddettoReportAggregate {
  /** Grafia visualizzata (prima occorrenza incontrata). */
  nomeAddetto: string;
  vendite: number;
  importo: number;
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
export function aggregateDailyReport(rows: VenditaReportRow[]): DailyReportAggregates {
  const countByType: Record<ArticleType, number> = { canvass: 0, prodotti: 0, servizi: 0 };
  const amountByType: Record<ArticleType, number> = { canvass: 0, prodotti: 0, servizi: 0 };
  const countByPista: Partial<Record<PistaCanvass, number>> = {};
  const amountByPista: Partial<Record<PistaCanvass, number>> = {};
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
    prodotti: Map<string, CategoriaImportoAggregate>;
    servizi: Map<string, CategoriaImportoAggregate>;
  }
  const newDrillAcc = (): DrillAcc => ({ countByPista: {}, prodotti: new Map(), servizi: new Map() });
  const pdvMap = new Map<string, Omit<PdvReportAggregate, "dettaglio">>();
  const addettoMap = new Map<string, Omit<AddettoReportAggregate, "dettaglio">>();
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
    for (const t of Object.keys(sc.countByType) as ArticleType[]) {
      countByType[t] += sc.countByType[t];
      amountByType[t] += sc.amountByType[t];
    }
    for (const [pista, count] of Object.entries(sc.countByPista) as [PistaCanvass, number][]) {
      countByPista[pista] = (countByPista[pista] ?? 0) + count;
      amountByPista[pista] = (amountByPista[pista] ?? 0) + (sc.amountByPista[pista] ?? 0);
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
    prodottiByCategoria: acc ? sortDrillCategorie(acc.prodotti) : [],
    serviziByCategoria: acc ? sortDrillCategorie(acc.servizi) : [],
  });

  const perPdv: PdvReportAggregate[] = Array.from(pdvMap.entries())
    .map(([k, p]) => ({ ...p, dettaglio: finalizeDrill(pdvDrill.get(k)) }))
    .sort(
      (a, b) => b.importo - a.importo || b.vendite - a.vendite || a.codicePos.localeCompare(b.codicePos, "it"),
    );
  const perAddetto: AddettoReportAggregate[] = Array.from(addettoMap.entries())
    .map(([k, p]) => ({ ...p, dettaglio: finalizeDrill(addettoDrill.get(k)) }))
    .sort(
      (a, b) => b.importo - a.importo || b.vendite - a.vendite || a.nomeAddetto.localeCompare(b.nomeAddetto, "it"),
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
// Proiezione a fine mese (Task #263): stima dei pezzi a fine mese in base
// ai giorni lavorativi trascorsi, riusando il calendario giorni-lavorativi
// dell'Incentivazione (festività nazionali IT + Lunedì dell'Angelo).
// ---------------------------------------------------------------------------

/** Categoria BiSuite dei telefoni (prodotti) usata per la proiezione. */
const TELEFONI_CATEGORIA = "TELEFONIA";

/** Pezzi Telefoni (categoria TELEFONIA) dagli aggregati prodotti. */
export function telefoniPezziOf(a: DailyReportAggregates): number {
  const t = a.prodottiByCategoria.find((c) => c.categoria.trim().toUpperCase() === TELEFONI_CATEGORIA);
  return t?.pezzi ?? 0;
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

/**
 * Proietta un valore maturato a fine mese in proporzione ai giorni
 * lavorativi. Giorni trascorsi o totali non positivi ⇒ null (non
 * calcolabile: mese non ancora iniziato o dato mancante).
 */
export function projectMonthEnd(value: number, elapsedWorkingDays: number, totalWorkingDays: number): number | null {
  if (elapsedWorkingDays <= 0 || totalWorkingDays <= 0) return null;
  return (value / elapsedWorkingDays) * totalWorkingDays;
}

/** Voce di proiezione: valore maturato e stima a fine mese (arrotondata). */
export interface ProjectionEntry {
  maturato: number;
  proiezione: number | null;
}

export interface MonthEndProjection {
  /** Etichetta italiana del mese (es. "luglio 2026"). */
  label: string;
  elapsedWorkingDays: number;
  totalWorkingDays: number;
  /** Pezzi Canvass totali (tutte le piste). */
  canvass: ProjectionEntry;
  /** Pezzi Telefoni (categoria TELEFONIA). */
  telefoni: ProjectionEntry;
}

/**
 * Costruisce la proiezione a fine mese dei pezzi Canvass totali e dei
 * Telefoni a partire dagli aggregati del mese in corso e dalla data del
 * report. Data non valida ⇒ null.
 */
export function buildMonthEndProjection(ymd: string, monthAgg: DailyReportAggregates): MonthEndProjection | null {
  const wd = monthWorkingDays(ymd);
  if (!wd) return null;
  const canvass = monthAgg.countByType.canvass;
  const telefoni = telefoniPezziOf(monthAgg);
  const round = (v: number | null): number | null => (v === null ? null : Math.round(v));
  return {
    label: monthLabelOf(ymd),
    elapsedWorkingDays: wd.elapsed,
    totalWorkingDays: wd.total,
    canvass: { maturato: canvass, proiezione: round(projectMonthEnd(canvass, wd.elapsed, wd.total)) },
    telefoni: { maturato: telefoni, proiezione: round(projectMonthEnd(telefoni, wd.elapsed, wd.total)) },
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

/** Fascia di invio: parziale (metà giornata) o chiusura (fine giornata). */
export type ReportPhase = "parziale" | "chiusura";

/**
 * Forecast/obiettivi mensili per organizzazione. Tutti opzionali: una
 * dimensione senza forecast semplicemente non viene valutata nel commento.
 */
export interface ForecastConfig {
  /** Pezzi Canvass attesi nel mese. */
  canvassPezzi?: number;
  /** Pezzi Telefoni (categoria TELEFONIA) attesi nel mese. */
  telefoniPezzi?: number;
  /** Fatturato Accessori atteso nel mese (€). */
  accessoriEuro?: number;
  /** Fatturato Servizi atteso nel mese (€). */
  serviziEuro?: number;
  /** Numero di negozi attesi (contesto per gli standout). */
  numeroNegozi?: number;
  /** Giorni lavorativi del mese (override del calendario nazionale). */
  giorniLavorativi?: number;
}

/**
 * Estrae il ForecastConfig dal blocco config `telegramReport` salvato in
 * organization_config.config. Legge i campi numerici (snake_case) ignorando
 * valori non finiti o negativi. Input non oggetto ⇒ forecast vuoto.
 */
export function parseForecastConfig(raw: unknown): ForecastConfig {
  const cfg = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | undefined => {
    const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  return {
    canvassPezzi: num(cfg.forecast_canvass_pezzi),
    telefoniPezzi: num(cfg.forecast_telefoni_pezzi),
    accessoriEuro: num(cfg.forecast_accessori_euro),
    serviziEuro: num(cfg.forecast_servizi_euro),
    numeroNegozi: num(cfg.numero_negozi),
    giorniLavorativi: num(cfg.giorni_lavorativi),
  };
}

/** Fatturato della categoria ACCESSORI dagli aggregati prodotti. */
export function accessoriEuroOf(a: DailyReportAggregates): number {
  const c = a.prodottiByCategoria.find((x) => x.categoria.trim().toUpperCase() === "ACCESSORI");
  return c?.importo ?? 0;
}

/** Deriva la fascia (parziale/chiusura) dall'etichetta oraria dell'invio. */
export function phaseFromTimeLabel(timeLabel?: string): ReportPhase {
  return (timeLabel ?? "").trim() === "13:30" ? "parziale" : "chiusura";
}

/** Giorno dell'anno (0-based) di una data YYYY-MM-DD; input non valido ⇒ 0. */
function dayOfYear(ymd: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return 0;
  const d = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const start = Date.UTC(+m[1], 0, 1);
  return Math.round((d - start) / 86400000);
}

/** Selezione deterministica da un pool in base a un seed (data). */
function pick<T>(pool: T[], seed: number): T {
  if (pool.length === 0) return undefined as unknown as T;
  return pool[((seed % pool.length) + pool.length) % pool.length];
}

export type PerfBand = "molto_sotto" | "sotto" | "in_linea" | "sopra" | "molto_sopra";

function bandFromScore(score: number): PerfBand {
  if (score >= 15) return "molto_sopra";
  if (score >= 5) return "sopra";
  if (score > -5) return "in_linea";
  if (score > -15) return "sotto";
  return "molto_sotto";
}

interface DimEval {
  key: "canvass" | "telefoni" | "accessori" | "servizi";
  label: string;
  unit: "pezzi" | "euro";
  day: number;
  month: number;
  forecast: number;
  /** Passo atteso a oggi (obiettivo giornaliero × giorni trascorsi). */
  expected: number;
  /** Delta % del maturato rispetto al passo atteso. */
  paceDelta: number;
  /** Proiezione a fine mese (lineare sui giorni lavorativi). */
  projection: number | null;
}

function fmtDimValue(v: number, unit: "pezzi" | "euro"): string {
  return unit === "euro" ? fmtEuro(v) : `${Math.round(v)} pz`;
}

function fmtSignedPct(pct: number): string {
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

export interface ReportCommentParams {
  phase: ReportPhase;
  dateYMD: string;
  /** Aggregati del giorno (parziale o pieno). */
  dayAggregates: DailyReportAggregates;
  /** Aggregati mese-a-oggi (fallback: dayAggregates). */
  monthAggregates?: DailyReportAggregates;
  forecast?: ForecastConfig;
  elapsedWorkingDays?: number;
  totalWorkingDays?: number;
}

/**
 * Genera il commento discorsivo (parse_mode HTML) del report Telegram.
 * Deterministico: le frasi variano per data ma sono stabili nei test.
 */
export function buildReportComment(p: ReportCommentParams): string {
  const seed = dayOfYear(p.dateYMD);
  const day = p.dayAggregates;
  const month = p.monthAggregates ?? p.dayAggregates;
  const fc = p.forecast ?? {};
  const totalWD = fc.giorniLavorativi && fc.giorniLavorativi > 0
    ? fc.giorniLavorativi
    : (p.totalWorkingDays ?? 0);
  const elapsedWD = Math.min(Math.max(p.elapsedWorkingDays ?? 0, 0), totalWD > 0 ? totalWD : Number.MAX_SAFE_INTEGER);

  const lines: string[] = [];

  // Giorno senza vendite: commento dedicato "al palo".
  if (day.vendite === 0) {
    const openPool = p.phase === "parziale"
      ? ["☀️ Buongiorno team!", "☀️ Si comincia team!", "☀️ Nuova giornata, squadra!"]
      : ["🌙 Giornata in archivio.", "🌙 Serata, team.", "🌙 Chiudiamo la giornata."]; 
    const emptyPool = p.phase === "parziale"
      ? [
          "A metà giornata non abbiamo ancora messo a segno vendite: c'è tutto il pomeriggio per far girare la macchina. 💪",
          "Per ora la giornata è ferma al palo: rimbocchiamoci le maniche, il bello deve ancora arrivare. 💪",
          "Nessuna vendita finora: teniamo alta l'attenzione, ogni cliente conta da qui a stasera. 💪",
        ]
      : [
          "Giornata senza vendite: capita, resettiamo e ripartiamo con più energia domani. 🙌",
          "Oggi non si è sbloccato nulla: analizziamo cosa non ha funzionato e domani si riparte forte. 🙌",
          "Zero a referto oggi: testa alta, domani è un'altra occasione per rimetterci in corsa. 🙌",
        ];
    lines.push(`${pick(openPool, seed)}`);
    lines.push(pick(emptyPool, seed));
    return lines.join("\n\n");
  }

  // Valutazione delle dimensioni con forecast.
  const rawDims: Array<Omit<DimEval, "expected" | "paceDelta" | "projection">> = [
    { key: "canvass", label: "Canvass", unit: "pezzi", day: day.countByType.canvass, month: month.countByType.canvass, forecast: fc.canvassPezzi ?? 0 },
    { key: "telefoni", label: "Telefoni", unit: "pezzi", day: telefoniPezziOf(day), month: telefoniPezziOf(month), forecast: fc.telefoniPezzi ?? 0 },
    { key: "accessori", label: "Accessori", unit: "euro", day: accessoriEuroOf(day), month: accessoriEuroOf(month), forecast: fc.accessoriEuro ?? 0 },
    { key: "servizi", label: "Servizi", unit: "euro", day: day.amountByType.servizi, month: month.amountByType.servizi, forecast: fc.serviziEuro ?? 0 },
  ];
  const dims: DimEval[] = [];
  for (const d of rawDims) {
    if (d.forecast <= 0 || totalWD <= 0) continue;
    const dailyTarget = d.forecast / totalWD;
    const expected = dailyTarget * elapsedWD;
    const paceDelta = expected > 0 ? Math.round(((d.month - expected) / expected) * 100) : 0;
    const projection = elapsedWD > 0 ? (d.month / elapsedWD) * totalWD : null;
    dims.push({ ...d, expected, paceDelta, projection });
  }

  const hasForecast = dims.length > 0;
  const avgPace = hasForecast
    ? Math.round(dims.reduce((s, d) => s + d.paceDelta, 0) / dims.length)
    : 0;
  const band = bandFromScore(avgPace);

  // 1) Apertura in base a fascia + fascia performance.
  const greetPool: Record<ReportPhase, Record<PerfBand, string[]>> = {
    parziale: {
      molto_sopra: ["☀️ Buongiorno team, che partenza!", "☀️ A metà giornata siamo lanciati!"],
      sopra: ["☀️ Buongiorno team! La macchina gira bene.", "☀️ Buon lavoro squadra, si va spediti."],
      in_linea: ["☀️ Buongiorno team! Andiamo in linea col passo.", "☀️ A metà giornata siamo sul ritmo previsto."],
      sotto: ["☀️ Buongiorno team, serve una spinta.", "☀️ A metà giornata siamo un po' indietro."],
      molto_sotto: ["☀️ Buongiorno team, oggi dobbiamo cambiare marcia.", "☀️ A metà giornata siamo sotto: rimbocchiamoci le maniche."],
    },
    chiusura: {
      molto_sopra: ["🌙 Giornata in archivio, e che giornata!", "🌙 Chiudiamo alla grande, squadra!"],
      sopra: ["🌙 Giornata in archivio, bel ritmo.", "🌙 Chiudiamo in positivo, ottimo lavoro."],
      in_linea: ["🌙 Giornata in archivio, in linea col passo.", "🌙 Chiudiamo sul ritmo previsto."],
      sotto: ["🌙 Giornata in archivio, sotto le attese.", "🌙 Chiudiamo un po' indietro rispetto al passo."],
      molto_sotto: ["🌙 Giornata in archivio, giornata da dimenticare.", "🌙 Chiudiamo sotto tono: domani si reagisce."],
    },
  };
  lines.push(pick(greetPool[p.phase][band], seed));

  // 2) Numeri del giorno.
  const dayLine = `Oggi <b>${day.vendite}</b> vendite per <b>${fmtEuro(day.importo)}</b>.`;
  lines.push(dayLine);

  // 3) Andamento sul mese per dimensione tracciata.
  if (hasForecast) {
    const monthLines: string[] = [];
    for (const d of dims) {
      const proj = d.projection === null ? "—" : fmtDimValue(d.projection, d.unit);
      monthLines.push(
        `• ${d.label}: <b>${fmtDimValue(d.month, d.unit)}</b> sul mese (${fmtSignedPct(d.paceDelta)} sul passo), ` +
          `proiezione <b>${proj}</b> su obiettivo ${fmtDimValue(d.forecast, d.unit)}`,
      );
    }
    lines.push(`Sul mese (${elapsedWD}/${totalWD} giorni lavorativi):\n${monthLines.join("\n")}`);
  }

  // 4) Standout negozio/addetto (sul giorno).
  const standout: string[] = [];
  const topPdv = day.perPdv[0];
  if (topPdv) {
    const nome = topPdv.nomeNegozio || topPdv.codicePos;
    standout.push(`In evidenza <b>${escapeTelegramHtml(nome)}</b> (${topPdv.vendite} vendite, ${fmtEuro(topPdv.importo)})`);
  }
  const topAdd = day.perAddetto[0];
  if (topAdd) {
    standout.push(`bene l'addetto <b>${escapeTelegramHtml(topAdd.nomeAddetto)}</b>`);
  }
  // Negozio sotto tono: se ci sono almeno 3 PDV e l'ultimo è ben sotto la media.
  if (day.perPdv.length >= 3) {
    const avgImporto = day.perPdv.reduce((s, x) => s + x.importo, 0) / day.perPdv.length;
    const last = day.perPdv[day.perPdv.length - 1];
    if (avgImporto > 0 && last.importo < avgImporto * 0.5) {
      const nome = last.nomeNegozio || last.codicePos;
      standout.push(`da rivedere invece <b>${escapeTelegramHtml(nome)}</b>, rimasto indietro`);
    }
  }
  if (standout.length > 0) {
    lines.push(`${standout.join("; ")}.`);
  }

  // 5) Spunto strategico: dimensione più in ritardo e quella in vantaggio.
  if (hasForecast) {
    const sorted = [...dims].sort((a, b) => a.paceDelta - b.paceDelta);
    const laggard = sorted[0];
    const leader = sorted[sorted.length - 1];
    if (laggard.paceDelta < -3) {
      lines.push(`Spunto: spingiamo su <b>${laggard.label}</b>, è la voce più in ritardo sul passo del mese.`);
    } else if (leader.paceDelta > 5) {
      lines.push(`Spunto: consolidiamo il vantaggio su <b>${leader.label}</b> e teniamo il ritmo su tutto il resto.`);
    }
  }

  // 6) Chiusura motivazionale in base a fascia + performance.
  const closePool: Record<ReportPhase, Record<PerfBand, string[]>> = {
    parziale: {
      molto_sopra: ["Teniamo questo passo nel pomeriggio! 🚀", "Continuiamo così, il traguardo è vicino! 🚀"],
      sopra: ["Spingiamo ancora nel pomeriggio! 💪", "Bel ritmo, non molliamo! 💪"],
      in_linea: ["Un ultimo sforzo per chiudere sopra il passo! 💪", "Il pomeriggio può fare la differenza! 💪"],
      sotto: ["Rimettiamoci in corsa nel pomeriggio! 💪", "C'è ancora tutto il pomeriggio per recuperare! 💪"],
      molto_sotto: ["Serve una reazione forte da qui a stasera! 🔥", "Tiriamo fuori l'orgoglio nel pomeriggio! 🔥"],
    },
    chiusura: {
      molto_sopra: ["Portiamo questa energia anche domani! 👏", "Grande squadra, si replica domani! 👏"],
      sopra: ["Bel lavoro, domani si continua così! 👏", "Ottima giornata, avanti così! 👏"],
      in_linea: ["Buon lavoro, domani cerchiamo lo scatto! 🙌", "Giornata solida, domani puntiamo più in alto! 🙌"],
      sotto: ["Domani reagiamo e recuperiamo terreno! 💪", "Testa a domani, possiamo fare di più! 💪"],
      molto_sotto: ["Domani è un'altra storia: reagiamo! 🔥", "Ci rifacciamo domani, forza squadra! 🔥"],
    },
  };
  lines.push(pick(closePool[p.phase][band], seed + 1));

  return lines.join("\n\n");
}

export interface TelegramReportParams {
  orgName: string;
  /** Data italiana del report in formato YYYY-MM-DD. */
  dateYMD: string;
  /** Etichetta oraria (es. "13:30") mostrata nell'intestazione. */
  timeLabel?: string;
  aggregates: DailyReportAggregates;
  /**
   * Proiezione a fine mese (pezzi Canvass totali e Telefoni). Mantenuta per
   * compatibilità/allegato HTML; il commento usa il forecast configurato.
   */
  monthProjection?: MonthEndProjection;
  /** Fascia di invio; se assente viene derivata da timeLabel. */
  phase?: ReportPhase;
  /** Aggregati mese-a-oggi per il confronto col forecast. */
  monthAggregates?: DailyReportAggregates;
  /** Forecast/obiettivi mensili dell'organizzazione. */
  forecast?: ForecastConfig;
  /** Giorni lavorativi trascorsi del mese (dal calendario). */
  elapsedWorkingDays?: number;
  /** Giorni lavorativi totali del mese (dal calendario). */
  totalWorkingDays?: number;
}

/**
 * Costruisce il messaggio Telegram (parse_mode HTML): intestazione + commento
 * discorsivo "da direttore vendite" (Task #266). Il dettaglio numerico delle
 * vendite vive nell'allegato HTML. Le vendite ANNULLATA sono già escluse.
 */
export function buildTelegramReportMessage(p: TelegramReportParams): string {
  const lines: string[] = [];
  const header = `📊 <b>Report vendite ${escapeTelegramHtml(fmtReportDate(p.dateYMD))}</b>` +
    (p.timeLabel ? ` — ${escapeTelegramHtml(p.timeLabel)}` : "");
  lines.push(header);
  lines.push(`🏢 ${escapeTelegramHtml(p.orgName)}`);
  lines.push("");

  // Il corpo è un commento discorsivo "da direttore vendite" (Task #266):
  // niente più elenco di vendite nel testo — il dettaglio completo resta
  // nell'allegato HTML navigabile.
  const comment = buildReportComment({
    phase: p.phase ?? phaseFromTimeLabel(p.timeLabel),
    dateYMD: p.dateYMD,
    dayAggregates: p.aggregates,
    monthAggregates: p.monthAggregates,
    forecast: p.forecast,
    elapsedWorkingDays: p.elapsedWorkingDays,
    totalWorkingDays: p.totalWorkingDays,
  });
  lines.push(comment);

  return lines.join("\n");
}
