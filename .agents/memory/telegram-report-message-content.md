---
name: Telegram report message — content rules
description: Design rules for the compact Telegram text message sections (buildTelegramReportMessage)
---

Il messaggio di testo Telegram (`buildTelegramReportMessage` in
`shared/venditeReport.ts`) è compatto e NON deve ripetere lo stesso dato in
più sezioni. Regole decise con l'utente:

- **Fatturato prodotti/servizi**: elenca TUTTE le categorie prodotto vendute
  (da `prodottiByCategoria`, già ordinato per fatturato↓), non solo
  Telefoni/Accessori — l'utente vuole vedere la descrizione di ogni etichetta
  (Ricariche, SIM, Modem/Router, Elettrodomestici, Viaggi, ecc.). Emoji note
  📱/🎧, fallback 📦; poi il totale 🔧 Servizi.
- **Assicurazioni** ed **Energia per cliente**: nel MESSAGGIO DI TESTO
  mostrarle SOLO quando aggiungono granularità oltre la riga "Per pista" —
  assicurazioni con ≥ 2 prodotti distinti, energia con ENTRAMBI i tipi cliente
  (CF e IVA). Con un solo sottogruppo ripeterebbero il totale di "Per pista".
- **Dettaglio assicurazioni per PRODOTTO, non per categoria pista**: la
  categoria BiSuite della pista è sempre l'unico bucket "ASSICURAZIONI", quindi
  raggruppare per categoria dà una sola riga = duplicato del totale pista.
  `assicurazioniDettaglio` in `aggregateDailyReport` raggruppa per
  `tipologiaNome — descrizione` dell'articolo (fallback alla categoria se
  entrambe vuote), es. "ASSICURAZIONI CASA — CASA ELETTRODOMESTICI".
- **Split Energia CF/IVA dalla DESCRIZIONE offerta, non dal tipo cliente**
  (`energiaClienteFromDescrizione` in `shared/venditeReport.ts`): business/IVA
  se la descrizione maiuscola contiene `BUSINESS` (copre `MICROBUSINESS`,
  `CLIENTE BUSINESS`), altrimenti privato/CF. `saleCustomerKind` esiste ancora
  (export usato dai test) ma NON governa più lo split energia.

**Why:** l'utente ha bocciato più round perché (a) il messaggio mostrava
Assicurazioni/Energia "2 volte"; (b) sui dati reali WindTre il tipo cliente
registrato spesso NON concorda con la descrizione dell'offerta, mentre le
offerte IVA hanno sempre `BUSINESS` in descrizione; (c) voleva il dettaglio
inline come i chip Mobile, non card separate.

**How to apply — HTML (Task #264):** nell'allegato HTML NON esistono più le
card dedicate "Assicurazioni" ed "Energia · Privati vs Business" (rimosse su
richiesta "togli quelle sotto"). Il dettaglio va nei CHIP inline della riga
pista di "La gara delle piste" (`pisteSection`, chip da `categorieByPista`):
per assicurazioni il chip = descrizione prodotto, per energia = `CF`/`IVA`
(come i chip Mobile TIED/UNTIED). La soppressione anti-duplicazione vale SOLO
per le sezioni testuali del messaggio, non per i chip HTML.
