---
name: Piste canvass VF (luce/gas/iva_mobile/iva_wireline/vas)
description: Cosa toccare quando si aggiunge una pista canvass; semantica del modello gara Vodafone/Fastweb vs WindTre nei report Telegram.
---

Aggiungere una pista canvass richiede l'aggiornamento in blocco di: label/colori e target KPI (record esaustivi, il typecheck li becca), l'ordine di rendering del report (NON esaustivo: se manca la pista **non viene mai renderizzata**, silenziosamente) e le whitelist Telegram (globale + per-brand) con i relativi colori HTML.
**Why:** piste classificate e aggregate correttamente sono rimaste invisibili nel report perché mancavano dall'ordine di rendering.

Semantica VF (fail-closed):
- Sottopiste solo dal match strutturato del listino (pista+categoria+tipologia); combinazioni ignote restano nelle piste generiche; ogni articolo conta in UNA sola pista.
- Il default globale Telegram resta la lista WindTre storica (compatibilità report legacy); le piste VF entrano via gating per brand (protecta/assicurazioni rimosse, energia→luce+gas) o selezione esplicita.
- Il form per-brand in Configurazione Gara mostra la selezione GIÀ gated per brand-kind, altrimenti un salvataggio per-brand perde Luce/Gas (la remap server non trova più "energia").
- Org mista W3+VF senza PDV brandizzati ⇒ report legacy unico col modello WindTre INTATTO: solo fail-closed Protetti (gating protectaOnly), MAI il remap VF. Il modello VF completo si applica solo a brand-target VF o org VF pura; su errore di lettura brand si assume org mista.
- Obiettivi/premi VF: config assente o target tutti a 0 ⇒ pista a solo conteggio pezzi; blocco per-RS "rimosso" è fail-closed (niente premi anche con config globale); i blocchi VF si salvano solo per org col modello VF, mai per org WindTre. La RS effettiva in dashboard va risolta anche dal PDV selezionato e per le org mono-RS (che non hanno selettore RS).
- Scheduler: per report VF carica listino canvass (system_config → fallback baked) + regole KPI org; se il listino non si carica il report esce con classificazione legacy (decisione: disponibilità > fail-closed sui conteggi).
