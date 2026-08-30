---
name: Guardia struttura organization_config
description: Il PUT generico di organization-config non è mai il canale per modifiche strutturali o sezioni sensibili gestite da endpoint dedicati
---

**Regola:** il PUT generico `/api/organization-config` non modifica mai l'anagrafica canonica: re-inietta `puntiVendita`/`ragioniSociali` se omessi o non-array e rifiuta con 409 aggiunte, rimozioni o rinomine di PDV/RS, anche quando il nuovo PDV è compilato. Può aggiornare solo impostazioni non anagrafiche (cluster, calendario, soglie). Inoltre deve preservare le sezioni sensibili gestite da endpoint admin dedicati. Le modifiche strutturali vere passano dagli endpoint strutturali admin di Gestione organizzazione o CdG, con validazione e storico.

**Why:** l'autosave debounced del Simulatore spinge l'intero stato wizard nel config. Ha causato sia l'azzeramento con PDV scheletro sia la sostituzione di 13 negozi reali con un solo PDV `TEST` interamente compilato (quindi invisibile alla vecchia guardia mass-blank). In un altro incidente, lo stesso replace integrale ha eliminato credenziali API cifrate perché il form non conosceva quella sezione.

**How to apply:** qualunque nuovo consumer generico può inviare la struttura solo identica nei campi id/codicePos/nome/ragioneSociale; le impostazioni secondarie possono cambiare. Ogni nuova sezione con endpoint dedicato (credenziali, token, trasporti) va aggiunta contestualmente all’elenco server delle chiavi preservate e coperta da test omissione + sovrascrittura.
