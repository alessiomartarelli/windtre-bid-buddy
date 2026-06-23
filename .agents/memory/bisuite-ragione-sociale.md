---
name: BiSuite ragione sociale dei clienti business
description: BiSuite non espone la ragione sociale del cliente azienda in modo strutturato; come ricavarla e gestirla.
---

BiSuite **non** fornisce la ragione sociale del cliente azienda in nessun
campo strutturato: `cliente.ragioneSociale` / `cliente.denominazione` arrivano
vuoti (spesso stringa vuota `""`, non `null`). Il top-level
`rawData.ragioneSociale` è la ragione sociale del **dealer/PDV**, non del
cliente (un solo dealer mappa a molti clienti), quindi NON usarlo come nome
cliente. L'unico segnale presente è la parte locale dell'email del cliente
(es. `BLUESHARKSRL@modaroma.it` → "BLUESHARKSRL"), ma non è separabile in
parole ("BLUE SHARK SRL").

**Come applicare:** per i clienti azienda proponi la ragione sociale via
`suggestRagioneSocialeFromEmail` (scarta alias generici info/amministrazione/
pec…, toglie cifre finali, UPPERCASE) e lascia che l'operatore la corregga a
mano. Normalizza SEMPRE i campi testuali BiSuite con un `norm` (blank/whitespace
⇒ null) prima del fallback con `??`, altrimenti una stringa vuota blocca il
fallback. I valori manuali si proteggono dal reconcile con un flag `*Manual` +
upsert `CASE WHEN flag THEN col ELSE excluded.col END`.
