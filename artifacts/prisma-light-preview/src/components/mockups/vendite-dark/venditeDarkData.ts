/**
 * Dati dimostrativi per la preview dark della pagina Vendite BiSuite.
 *
 * Tutti i contenuti sono aggregati o fittizi: nessun nome di cliente o
 * addetto reale. I nomi PDV sono gli stessi aggregati pubblici già usati
 * nella preview Prisma Light; addetti e clienti sono generici/mascherati.
 */

export type PistaKey = "mobile" | "fisso" | "energia" | "assicurazioni";

export const PISTA_LABELS: Record<PistaKey, string> = {
  mobile: "Mobile",
  fisso: "Fisso",
  energia: "Energia",
  assicurazioni: "Assicurazioni",
};

export const kpi = {
  venditeTotali: 1953,
  importoTotale: 168050.7,
  puntiVendita: 12,
  mediaVendita: 86.05,
};

export const incasso = [
  { key: "contanti", label: "Contanti", value: 54210.4 },
  { key: "pos", label: "POS / Carte", value: 88412.15 },
  { key: "finanziamento", label: "Finanziamento", value: 16890.0 },
  { key: "bonifico", label: "Bonifico", value: 5120.55 },
  { key: "misto", label: "Misto", value: 3417.6 },
] as const;

export const canvassCard = {
  totale: 1758,
  importo: 96410.22,
  piste: [
    { key: "mobile" as PistaKey, count: 693, importo: 41230.5, iva: 58 },
    { key: "fisso" as PistaKey, count: 202, importo: 18760.4, iva: 0 },
    { key: "energia" as PistaKey, count: 124, importo: 8120.9, iva: 0 },
    { key: "assicurazioni" as PistaKey, count: 67, importo: 6890.3, iva: 0 },
  ],
  altre: [
    { label: "Partnership", count: 334, importo: 12480.72 },
    { label: "Caring & Business", count: 334, importo: 8927.4 },
  ],
  couponCaring: { pezzi: 21, importo: 918.0 },
};

export const prodottiCard = {
  totale: 512,
  importoNetto: 58916.31,
  categorie: [
    { label: "TELEFONIA", pezzi: 343, importo: 51576.88, iva: 0 },
    { label: "ACCESSORI", pezzi: 154, importo: 7339.43, iva: 1614.67 },
    { label: "ALTRO", pezzi: 15, importo: 0, iva: 0 },
  ],
};

export const serviziCard = {
  totale: 138,
  importoNetto: 3811.57,
  iva: 838.55,
  voci: [
    { label: "Riparazioni", pezzi: 52, importo: 1620.4, iva: 356.49 },
    { label: "Configurazione device", pezzi: 46, importo: 1231.9, iva: 271.02 },
    { label: "Pellicole & setup", pezzi: 40, importo: 959.27, iva: 211.04 },
  ],
};

export const ragioniSociali = [
  {
    nome: "CMS S.R.L.",
    pdv: 8,
    vendite: 1408,
    importo: 122840.12,
    incasso: [
      { label: "Contanti", value: 39104.2 },
      { label: "POS / Carte", value: 66210.7 },
      { label: "Finanziamento", value: 12530.0 },
    ],
  },
  {
    nome: "RETAIL ADRIATICA S.R.L.",
    pdv: 4,
    vendite: 545,
    importo: 45210.58,
    incasso: [
      { label: "Contanti", value: 15106.2 },
      { label: "POS / Carte", value: 22201.45 },
      { label: "Finanziamento", value: 4360.0 },
    ],
  },
];

export interface PdvRow {
  codicePos: string;
  nome: string;
  rs: string;
  vendite: number;
  importo: number;
  perPista: Record<PistaKey, number>;
  iva: number;
  cb: number;
  telefoni: number;
}

export const pdvRows: PdvRow[] = [
  { codicePos: "9001288594", nome: "WindTre PORTA DI ROMA P.ZERO", rs: "CMS S.R.L.", vendite: 358, importo: 29598.78, perPista: { mobile: 121, fisso: 34, energia: 22, assicurazioni: 12 }, iva: 11, cb: 58, telefoni: 49 },
  { codicePos: "9001393090", nome: "WINDTRE SAN CESAREO", rs: "CMS S.R.L.", vendite: 164, importo: 24983.07, perPista: { mobile: 88, fisso: 25, energia: 16, assicurazioni: 9 }, iva: 8, cb: 41, telefoni: 43 },
  { codicePos: "9001412252", nome: "WindTre Civitavecchia", rs: "CMS S.R.L.", vendite: 143, importo: 21270.83, perPista: { mobile: 76, fisso: 22, energia: 14, assicurazioni: 8 }, iva: 6, cb: 35, telefoni: 39 },
  { codicePos: "9001290392", nome: "WindTre Pomezia", rs: "CMS S.R.L.", vendite: 216, importo: 15271.59, perPista: { mobile: 64, fisso: 18, energia: 12, assicurazioni: 6 }, iva: 5, cb: 30, telefoni: 28 },
  { codicePos: "9001046475", nome: "WindTre Fiumicino", rs: "CMS S.R.L.", vendite: 147, importo: 14968.07, perPista: { mobile: 58, fisso: 17, energia: 10, assicurazioni: 5 }, iva: 4, cb: 26, telefoni: 21 },
  { codicePos: "9001402980", nome: "WindTre Store Prenestina", rs: "CMS S.R.L.", vendite: 149, importo: 10323.7, perPista: { mobile: 52, fisso: 14, energia: 9, assicurazioni: 5 }, iva: 4, cb: 24, telefoni: 40 },
  { codicePos: "9001060855", nome: "WindTre Parco Leonardo", rs: "CMS S.R.L.", vendite: 192, importo: 9544.74, perPista: { mobile: 47, fisso: 13, energia: 8, assicurazioni: 4 }, iva: 3, cb: 22, telefoni: 19 },
  { codicePos: "9001408227", nome: "WindTre Tiburtina", rs: "CMS S.R.L.", vendite: 104, importo: 7526.27, perPista: { mobile: 38, fisso: 11, energia: 7, assicurazioni: 4 }, iva: 3, cb: 18, telefoni: 22 },
  { codicePos: "9001401037", nome: "WindTre Store Jesi", rs: "RETAIL ADRIATICA S.R.L.", vendite: 180, importo: 17388.72, perPista: { mobile: 61, fisso: 17, energia: 11, assicurazioni: 6 }, iva: 5, cb: 27, telefoni: 36 },
  { codicePos: "9001408258", nome: "WindTre Candia", rs: "RETAIL ADRIATICA S.R.L.", vendite: 127, importo: 8410.05, perPista: { mobile: 41, fisso: 12, energia: 7, assicurazioni: 4 }, iva: 3, cb: 19, telefoni: 20 },
  { codicePos: "9001409452", nome: "WindTre Store Miralfiore", rs: "RETAIL ADRIATICA S.R.L.", vendite: 119, importo: 7291.89, perPista: { mobile: 36, fisso: 10, energia: 6, assicurazioni: 3 }, iva: 2, cb: 17, telefoni: 23 },
  { codicePos: "9001409453", nome: "W3 PESARO BRANCA", rs: "RETAIL ADRIATICA S.R.L.", vendite: 54, importo: 1472.99, perPista: { mobile: 11, fisso: 3, energia: 2, assicurazioni: 1 }, iva: 1, cb: 5, telefoni: 3 },
];

export const addetti = [
  { nome: "Addetto A1", pdv: 2, vendite: 214, importo: 19840.2, perPista: { mobile: 71, fisso: 19, energia: 12, assicurazioni: 7 } },
  { nome: "Addetto B2", pdv: 1, vendite: 188, importo: 17210.6, perPista: { mobile: 63, fisso: 17, energia: 11, assicurazioni: 6 } },
  { nome: "Addetto C3", pdv: 2, vendite: 165, importo: 14580.1, perPista: { mobile: 55, fisso: 15, energia: 9, assicurazioni: 5 } },
  { nome: "Addetto D4", pdv: 1, vendite: 149, importo: 12104.45, perPista: { mobile: 49, fisso: 13, energia: 8, assicurazioni: 4 } },
  { nome: "Addetto E5", pdv: 1, vendite: 121, importo: 9865.3, perPista: { mobile: 40, fisso: 11, energia: 7, assicurazioni: 3 } },
] as const;

export interface DemoSale {
  id: string;
  data: string;
  negozio: string;
  codicePos: string;
  addetto: string;
  cliente: string;
  pista: PistaKey | "prodotti" | "servizi";
  pistaLabel: string;
  stato: "FINALIZZATA IN CASSA" | "ANNULLATA";
  importo: number;
}

export const vendite: DemoSale[] = [
  { id: "V-88214", data: "19/08/2026", negozio: "WindTre PORTA DI ROMA P.ZERO", codicePos: "9001288594", addetto: "Addetto A1", cliente: "Cliente #4821", pista: "mobile", pistaLabel: "Mobile", stato: "FINALIZZATA IN CASSA", importo: 129.9 },
  { id: "V-88210", data: "19/08/2026", negozio: "WINDTRE SAN CESAREO", codicePos: "9001393090", addetto: "Addetto B2", cliente: "Cliente #4818", pista: "prodotti", pistaLabel: "Prodotti · TELEFONIA", stato: "FINALIZZATA IN CASSA", importo: 899.0 },
  { id: "V-88202", data: "18/08/2026", negozio: "WindTre Civitavecchia", codicePos: "9001412252", addetto: "Addetto C3", cliente: "Cliente #4790", pista: "fisso", pistaLabel: "Fisso", stato: "FINALIZZATA IN CASSA", importo: 49.9 },
  { id: "V-88196", data: "18/08/2026", negozio: "WindTre Pomezia", codicePos: "9001290392", addetto: "Addetto D4", cliente: "Cliente #4771", pista: "energia", pistaLabel: "Energia", stato: "FINALIZZATA IN CASSA", importo: 0 },
  { id: "V-88190", data: "18/08/2026", negozio: "WindTre Store Jesi", codicePos: "9001401037", addetto: "Addetto E5", cliente: "Cliente #4765", pista: "assicurazioni", pistaLabel: "Assicurazioni", stato: "FINALIZZATA IN CASSA", importo: 89.0 },
  { id: "V-88187", data: "17/08/2026", negozio: "WindTre Fiumicino", codicePos: "9001046475", addetto: "Addetto A1", cliente: "Cliente #4742", pista: "servizi", pistaLabel: "Servizi", stato: "FINALIZZATA IN CASSA", importo: 29.9 },
  { id: "V-88181", data: "17/08/2026", negozio: "WindTre Parco Leonardo", codicePos: "9001060855", addetto: "Addetto B2", cliente: "Cliente #4738", pista: "mobile", pistaLabel: "Mobile", stato: "ANNULLATA", importo: 99.9 },
  { id: "V-88176", data: "16/08/2026", negozio: "WindTre Tiburtina", codicePos: "9001408227", addetto: "Addetto C3", cliente: "Cliente #4716", pista: "prodotti", pistaLabel: "Prodotti · ACCESSORI", stato: "FINALIZZATA IN CASSA", importo: 39.99 },
  { id: "V-88170", data: "16/08/2026", negozio: "WindTre Candia", codicePos: "9001408258", addetto: "Addetto D4", cliente: "Cliente #4704", pista: "mobile", pistaLabel: "Mobile", stato: "FINALIZZATA IN CASSA", importo: 149.9 },
  { id: "V-88161", data: "15/08/2026", negozio: "WindTre Store Miralfiore", codicePos: "9001409452", addetto: "Addetto E5", cliente: "Cliente #4688", pista: "fisso", pistaLabel: "Fisso", stato: "FINALIZZATA IN CASSA", importo: 39.9 },
  { id: "V-88155", data: "15/08/2026", negozio: "W3 PESARO BRANCA", codicePos: "9001409453", addetto: "Addetto A1", cliente: "Cliente #4671", pista: "servizi", pistaLabel: "Servizi", stato: "FINALIZZATA IN CASSA", importo: 19.9 },
  { id: "V-88149", data: "14/08/2026", negozio: "WindTre Store Prenestina", codicePos: "9001402980", addetto: "Addetto B2", cliente: "Cliente #4650", pista: "energia", pistaLabel: "Energia", stato: "FINALIZZATA IN CASSA", importo: 0 },
];

/** Andamento giornaliero pezzi per pista (agosto 2026, stessi giorni dello snapshot). */
export const andamento = [
  { day: "2026-08-01", mobile: 38, fisso: 11, energia: 7, assicurazioni: 4, iva: 3, cb: 17, telefoni: 18 },
  { day: "2026-08-02", mobile: 16, fisso: 4, energia: 3, assicurazioni: 1, iva: 1, cb: 7, telefoni: 7 },
  { day: "2026-08-03", mobile: 52, fisso: 15, energia: 9, assicurazioni: 5, iva: 4, cb: 24, telefoni: 26 },
  { day: "2026-08-04", mobile: 44, fisso: 13, energia: 8, assicurazioni: 4, iva: 4, cb: 20, telefoni: 22 },
  { day: "2026-08-05", mobile: 39, fisso: 12, energia: 7, assicurazioni: 4, iva: 3, cb: 18, telefoni: 20 },
  { day: "2026-08-06", mobile: 46, fisso: 13, energia: 8, assicurazioni: 5, iva: 4, cb: 21, telefoni: 21 },
  { day: "2026-08-07", mobile: 50, fisso: 14, energia: 9, assicurazioni: 5, iva: 4, cb: 23, telefoni: 25 },
  { day: "2026-08-08", mobile: 42, fisso: 12, energia: 8, assicurazioni: 4, iva: 3, cb: 19, telefoni: 20 },
  { day: "2026-08-09", mobile: 12, fisso: 3, energia: 2, assicurazioni: 1, iva: 1, cb: 5, telefoni: 5 },
  { day: "2026-08-10", mobile: 49, fisso: 14, energia: 9, assicurazioni: 5, iva: 4, cb: 22, telefoni: 23 },
  { day: "2026-08-11", mobile: 45, fisso: 13, energia: 8, assicurazioni: 4, iva: 4, cb: 20, telefoni: 22 },
  { day: "2026-08-12", mobile: 47, fisso: 14, energia: 8, assicurazioni: 5, iva: 4, cb: 21, telefoni: 24 },
  { day: "2026-08-13", mobile: 40, fisso: 12, energia: 7, assicurazioni: 4, iva: 3, cb: 18, telefoni: 19 },
  { day: "2026-08-14", mobile: 37, fisso: 11, energia: 7, assicurazioni: 4, iva: 3, cb: 17, telefoni: 18 },
  { day: "2026-08-15", mobile: 4, fisso: 1, energia: 1, assicurazioni: 0, iva: 0, cb: 2, telefoni: 1 },
  { day: "2026-08-16", mobile: 13, fisso: 4, energia: 2, assicurazioni: 1, iva: 1, cb: 6, telefoni: 6 },
  { day: "2026-08-17", mobile: 47, fisso: 14, energia: 8, assicurazioni: 5, iva: 4, cb: 21, telefoni: 23 },
  { day: "2026-08-18", mobile: 53, fisso: 15, energia: 9, assicurazioni: 5, iva: 4, cb: 24, telefoni: 26 },
  { day: "2026-08-19", mobile: 34, fisso: 10, energia: 6, assicurazioni: 3, iva: 3, cb: 15, telefoni: 17 },
] as const;

export const euro = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
export const integer = new Intl.NumberFormat("it-IT");
