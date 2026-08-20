/**
 * Snapshot aggregato della Dashboard Gara Reale.
 *
 * Fonte: database di sviluppo, configurazione "Importato da Config Org -
 * 17/08/2026", organizzazione CMS S.R.L., agosto 2026.
 *
 * Sono inclusi soltanto dati aggregati per PDV e categoria. Nessun dato
 * personale di clienti, addetti o profili viene copiato nell'artefatto.
 */
export const dashboardSnapshot = {
  period: {
    month: 8,
    year: 2026,
    label: "Agosto 2026",
    latestSale: "2026-08-19",
  },
  source: {
    organization: "CMS S.R.L",
    configuration: "Importato da Config Org - 17/08/2026",
    environment: "Database di sviluppo",
    filter: "Vendite BiSuite non annullate dei 12 PDV, nei giorni di gara configurati",
    mapping: "Stesso aggregatore e stesse regole effettive della Dashboard Gara Reale",
  },
  summary: {
    sales: 1953,
    stores: 12,
    gross: 168050.7,
  },
  kpis: {
    telefoni: 343,
    accessori: 7339.43,
    servizi: 3811.57,
  },
  stores: [
    { codicePos: "9001288594", nome: "WindTre PORTA DI ROMA P.ZERO", sales: 358, gross: 29598.78, telefoni: 49, accessori: 1685.97, servizi: 901.9 },
    { codicePos: "9001393090", nome: "WINDTRE SAN CESAREO", sales: 164, gross: 24983.07, telefoni: 43, accessori: 1744.95, servizi: 393.47 },
    { codicePos: "9001412252", nome: "WindTre Civitavecchia", sales: 143, gross: 21270.83, telefoni: 39, accessori: 618.81, servizi: 494.32 },
    { codicePos: "9001401037", nome: "WindTre Store Jesi", sales: 180, gross: 17388.72, telefoni: 36, accessori: 724.91, servizi: 135.3 },
    { codicePos: "9001290392", nome: "WindTre Pomezia", sales: 216, gross: 15271.59, telefoni: 28, accessori: 673.18, servizi: 340.28 },
    { codicePos: "9001046475", nome: "WindTre Fiumicino", sales: 147, gross: 14968.07, telefoni: 21, accessori: 591.45, servizi: 352.59 },
    { codicePos: "9001402980", nome: "WindTre Store Prenestina", sales: 149, gross: 10323.7, telefoni: 40, accessori: 472.86, servizi: 209.05 },
    { codicePos: "9001060855", nome: "WindTre Parco Leonardo", sales: 192, gross: 9544.74, telefoni: 19, accessori: 154.1, servizi: 409.97 },
    { codicePos: "9001408258", nome: "WindTre Candia", sales: 127, gross: 8410.05, telefoni: 20, accessori: 240.72, servizi: 209.87 },
    { codicePos: "9001408227", nome: "WindTre Tiburtina", sales: 104, gross: 7526.27, telefoni: 22, accessori: 127.05, servizi: 213.12 },
    { codicePos: "9001409452", nome: "WindTre Store Miralfiore", sales: 119, gross: 7291.89, telefoni: 23, accessori: 244.05, servizi: 106.6 },
    { codicePos: "9001409453", nome: "W3 PESARO BRANCA", sales: 54, gross: 1472.99, telefoni: 3, accessori: 61.38, servizi: 45.1 },
  ],
  piste: [
    { nome: "Mobile", eventi: 693 },
    { nome: "Partnership", eventi: 334 },
    { nome: "Caring & Business", eventi: 334 },
    { nome: "Fisso", eventi: 202 },
    { nome: "Energia", eventi: 124 },
    { nome: "Assicurazioni", eventi: 67 },
    { nome: "Protecta", eventi: 4 },
  ],
  daily: [
    { date: "2026-08-01", gross: 7056.33, sales: 107 },
    { date: "2026-08-02", gross: 4186.1, sales: 42 },
    { date: "2026-08-03", gross: 14305.04, sales: 145 },
    { date: "2026-08-04", gross: 12732.94, sales: 114 },
    { date: "2026-08-05", gross: 13433.23, sales: 98 },
    { date: "2026-08-06", gross: 10801.66, sales: 119 },
    { date: "2026-08-07", gross: 15262.91, sales: 132 },
    { date: "2026-08-08", gross: 11108.46, sales: 111 },
    { date: "2026-08-09", gross: 3166.6, sales: 32 },
    { date: "2026-08-10", gross: 7166.39, sales: 140 },
    { date: "2026-08-11", gross: 8063.54, sales: 130 },
    { date: "2026-08-12", gross: 11606.14, sales: 135 },
    { date: "2026-08-13", gross: 8825.09, sales: 112 },
    { date: "2026-08-14", gross: 9397.68, sales: 103 },
    { date: "2026-08-15", gross: 1564.9, sales: 9 },
    { date: "2026-08-16", gross: 2392.91, sales: 37 },
    { date: "2026-08-17", gross: 12324.56, sales: 134 },
    { date: "2026-08-18", gross: 9480.86, sales: 152 },
    { date: "2026-08-19", gross: 5175.36, sales: 101 },
  ],
} as const;