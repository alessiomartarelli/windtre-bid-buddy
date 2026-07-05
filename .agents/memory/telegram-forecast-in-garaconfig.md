---
name: Telegram forecast obiettivi lives in gara_config (per-month)
description: Where the sales forecast/obiettivi for the Telegram "direttore vendite" comment is stored and how working days are derived.
---

Il forecast/obiettivi del report Telegram NON sta più in
`organization_config.config.telegramReport` — vive **per-mese/anno** in
`gara_config.config.venditeForecast`. La card "Forecast e obiettivi (mese)"
sta in Performance → Configurazione gara (`/configurazione-gara`), non nel
form Telegram admin. Lo scheduler lo legge con
`storage.getGaraConfig(orgId, month, year)`.

`ForecastConfig` (per pista, non più "canvass"): mobileVolumi,
mobileIvaVolumi, fissoVolumi, fissoIvaVolumi, energiaVolumi,
assicurazioniVolumi, protettiVolumi (=pista protecta), cbVolumi,
telefoniPezzi, accessoriFatturato, serviziFatturato, numeroNegoziCc,
numeroNegoziStrada. `hasForecast` ignora i due `numeroNegozi*` (sono solo
divisori per standout e giorni lavorativi, non dimensioni valutate).

**Giorni lavorativi automatici, pesati per tipologia negozio**
(`monthWorkingDaysByType`): CC = tutti i giorni tranne festivi (domeniche
INCLUSE); strada = tutti tranne domeniche e festivi. `total`/`elapsed` del
passo mensile = media pesata su numeroNegoziCc/numeroNegoziStrada; senza
conteggi negozi si ricade su `monthWorkingDays` standard.

**Why:** richiesta utente esplicita (obiettivi per mese, niente canvass,
volumi per pista, negozi CC vs strada con calendari lavorativi diversi).

**How to apply:** se tocchi il commento report o lo scheduler, leggi il
forecast da gara_config, non da telegramReport. Un `forecast` legacy in
telegramReport viene preservato dal POST ma NON usato.

**Proiezione fine mese (card HTML "Totale mese"):** proietta UN KPI per
riga con la stessa granularità del forecast (volumi per pista: Mobile, di
cui P.IVA, Fisso, di cui P.IVA, Energia, Assicurazioni, Protetti=protecta,
Cb; + Telefoni pz; + Accessori/Servizi €). NON esiste più la riga "Canvass
totali" (pezzi totali): l'utente l'ha esplicitamente rifiutata a favore
della proiezione per-KPI. `MonthEndProjection.kpis: ProjectionEntry[]`
(key/label/unit/maturato/proiezione). Base ritmo = `monthWorkingDays`
standard lun–sab (la ponderazione CC/strada resta solo nel commento).
