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

Lo script fa: build → tar → scp → sync schema sul DB prod via tunnel SSH (`drizzle-kit push`) PRIMA del restart → swap dist → `pm2 restart incentive-w3 --update-env`. Verifica a fine deploy che pm2 mostri solo `incentive-w3` riavviato e NON tocchi easycashflows/protecta/easystripe.
