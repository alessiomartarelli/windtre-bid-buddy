---
name: Fault injection via header di test
description: Come forzare il fallimento di una transazione server per testare rollback+cleanup end-to-end
---

Per verificare end-to-end il ramo d'errore di una route che scrive in transazione (rollback totale + cleanup risorse tipo allegati su disco), un test che replica il cleanup da solo non prova nulla: il code review lo rifiuta.

**Regola:** aggiungi nella route un hook di fault injection gated su `process.env.NODE_ENV !== "production"` + header dedicato (es. `x-test-cdg-force-tx-fail: 1`) che inietta un dato invalido a livello DB (es. valore più lungo del varchar) così la VERA transazione fallisce dopo i passi già eseguiti.

**Why:** il test esercita esattamente il catch di produzione (risposta 5xx chiara, 0 righe scritte, file rimosso) senza mock; in produzione l'header è inerte.

**How to apply:** suite HTTP con signup/cookie da tests/helpers/uiTest.mjs; verifica file orfani leggendo la dir upload dell'org (`uploads/cdg/<orgId>`); aggiungi sempre la controprova senza header (richiesta identica → 201).
