---
name: Brand → module gating
description: Come i brand associati a un'org filtrano i moduli WindTre-specifici e il fallback sicuro senza brand.
---

Regola: solo i moduli realmente WindTre-specifici (simulatore,
tabelle_calcolo e drms_commissioning) richiedono il brand WindTre.
Dashboard Gara e Configurazione Gara sono multi-brand, come
incentivazione_interna, vendite_bisuite e customer_journey. Org SENZA alcun
brand associato ⇒ nessun filtro (comportamento legacy). super_admin bypassa.

**Why:** Phone&Phone (Fastweb+Vodafone) usa Dashboard Gara e Configurazione
Gara; trattarle come WindTre-only rendeva impossibile assegnarle agli utenti
anche quando il super admin le aveva abilitate per l'organizzazione. Il
fallback senza-brand evita di rompere le org legacy.

**How to apply:** aggiungere alla lista gated solo moduli che non possono
funzionare per altri brand; non dedurlo dal fatto che usino dati gara. Il
gating va applicato sia server (requireModule) sia client
(useEnabledModules), mai in un solo posto. Match WindTre tollerante. Riavvia
il workflow prima dei test route.
