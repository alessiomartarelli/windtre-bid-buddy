---
name: Brand → module gating
description: Come i brand associati a un'org filtrano i moduli WindTre-specifici e il fallback sicuro senza brand.
---

Regola: i moduli WindTre-specifici (simulatore, tabelle_calcolo, gara_*,
drms_commissioning, incentivazione_interna, vendite_bisuite,
customer_journey) sono consentiti solo se l'org ha il brand WindTre
associato. Org SENZA alcun brand associato ⇒ nessun filtro (comportamento
legacy). super_admin bypassa.

**Why:** scelta esplicita dell'utente (opzione "semplice", non mapping
configurabile per brand): il fallback senza-brand evita di rompere le org
esistenti che non hanno mai associato brand.

**How to apply:** ogni nuovo modulo legato a incentivi/dati WindTre va
aggiunto alla lista gated in `shared/modules.ts`; il gating va applicato
sia server (requireModule) sia client (useEnabledModules), mai in un solo
posto. Match sul nome brand tollerante (WindTre/Wind Tre/WIND3/W3). Nota:
il dev server NON ricarica a caldo le modifiche a server/routes.ts —
riavvia il workflow prima di testare via curl.
