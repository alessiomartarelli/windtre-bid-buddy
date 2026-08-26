---
name: Guardia struttura organization_config
description: Il PUT generico di organization-config non è mai il canale per modifiche strutturali o sezioni sensibili gestite da endpoint dedicati
---

**Regola:** il PUT generico `/api/organization-config` non modifica mai la struttura per omissione o degradazione: re-inietta `puntiVendita`/`ragioniSociali` se omessi o non-array (tutti i ruoli) e rifiuta con 409 gli azzeramenti di massa dell'anagrafica (helper puri in `shared/strutturaGuard.ts`). Inoltre deve sempre preservare le sezioni sensibili gestite da endpoint admin dedicati, anche se il payload le omette o prova a sostituirle. Le modifiche strutturali vere passano dagli endpoint dedicati `/api/admin/struttura/*`.

**Why:** l'autosave debounced del Simulatore spinge l'intero stato wizard nel config; con PDV "scheletro" ha azzerato l'anagrafica di un'org in produzione. In un altro incidente, lo stesso replace integrale ha eliminato credenziali API cifrate perché il form non conosceva quella sezione; il recupero è avvenuto dal backup giornaliero.

**How to apply:** qualunque nuovo consumer che salva l'intero config (autosave, wizard, import) deve omettere le chiavi strutturali quando il suo stato non ha anagrafica reale. Ogni nuova sezione con endpoint dedicato (credenziali, token, trasporti) va aggiunta contestualmente all’elenco server delle chiavi preservate e coperta da test omissione + sovrascrittura.
