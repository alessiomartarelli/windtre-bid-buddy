import type { BiSuiteMappingRule } from "../shared/bisuiteMapping";
import { mapBiSuiteArticle } from "../shared/bisuiteMapping";
import {
  classifyArticle,
  classifyCategory,
  classificationPistaCounts,
  isCouponCaring,
  isPezzoIva,
  type PistaCanvass,
} from "../shared/bisuiteClassification";
import type { CanvassIndex } from "../shared/canvassMapping";
import type { CanvassKpiRule } from "../shared/canvassKpiRules";
import { trendYmdOf } from "../shared/venditeReport";
import {
  resolveSalePdvForView,
  resolveSaleRagioneSocialeForView,
  type PdvView,
  type PdvViewDirectory,
} from "../shared/pdvView";
import { normalizeRsName } from "../shared/ragioneSociale";

// Aggregazione lato server delle vendite BiSuite mappate, estratta dalla route
// GET /api/admin/bisuite-mapped-sales così da essere richiamabile e testabile
// (DB-backed) senza passare dall'HTTP. Opera su righe `bisuite_sales` già
// caricate e sull'insieme di regole EFFETTIVE (default + salvate mergiate via
// `mergeWithDefaultRules`). Non filtra per calendario/data: quel filtro resta
// nella route (inGaraOnly) e produce l'array `sales` passato qui.

export type AggregatedItem = {
  pista: string;
  targetCategory: string;
  targetLabel: string;
  pezzi: number;
  canone: number;
  ruleType: 'base' | 'additional';
  descriptions?: Record<string, number>;
};

export type AddonItem = {
  pista: string;
  targetCategory: string;
  targetLabel: string;
  occorrenze: number;
  canone: number;
};

type DeviceModalitaTally = { pezzi: number; descriptions: Record<string, number> };
export type DeviceTally = {
  smartphone: { finanziato: DeviceModalitaTally; rate: DeviceModalitaTally; altro: DeviceModalitaTally };
  smartDevice: { finanziato: DeviceModalitaTally; rate: DeviceModalitaTally; altro: DeviceModalitaTally };
  internetDevice: { finanziato: DeviceModalitaTally; rate: DeviceModalitaTally; altro: DeviceModalitaTally };
};

export type PdvAggregate = {
  codicePos: string;
  nomeNegozio: string;
  ragioneSociale: string;
  items: AggregatedItem[];
  addons: AddonItem[];
  accessori: { pezzi: number; importo: number };
  servizi: { pezzi: number; importo: number };
  devices: DeviceTally;
  /** Task #392 — pezzi P.IVA (business) sulle piste canvass, via `isPezzoIva`
   * sulla classificazione per categoria (TIED IVA, ADSL/FIBRA/FWA IVA,
   * energia/protetti BUSINESS, ASSICURAZIONI BUSINESS PRO). */
  pezziIva: number;
  /** Task #392 — cambi piano CB: SOLO MIA TIED (no Coupon Caring),
   * MIA UNTIED (no Coupon Caring) e RIVINCOLO. Conteggio per categoria
   * BiSuite dell'articolo, quindi indipendente dai "twin" partnership
   * delle regole di mapping (nessun doppio conteggio). */
  cbCambiPiano: number;
  /** Task #392 — telefoni venduti (articoli categoria TELEFONIA). */
  telefoni: number;
  /** Task #527 — pezzi per pista canvass VF (luce, gas, iva_mobile,
   * iva_wireline, vas, …) via listino canvass + regole KPI. Presente solo
   * quando l'aggregazione riceve un canvassIndex (org con brand VF). */
  countByPistaCanvass?: Partial<Record<PistaCanvass, number>>;
  unmapped: number;
  totalArticoli: number;
};

export type TotaliPerPista = Record<string, Record<string, { targetCategory: string; targetLabel: string; pezzi: number; canone: number; ruleType: string }>>;
export type TotaliAddonsPerPista = Record<string, Record<string, { targetCategory: string; targetLabel: string; occorrenze: number; canone: number }>>;

export type MappedSalesAggregation = {
  byPdv: Record<string, PdvAggregate>;
  pdvList: PdvAggregate[];
  totalMapped: number;
  totalUnmapped: number;
  totalArticoli: number;
  /** Task #422 — fatturato lordo del periodo (somma di `totale` per vendita). */
  totalImporto: number;
  latestSaleDate: Date | null;
  totaliPerPista: TotaliPerPista;
  totaliAddonsPerPista: TotaliAddonsPerPista;
  /** Task #457 — serie giornaliera (YYYY-MM-DD italiano, ordine crescente,
   *  solo i giorni con vendite): conteggio vendite e fatturato lordo. */
  daily: Array<{ day: string; vendite: number; importo: number }>;
  /** Task #462 — vista PDV usata per l'attribuzione (default 'origine'). */
  pdvView: PdvView;
  /** Task #462 — n. vendite senza PDV destinazione (solo vista destinazione;
   *  finiscono nel bucket esplicito SENZA_DESTINAZIONE, mai su altri PDV). */
  salesSenzaDestinazione: number;
  /** Task #527 — totale pezzi per pista canvass VF (solo org con listino). */
  totaliPistaCanvass?: Partial<Record<PistaCanvass, number>>;
};

// Forma minima di una riga bisuite_sales necessaria all'aggregazione.
export type MappableSale = {
  dataVendita?: Date | string | null;
  totale?: string | number | null;
  rawData?: unknown;
  codicePos?: string | null;
  nomeNegozio?: string | null;
  ragioneSociale?: string | null;
};

// Task #478 — perimetro RS/PDV opzionale della route bisuite-mapped-sales.
// Filtra le vendite PRIMA dell'aggregazione così che daily/totalSales/
// totalImporto (non ricostruibili lato client per PDV) riflettano il filtro
// scelto sulla Dashboard Gara Reale. Semantica allineata al memo client:
// una vendita è inclusa se il suo codicePos (risolto secondo la vista PDV
// attiva) è nella lista, OPPURE se la sua ragione sociale (normalizzata)
// combacia con una delle RS richieste. Liste vuote/assenti = nessun filtro.
export type SalesPerimeter = {
  codicePos?: string[];
  ragioniSociali?: string[];
};

export function filterSalesByPerimeter<T extends MappableSale>(
  sales: T[],
  perimeter: SalesPerimeter | undefined,
  pdvView: PdvView,
  pdvDirectory?: PdvViewDirectory,
): T[] {
  const posList = (perimeter?.codicePos ?? []).map((c) => String(c).trim()).filter(Boolean);
  const rsList = (perimeter?.ragioniSociali ?? []).map((r) => normalizeRsName(String(r))).filter(Boolean);
  if (posList.length === 0 && rsList.length === 0) return sales;
  const posSet = new Set(posList);
  const rsSet = new Set(rsList);
  return sales.filter((sale) => {
    let pos = sale.codicePos || "";
    if (pdvView === "destinazione") {
      pos = resolveSalePdvForView(sale, "destinazione").codicePos || "";
    }
    if (pos && posSet.has(pos)) return true;
    if (rsSet.size > 0) {
      const rs = normalizeRsName(resolveSaleRagioneSocialeForView(sale, pdvView, pdvDirectory));
      if (rs && rsSet.has(rs)) return true;
    }
    return false;
  });
}

const newDeviceTally = (): DeviceTally => ({
  smartphone: { finanziato: { pezzi: 0, descriptions: {} }, rate: { pezzi: 0, descriptions: {} }, altro: { pezzi: 0, descriptions: {} } },
  smartDevice: { finanziato: { pezzi: 0, descriptions: {} }, rate: { pezzi: 0, descriptions: {} }, altro: { pezzi: 0, descriptions: {} } },
  internetDevice: { finanziato: { pezzi: 0, descriptions: {} }, rate: { pezzi: 0, descriptions: {} }, altro: { pezzi: 0, descriptions: {} } },
});

export function aggregateMappedSales(
  sales: MappableSale[],
  rules: BiSuiteMappingRule[],
  opts?: {
    pdvView?: PdvView;
    pdvDirectory?: PdvViewDirectory;
    /** Task #527 — listino canvass VF + regole KPI per i conteggi per pista. */
    canvassIndex?: CanvassIndex | null;
    canvassKpiRules?: CanvassKpiRule[] | null;
  },
): MappedSalesAggregation {
  const canvassIndex = opts?.canvassIndex ?? null;
  const canvassKpiRules = opts?.canvassKpiRules ?? null;
  const totaliPistaCanvass: Partial<Record<PistaCanvass, number>> = {};
  // Task #462 — vista PDV: 'origine' (default, comportamento invariato:
  // campi legacy della vendita) oppure 'destinazione' (attribuzione al PDV
  // di destinazione da rawData.attivitaDestinazione, con bucket esplicito
  // per le vendite senza destinazione).
  const pdvView: PdvView = opts?.pdvView === "destinazione" ? "destinazione" : "origine";
  let salesSenzaDestinazione = 0;
  const byPdv: Record<string, PdvAggregate> = {};

  let totalMapped = 0;
  let totalUnmapped = 0;
  let totalArticoli = 0;
  let totalImporto = 0;
  let latestSaleDate: Date | null = null;
  // Task #457 — bucket per giorno italiano (stessa semantica di trendYmdOf
  // usata dal report Telegram): conteggio vendite + fatturato lordo.
  const byDay = new Map<string, { day: string; vendite: number; importo: number }>();

  for (const sale of sales) {
    const importoSale = parseFloat(String(sale.totale ?? "")) || 0;
    totalImporto += importoSale;
    if (sale.dataVendita) {
      const d = new Date(sale.dataVendita);
      if (!latestSaleDate || d > latestSaleDate) latestSaleDate = d;
    }
    const ymd = trendYmdOf(sale.dataVendita);
    if (ymd) {
      const bucket = byDay.get(ymd) ?? { day: ymd, vendite: 0, importo: 0 };
      bucket.vendite += 1;
      bucket.importo += importoSale;
      byDay.set(ymd, bucket);
    }
    const raw = sale.rawData as any;
    if (!raw) continue;

    // In vista Origine i campi legacy sono usati AS-IS (comportamento
    // invariato al byte); solo la vista Destinazione passa dal resolver.
    let effettivoPos = sale.codicePos;
    let effettivoNome = sale.nomeNegozio;
    let effettivaRs = sale.ragioneSociale || "";
    if (pdvView === "destinazione") {
      const resolvedPdv = resolveSalePdvForView(sale, "destinazione");
      if (resolvedPdv.senzaDestinazione) salesSenzaDestinazione++;
      effettivoPos = resolvedPdv.codicePos;
      effettivoNome = resolvedPdv.nomeNegozio;
      effettivaRs = resolveSaleRagioneSocialeForView(sale, "destinazione", opts?.pdvDirectory);
    }
    const codicePos = effettivoPos || "UNKNOWN";
    if (!byPdv[codicePos]) {
      byPdv[codicePos] = {
        codicePos,
        nomeNegozio: effettivoNome || codicePos,
        ragioneSociale: effettivaRs,
        items: [],
        addons: [],
        accessori: { pezzi: 0, importo: 0 },
        servizi: { pezzi: 0, importo: 0 },
        devices: newDeviceTally(),
        pezziIva: 0,
        cbCambiPiano: 0,
        telefoni: 0,
        unmapped: 0,
        totalArticoli: 0,
      };
    }

    const articoli = raw.articoli || [];

    const matchDomanda = (testo: string, predicate: (risp: string) => boolean): boolean => {
      for (const art of articoli) {
        const dr = art.dettaglio?.domandeRisposte || [];
        for (const qr of dr) {
          const dom = String(qr.domanda || '').toUpperCase();
          if (dom.includes(testo)) {
            const risp = String(qr.risposta || '').toUpperCase();
            if (predicate(risp)) return true;
          }
        }
      }
      return false;
    };
    const isFinanziato = matchDomanda('TELEFONO INCLUSO COMPASS', (r) => r.includes('SI'))
      || matchDomanda('TELEFONO INCLUSO FINDOMESTIC', (r) => r.includes('SI'))
      || matchDomanda('TELEFONO INCLUSO MULTI FINANZIAMENTO', (r) => r.includes('SI'))
      || matchDomanda('MIA TELEFONO FINANZIAMENTO', (r) => /\d/.test(r));
    const isRate = matchDomanda('TELEFONO INCLUSO VAR', (r) => r.includes('SI'))
      || matchDomanda('MIA TELEFONO VAR', (r) => /\d/.test(r));
    const saleModality: 'finanziato' | 'rate' | 'altro' = isFinanziato ? 'finanziato' : (isRate ? 'rate' : 'altro');
    const tallyDevice = (kind: 'smartphone' | 'smartDevice' | 'internetDevice', desc: string) => {
      const bucket = byPdv[codicePos].devices[kind][saleModality];
      bucket.pezzi += 1;
      bucket.descriptions[desc] = (bucket.descriptions[desc] || 0) + 1;
    };
    const clienteTipo = raw.cliente?.clienteTipo || '';

    const PRODOTTI_CATS = new Set([
      'TELEFONIA', 'MODEM/ROUTER', 'SMART DEVICE', 'INTERNET DEVICE', 'SIM', 'RICARICHE',
      'ACCESSORI', 'GARANZIE', 'RICAMBI', 'RICAMBI PC', 'DEPOSITO CAUZIONALE',
      'COSTO ATTIVAZIONE', 'EPAY', 'OPZIONI', 'ARROTONDAMENTO', 'GARANTEASY',
      'DEMO TELEFONIA WIND3', 'TELEFONIA TRADE-IN', 'ALTRO',
    ]);
    const SERVIZI_CATS = new Set(['SPEDIZIONE', 'ASSISTENZA']);
    const ACCESSORI_CATS = new Set(['ACCESSORI']);
    const SERVIZI_DASHBOARD_CATS = new Set(['SPEDIZIONE', 'ASSISTENZA', 'GARANTEASY']);

    let canvassCount = 0;
    let mappedCount = 0;
    for (const art of articoli) {
      const catNome = (art.categoria?.nome || '').toUpperCase().trim();
      const tipNome = String(art.tipologia?.nome || '').trim();
      const coupon = isCouponCaring(catNome, tipNome);
      // Il conteggio VF deve vedere anche segnali Upselling agganciati a un
      // articolo prodotto/servizio, prima dei relativi `continue`.
      if (canvassIndex && !coupon) {
        const vf = classifyArticle(art, canvassIndex, canvassKpiRules);
        if (vf) {
          for (const [pista, volume] of Object.entries(
            classificationPistaCounts(art, vf, canvassIndex),
          ) as [PistaCanvass, number][]) {
            const bucket = (byPdv[codicePos].countByPistaCanvass ??= {});
            bucket[pista] = (bucket[pista] || 0) + volume;
            totaliPistaCanvass[pista] = (totaliPistaCanvass[pista] || 0) + volume;
          }
        }
      }
      if (PRODOTTI_CATS.has(catNome) || SERVIZI_CATS.has(catNome)) {
        const dett = art.dettaglio || {};
        const imp = parseFloat(String(dett.importoImponibile ?? '')) || parseFloat(String(dett.prezzo ?? '')) || 0;
        const desc = ((art.descrizione || '').trim()) || '(senza descrizione)';
        if (catNome === 'TELEFONIA') {
          tallyDevice('smartphone', desc);
          byPdv[codicePos].telefoni += 1;
        } else if (catNome === 'SMART DEVICE') {
          tallyDevice('smartDevice', desc);
        } else if (catNome === 'INTERNET DEVICE' || catNome === 'MODEM/ROUTER') {
          tallyDevice('internetDevice', desc);
        }
        if (ACCESSORI_CATS.has(catNome)) {
          byPdv[codicePos].accessori.pezzi += 1;
          byPdv[codicePos].accessori.importo += imp;
        } else if (SERVIZI_DASHBOARD_CATS.has(catNome)) {
          byPdv[codicePos].servizi.pezzi += 1;
          byPdv[codicePos].servizi.importo += imp;
        }
        continue;
      }
      canvassCount++;
      // Task #392 — conteggi extra per la Tabella PDV × Pista (vista Pezzi):
      // pezzi P.IVA e cambi piano CB, per categoria BiSuite (non per regola
      // di mapping: così i twin partnership delle regole CB non raddoppiano).
      {
        const clsPista = coupon ? undefined : classifyCategory(catNome)?.pista;
        if (clsPista && isPezzoIva({ pista: clsPista, categoriaNome: catNome, descrizione: String(art.descrizione || '') })) {
          byPdv[codicePos].pezziIva += 1;
        }
        if (clsPista === 'cb') {
          byPdv[codicePos].cbCambiPiano += 1;
        }
      }
      const mappedResults = mapBiSuiteArticle(art, clienteTipo, rules);
      if (mappedResults.length === 0) continue;
      mappedCount++;
      const artCanone = parseFloat(art.dettaglio?.canone || '0') || 0;
      for (const m of mappedResults) {
        const effectiveRuleType = m.ruleType || 'base';
        if (effectiveRuleType === 'additional') {
          const CANONE_BASED_ADDONS = new Set([
            'CONVERGENZA', 'LINEA_ATTIVA', 'FIBRA_FTTH_ADDON',
            'VOCE_UNLIMITED', 'CONVERGENZA_LUCE_GAS', 'CONVERGENTE_ASSICUR',
          ]);
          const canoneForAddon = CANONE_BASED_ADDONS.has(m.targetCategory) ? artCanone : 0;
          const existingAddon = byPdv[codicePos].addons.find(
            (a) => a.pista === m.pista && a.targetCategory === m.targetCategory
          );
          if (existingAddon) {
            existingAddon.occorrenze++;
            existingAddon.canone += canoneForAddon;
          } else {
            byPdv[codicePos].addons.push({
              pista: m.pista,
              targetCategory: m.targetCategory,
              targetLabel: m.targetLabel,
              occorrenze: 1,
              canone: canoneForAddon,
            });
          }
        } else {
          const canoneForThis = artCanone;
          const existing = byPdv[codicePos].items.find(
            (i) => i.pista === m.pista && i.targetCategory === m.targetCategory
          );
          if (existing) {
            existing.pezzi++;
            existing.canone += canoneForThis;
            if (m.targetCategory === 'SIM_IVA') {
              const desc = ((art.descrizione || '').trim()) || '(senza descrizione)';
              if (!existing.descriptions) existing.descriptions = {};
              existing.descriptions[desc] = (existing.descriptions[desc] || 0) + 1;
            }
          } else {
            const newItem: AggregatedItem = {
              pista: m.pista,
              targetCategory: m.targetCategory,
              targetLabel: m.targetLabel,
              pezzi: 1,
              canone: canoneForThis,
              ruleType: 'base',
            };
            if (m.targetCategory === 'SIM_IVA') {
              const desc = ((art.descrizione || '').trim()) || '(senza descrizione)';
              newItem.descriptions = { [desc]: 1 };
            }
            byPdv[codicePos].items.push(newItem);
          }
        }
      }
    }
    totalArticoli += canvassCount;
    byPdv[codicePos].totalArticoli += canvassCount;
    totalMapped += mappedCount;
    const unmappedCount = canvassCount - mappedCount;
    totalUnmapped += unmappedCount;
    byPdv[codicePos].unmapped += unmappedCount;
  }

  const pdvList = Object.values(byPdv);

  const totaliPerPista: TotaliPerPista = {};
  const totaliAddonsPerPista: TotaliAddonsPerPista = {};
  for (const pdv of pdvList) {
    for (const item of pdv.items) {
      if (!totaliPerPista[item.pista]) totaliPerPista[item.pista] = {};
      if (!totaliPerPista[item.pista][item.targetCategory]) {
        totaliPerPista[item.pista][item.targetCategory] = {
          targetCategory: item.targetCategory,
          targetLabel: item.targetLabel,
          pezzi: 0,
          canone: 0,
          ruleType: item.ruleType,
        };
      }
      totaliPerPista[item.pista][item.targetCategory].pezzi += item.pezzi;
      totaliPerPista[item.pista][item.targetCategory].canone += item.canone;
    }
    for (const addon of pdv.addons) {
      if (!totaliAddonsPerPista[addon.pista]) totaliAddonsPerPista[addon.pista] = {};
      if (!totaliAddonsPerPista[addon.pista][addon.targetCategory]) {
        totaliAddonsPerPista[addon.pista][addon.targetCategory] = {
          targetCategory: addon.targetCategory,
          targetLabel: addon.targetLabel,
          occorrenze: 0,
          canone: 0,
        };
      }
      totaliAddonsPerPista[addon.pista][addon.targetCategory].occorrenze += addon.occorrenze;
      totaliAddonsPerPista[addon.pista][addon.targetCategory].canone += addon.canone;
    }
  }

  return {
    byPdv,
    pdvList,
    totalMapped,
    totalUnmapped,
    totalArticoli,
    totalImporto,
    latestSaleDate,
    totaliPerPista,
    totaliAddonsPerPista,
    daily: Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day)),
    pdvView,
    salesSenzaDestinazione,
    ...(canvassIndex ? { totaliPistaCanvass } : {}),
  };
}
