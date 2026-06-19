---
name: Dev DB schema drift
description: Signup/login 500 "column does not exist" significa DB dev non sincronizzato; risolvi con db:push.
---

In ambiente di sviluppo il DB Postgres può restare indietro rispetto a
`shared/schema.ts` quando una nuova colonna viene aggiunta allo schema ma il
`drizzle-kit push` non è mai stato applicato in dev (es. colonna aggiunta da un
task agent il cui merge non ha rieseguito il push). Sintomo tipico: signup e
login rispondono `500` con `column "<nome>" does not exist`, e questo fa
fallire a cascata le suite di test che fanno signup (finplan-tests,
cj-authz-tests).

**Fix:** `npm run db:push` (drizzle-kit push) riallinea il DB dev. Non è
distruttivo per i dati esistenti in genere, ma controlla l'output.

**Why:** i test di validazione registrati dipendono da signup funzionante; una
drift di schema li fa fallire anche se la modifica in corso non c'entra nulla.

**How to apply:** prima di concludere un task, se la validazione fallisce per
`column ... does not exist`, lancia `db:push` e ri-esegui i workflow di test.
