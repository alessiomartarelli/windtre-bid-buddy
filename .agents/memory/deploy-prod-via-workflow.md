---
name: Deploy prod via workflow temporaneo
description: Come eseguire scripts/deploy-prod.sh in modo affidabile nell'ambiente Replit nonostante i limiti del tool bash.
---

Per deployare in produzione (`scripts/deploy-prod.sh`, richiede `VPS_PASSWORD`) NON usare il tool `bash` direttamente.

**Why:** `npm run build` impiega più di 120s, che è il timeout massimo del tool bash. Inoltre i processi messi in background (`setsid &` ecc.) vengono terminati dall'ambiente (cleanup del cgroup quando il tool call finisce), quindi il deploy in background fallisce a metà.

**How to apply:**
1. Crea un workflow temporaneo (es. `deploy-prod-oneoff`) con command `bash scripts/deploy-prod.sh`, outputType `console`.
2. Attendi lo stato `finished` con getWorkflowStatus.
3. Leggi l'output completo da getWorkflowStatus.
4. Rimuovi il workflow temporaneo con removeWorkflow.

Lo script fa: build → tar → scp → sync schema sul DB prod via tunnel SSH (`drizzle-kit push`) PRIMA del restart → swap dist → `pm2 restart incentive-w3 --update-env`. Verifica a fine deploy che pm2 mostri solo `incentive-w3` riavviato e NON tocchi easycashflows/protecta/easystripe. Usa `SKIP_QUALITY_GATE=1` se le suite sono già passate (evita di rilanciare il cancello).

**Gotcha — limite workflow (10) e contatore stale:** `configureWorkflow` rifiuta nuovi workflow oltre 10 e il suo contatore può restare STALE (riporta "15/10" elencando workflow già rimossi) mentre `listWorkflows()` mostra il numero reale. Fix: `code_execution` con `restart: true` per azzerare la cache del notebook, poi riprova `configureWorkflow`.

**Gotcha — workflow vs validation:** `removeWorkflow(name)` rimuove ANCHE il validation command omonimo (registri collegati). Per liberare slot e poi ripristinare: i validation command si ri-registrano con `setValidationCommand` che NON è soggetto al limite di 10 workflow. Alcuni step (es. i test) esistono solo come validation command, non come workflow, quindi vanno ripristinati via `setValidationCommand`.
