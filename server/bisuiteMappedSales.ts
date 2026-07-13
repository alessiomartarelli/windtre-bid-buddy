import type { BiSuiteMappingRule } from "../shared/bisuiteMapping";
import { mapBiSuiteArticle } from "../shared/bisuiteMapping";

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
  latestSaleDate: Date | null;
  totaliPerPista: TotaliPerPista;
  totaliAddonsPerPista: TotaliAddonsPerPista;
};

// Forma minima di una riga bisuite_sales necessaria all'aggregazione.
export type MappableSale = {
  dataVendita?: Date | string | null;
  rawData?: unknown;
  codicePos?: string | null;
  nomeNegozio?: string | null;
  ragioneSociale?: string | null;
};

const newDeviceTally = (): DeviceTally => ({
  smartphone: { finanziato: { pezzi: 0, descriptions: {} }, rate: { pezzi: 0, descriptions: {} }, altro: { pezzi: 0, descriptions: {} } },
  smartDevice: { finanziato: { pezzi: 0, descriptions: {} }, rate: { pezzi: 0, descriptions: {} }, altro: { pezzi: 0, descriptions: {} } },
  internetDevice: { finanziato: { pezzi: 0, descriptions: {} }, rate: { pezzi: 0, descriptions: {} }, altro: { pezzi: 0, descriptions: {} } },
});

export function aggregateMappedSales(
  sales: MappableSale[],
  rules: BiSuiteMappingRule[],
): MappedSalesAggregation {
  const byPdv: Record<string, PdvAggregate> = {};

  let totalMapped = 0;
  let totalUnmapped = 0;
  let totalArticoli = 0;
  let latestSaleDate: Date | null = null;

  for (const sale of sales) {
    if (sale.dataVendita) {
      const d = new Date(sale.dataVendita);
      if (!latestSaleDate || d > latestSaleDate) latestSaleDate = d;
    }
    const raw = sale.rawData as any;
    if (!raw) continue;

    const codicePos = sale.codicePos || "UNKNOWN";
    if (!byPdv[codicePos]) {
      byPdv[codicePos] = {
        codicePos,
        nomeNegozio: sale.nomeNegozio || codicePos,
        ragioneSociale: sale.ragioneSociale || "",
        items: [],
        addons: [],
        accessori: { pezzi: 0, importo: 0 },
        servizi: { pezzi: 0, importo: 0 },
        devices: newDeviceTally(),
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
      if (PRODOTTI_CATS.has(catNome) || SERVIZI_CATS.has(catNome)) {
        const dett = art.dettaglio || {};
        const imp = parseFloat(String(dett.importoImponibile ?? '')) || parseFloat(String(dett.prezzo ?? '')) || 0;
        const desc = ((art.descrizione || '').trim()) || '(senza descrizione)';
        if (catNome === 'TELEFONIA') {
          tallyDevice('smartphone', desc);
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
    latestSaleDate,
    totaliPerPista,
    totaliAddonsPerPista,
  };
}
