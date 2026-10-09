// Distinct identities in every context make stale rows observable, including page boundaries.
export const filters = {
  typeFilter: "tutti", pdvFilter: [], addettoFilter: "tutti", stateFilter: "tutti", search: "",
};
const groups = [
  ["LUGLIO", "2026-07-05", "Roma", "Mario", "privato"],
  ["AGOSTO", "2026-08-05", "Roma", "Mario", "privato"],
  ["MILANO", "2026-08-05", "Milano", "Luigi", "azienda"],
];
export const rows = groups.flatMap(([name, date, pdv, addetto, customerType], group) =>
  Array.from({ length: 123 }, (_, i) => {
    const id = group * 1000 + i + 1;
    return {
      itemId: `item-${id}`, journeyId: `journey-${id}`, customerKey: `CF-${id}`,
      cliente: `${name}-${String(i + 1).padStart(3, "0")}`, customerType, pdv, addetto,
      driver: "mobile", state: "inserito", economicState: "pagato", drmsOutcomeState: "pagato",
      categoria: "UNTIED", tipologia: "VOCE", descrizione: `SIM ${name}`,
      codiceContratto: `CONTRACT-${id}`, bisuiteSaleId: `sale-${id}`, bisuiteArticleId: id,
      openedAt: date, insertedAt: date, eventDate: date, valore: 0,
    };
  }));
export const sources = rows.map(r => ({
  saleId: r.bisuiteSaleId, bisuiteId: r.bisuiteArticleId, articleId: r.bisuiteArticleId,
  categoria: r.categoria, tipologia: r.tipologia, descrizione: r.descrizione,
  insertedAt: r.insertedAt, customerKey: r.customerKey, customerType: r.customerType,
  cliente: r.cliente, pdv: r.pdv, addetto: r.addetto, cancelled: false, contract: r.codiceContratto,
}));
