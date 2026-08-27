---
name: Telegram report content config (piste visibili + gruppi)
description: Per-month piste visibility and TELCO/NEW CORE group config for the Telegram report, brand gating, and fail-closed rules
---

# Contenuti report Telegram (piste visibili + gruppi TELCO/NEW CORE)

Config per-org/per-MESE in `gara_config.config.telegramReportContent`
(`shared/telegramReportContent.ts`): `pisteVisibili`, `telcoPiste`,
`newCorePiste`. Vale SOLO per il report Telegram (testo + allegato HTML),
mai per Dashboard o calcoli Gara.

Regole del parser (`parseTelegramReportContent`):
- campo MANCANTE ⇒ default legacy (visibili: mobile/fisso/cb/assicurazioni/
  protecta/energia; TELCO: mobile+fisso; NEW CORE: assicurazioni+energia);
- array PRESENTE ma vuoto resta vuoto (scelta esplicita dell'utente);
- valori fuori whitelist eliminati, ordine normalizzato.

Gruppi TELCO/NEW CORE: indipendenti nella UI, ma in generazione vengono
INTERSECATI con le piste visibili (`effectiveGroupPiste`). I "migliori"
per gruppo e le classifiche generali PDV/addetti sono per SOMMA PEZZI
delle piste selezionate, non per performanceScore. Telefoni (pezzi) e
Accessori/Servizi (fatturato netto IVA) restano FUORI dal filtro piste.

**Brand gating fail-closed:** org Vodafone/Fastweb non devono mai vedere
Protetti/Verisure (`applyBrandGating` rimuove `protecta`). Nello scheduler
la lettura brand fallita ⇒ trattata come VF (fail-closed): meglio nascondere
Protetti a un'org WindTre per un errore transitorio che mostrarlo a Vodafone.

**Filtro alla FONTE (aggregazione):** le piste nascoste vengono escluse
dentro `aggregateDailyReport`/`buildDailyTrend`/`buildDailyHistory` (parametro
opzionale `visiblePiste`, passato solo dallo scheduler Telegram): spariscono
da mix canvass, countByPista, drill-down PDV/addetto, punteggi, trend e
storico. I totali per VENDITA (vendite/importo, scontrino intero con
telefoni/accessori) restano a livello scontrino: scelta voluta, non un leak.
Dashboard e pagine Vendite chiamano senza parametro ⇒ nessun filtro.

**Drill-down DTS:** la sezione DTS dell'HTML filtra il per-pista sulle
piste visibili; la pista `iva` non è configurabile e resta sempre visibile.

**Why:** l'utente vuole controllare mensilmente cosa compare nel report
(piste escluse spariscono da riepiloghi/proiezioni/strategia/classifiche/
card/drill-down) e chi conta come "migliore" TELCO/NEW CORE.
