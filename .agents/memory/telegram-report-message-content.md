---
name: Telegram report — text message content rules
description: What the Telegram TEXT message is (discursive director comment, not a listing) vs what belongs only in the HTML attachment
---

Il messaggio di TESTO Telegram (`buildTelegramReportMessage` →
`buildReportComment` in `shared/venditeReport.ts`) è un **commento discorsivo
"da direttore vendite"**, NON un elenco di vendite. Le vecchie sezioni-elenco
(Per tipo / Per pista / Per PDV / Fatturato prodotti-servizi / Assicurazioni /
Energia per cliente / Proiezione fine mese) sono state **rimosse dal testo**:
quel dettaglio vive ora **solo nell'allegato HTML** (`buildVenditeReportHtml`).

**Regola durevole:** il testo è narrativo (saluto per fascia oraria + riepilogo
del giorno + standout PDV/addetto + eventuale confronto col forecast mensile +
chiusura motivazionale). Se serve aggiungere un nuovo dato di dettaglio NON
per-pista, va nell'HTML, NON nel testo.

**Impaginazione (aggiornamento, sostituisce il "no elenco nel testo"):** su
richiesta utente il commento è ora **impaginato a blocchi/paragrafi** (blocchi
separati da riga vuota, `out.join("\n\n")` in `buildDirettoreCommento`) e le due
sezioni per-pista sono **elenchi puntati** (`•`, una riga per pista): "Dettaglio
di giornata" (`giornataFraming`) e "Sul mese …" (`meseFraming`) in
`shared/venditeCommento.ts`. Questo è un elenco VOLUTO nel testo, diverso dalle
vecchie sezioni-elenco rimosse (Per tipo/pista/PDV ecc., che restano solo
nell'HTML). I test usano `.includes()`/regex: mantenere i marker "Finora",
"In chiusura", "Sul mese", "proiezione", "obiettivo", "davanti/dietro al passo".

**Forecast (config per-org, in chiaro, NON segreti):**
`forecast_canvass_pezzi`, `forecast_telefoni_pezzi`, `forecast_accessori_euro`,
`forecast_servizi_euro`, `numero_negozi`, `giorni_lavorativi`. Un obiettivo
vuoto o ≤ 0 non viene valutato. `giorni_lavorativi` vuoto ⇒ fallback ai giorni
lavorativi da calendario (`monthWorkingDays`, riusa `buildCalendar`/festività
dell'Incentivazione). Il confronto è: maturato mese-a-oggi vs passo atteso
proporzionale a `elapsedWorkingDays/totalWorkingDays`, delta% + proiezione fine
mese. Le dimensioni: canvass=`countByType.canvass`, telefoni=`telefoniPezziOf`,
accessori €=`accessoriEuroOf(prodottiByCategoria)`, servizi €=`amountByType.servizi`.

**Determinismo:** la varietà delle frasi è seed-ata sulla data (`dayOfYear` +
`pick`): stesso giorno ⇒ stesso testo, giorni diversi ⇒ variano. I test che
seminano una data fissa devono aspettarsi output stabile.

**Why:** l'utente (Task #266) voleva che la chat Telegram non fosse più un muro
di numeri ma un commento da direttore vendite che dà il polso sull'obiettivo
mensile; il dettaglio completo resta comunque a portata nell'allegato HTML.

**Caveat parziale (13:30):** il "delta obiettivo di giornata" confronta il
maturato **parziale** di oggi con un target giornaliero **a giornata piena**
(`forecast/totalWorkingDays`), quindi a metà giornata risulta quasi sempre
molto negativo ("sotto l'obiettivo di giornata del ~50%") anche quando il
mese è in linea/avanti. È una tensione voluta di design, non un bug: non
interpretarla come regressione. Se un domani si vuole ammorbidire, andrebbe
scalato il target sulla frazione di giornata trascorsa (non fatto).

**Frasi da pool + punteggiatura:** le aperture di banda possono già finire
con `!`/`?` (es. "Chiusura col botto, squadra!"). Chiudi le frasi con
`withPeriod` (o equivalente), MAI concatenando `+ "."` cieco, o esce `!.`.

**How to apply — HTML (regole precedenti tuttora valide nell'allegato):** nella
riga pista di "La gara delle piste" il dettaglio Assicurazioni/Energia è nei
CHIP inline (assicurazioni = descrizione prodotto da `assicurazioniDettaglio`
raggruppato per `tipologiaNome — descrizione`; energia = `CF`/`IVA` da
`energiaClienteFromDescrizione`, che guarda la DESCRIZIONE offerta — `BUSINESS`/
`MICROBUSINESS` ⇒ IVA — non il tipo cliente registrato, spesso incoerente sui
dati WindTre). `saleCustomerKind` resta esportato (usato dai test) ma non
governa lo split energia.
