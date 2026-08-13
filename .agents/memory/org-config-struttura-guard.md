---
name: Guardia struttura organization_config
description: Il PUT generico di organization-config non è mai il canale per modifiche strutturali; gli autosave wizard possono spingere PDV scheletro e distruggere l'anagrafica
---

**Regola:** il PUT generico `/api/organization-config` non modifica mai la struttura per omissione o degradazione: re-inietta `puntiVendita`/`ragioniSociali` se omessi o non-array (tutti i ruoli) e rifiuta con 409 gli azzeramenti di massa dell'anagrafica (helper puri in `shared/strutturaGuard.ts`). Le modifiche strutturali vere passano dagli endpoint dedicati `/api/admin/struttura/*`.

**Why:** l'autosave debounced del Simulatore spinge l'intero stato wizard nel config; con PDV "scheletro" (anagrafica vuota, id index-based `pdv-<i>-<rand>`) ha azzerato nome/codicePos/RS/cluster di tutti i PDV di un'org in produzione. La write-protection copriva solo i non-admin. I dati furono recuperati da una copia identica in un'altra org.

**How to apply:** qualunque nuovo consumer che salva l'intero config (autosave, wizard, import) deve omettere le chiavi strutturali quando il suo stato non ha anagrafica reale (lato client il Preventivatore usa `hasAnagrafica`). Se in produzione ricompaiono PDV con id index-based e campi vuoti, il sospettato è un autosave wizard.
