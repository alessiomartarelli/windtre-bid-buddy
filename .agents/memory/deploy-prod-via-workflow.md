---
name: Deploy prod (incentive-w3) — staged bash, not workflow
description: How to deploy to the prod VPS reliably given tool constraints
---

Deploy `incentive-w3` to the prod VPS by running `scripts/deploy-prod.sh`'s
steps **manually in separate bash calls**, each well under the 120s bash
timeout. Do NOT rely on a temporary workflow.

**Why:** 
- `configureWorkflow` is blocked by a stale server-side counter ("Workflow
  limit exceeded 16/10") that lists already-removed workflows. `restart:true`
  on the code notebook does NOT clear it. Even *updating* an existing workflow
  name trips it. So the "run deploy via temp workflow" trick is unreliable.
- The old fear that `npm run build` exceeds 120s is outdated — build is ~27s.
  The only reason the full `deploy-prod.sh` in one bash call times out is the
  cumulative network steps (scp + schema sync + restart), not the build.

**How to apply (staged, each its own bash call, using $VPS_PASSWORD env):**
1. Build + it also packs: `npm run build` then `tar czf /tmp/incentivew3-deploy.tgz -C dist public index.cjs` (~30s). dist has `index.cjs` + `public/`.
2. scp tarball to `root@85.215.124.207:/tmp/incentivew3-deploy.tgz` (~4s).
3. Schema sync — **OBBLIGATORIO, MAI saltarlo**, anche se "questo deploy non
   tocca il DB": il rischio è proprio dimenticare modifiche a shared/schema.ts
   merge-ate da altri task (è così che sono "sparite le vendite": colonna
   alias RS mai applicata a prod). Open SSH tunnel `-N -L 15432:localhost:5432`,
   read prod DATABASE_URL from `/var/www/incentive-w3/ecosystem.config.cjs`
   (grep the `DATABASE_URL: '...'` line — there is NO .env, app doesn't use
   dotenv), rewrite host→`127.0.0.1:15432`,
   `DATABASE_URL=... npx drizzle-kit push --force`, THEN
   `DATABASE_URL=... npx tsx scripts/verify-prod-schema.ts` (fails on any
   table/column the code expects but prod lacks — deploy must stop if it
   fails), kill tunnel (~10s). pkill of the tunnel makes bash exit 143 —
   harmless.
1b. Don't forget `node scripts/precompress-dist.mjs` BEFORE the tar, or prod
   boot recompresses assets (~15s) instead of loading sidecars (94ms).
4. Swap + restart: `ssh ... "cd /var/www/incentive-w3 && rm -rf dist_old && mv dist dist_old && mkdir dist && tar xzf /tmp/incentivew3-deploy.tgz -C dist && pm2 restart incentive-w3 --update-env"`.
5. Verify: `curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/mystoredesk/` on the VPS ⇒ 200 (root `/` ⇒ 302; old `/incentivew3/*` ⇒ 301 to `/mystoredesk/*`, both in Express and in Nginx). `pm2 list` must show ONLY incentive-w3 (id 15, era 13) restarted; NEVER touch easycashflows (id 9), protecta (id 12), easystripe (id 14).
5b. Nginx: le location `/mystoredesk` devono avere `client_max_body_size 50M;`
   (default 1M ⇒ 413 su salvataggi grandi tipo DRMS ~13MB, la richiesta muore
   in nginx e nei log app non appare nulla — cerca in
   /var/log/nginx/error.log "client intended to send too large body").
   Log app prod: /var/log/incentive-w3/{out,error}.log (non ~/.pm2/logs).
6. Public base path is `/mystoredesk` since the MyStoreDesk rebrand; the app's nginx `location` blocks live in BOTH `/etc/nginx/sites-enabled/incentive-w3` (IP vhost) and `/etc/nginx/sites-enabled/onetapp.it` — keep them in sync, `nginx -t && systemctl reload nginx`.

7. Drift watch: il server prod ricontrolla lo schema al boot e
   ogni giorno alle 07:00 Roma (server/schemaDriftScheduler.ts) e notifica su
   Telegram usando env `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` da
   ecosystem.config.cjs. FATTO (ago 2026): le chiavi sono già nell'env
   dell'app in ecosystem.config.cjs (backup in .bak-tg); dopo un
   `pm2 restart --update-env` i log mostrano "[schema-drift] OK". Se le
   chiavi spariscono ricompare il warning "non configurati" nei log pm2.

To free workflow slots you may `removeWorkflow` finished test workflows; they
are also validation commands, so restore them afterward with
`setValidationCommand({name, command})` (not subject to the workflow limit).
The `deploy-prod.sh` quality gate calls the test scripts directly, so removing
the workflow/validation registrations does NOT weaken the gate.
