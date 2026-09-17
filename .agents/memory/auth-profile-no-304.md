---
name: Auth profile propagation
description: Vincoli di cache e deduplica quando più istanze useAuth condividono il profilo via eventi
---

**Regola:** la risposta del profilo di sessione deve essere sempre un 200 con body per una sessione valida e dichiarare `no-store`. Le notifiche globali di profili identici devono essere deduplicate.

**Why:** più componenti creano istanze indipendenti dell’hook auth. Un 304 viene trattato da Fetch come risposta senza body/non `ok`. Inoltre, se ogni istanza notifica lo stesso profilo, i listener ricreano array e oggetti; gli effect che dipendono da quelle identità possono rimontare il componente che ha generato la notifica e creare un ciclo infinito.

**How to apply:** non abilitare caching condizionale sulle route auth correnti; deduplicare gli eventi per contenuto, non solo per user id, così vere modifiche a ruolo, moduli, brand o preferenze continuano a propagarsi. I componenti protetti devono distinguere “profilo in caricamento” da “profilo caricato senza ruolo”.