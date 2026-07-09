# Deploy e gestione produzione (VPS)

Dettaglio operativo della produzione. La sintesi (VPS, path, PM2) resta in
`replit.md` → "Production Deployment".

## Ambiente

- **VPS**: 85.215.124.207 con Nginx reverse proxy, app su porta 3001.
- **Base Path**: `/mystoredesk` per assets e API (Task #274, rebrand
  MyStoreDesk). Il vecchio `/incentivew3` risponde con redirect 301 al
  percorso equivalente sotto `/mystoredesk`, sia via Nginx
  (`nginx-incentivew3.conf`) sia via Express (accessi diretti alla 3001).
- **Directory VPS**: `/var/www/incentive-w3/` (con trattino!). NON
  `/var/www/incentivew3/`.
- **PM2**: usa il **nome** `incentive-w3` (id storico 0, oggi 13 dopo un
  `pm2 delete`+`start` necessario per ricaricare env). Riferirsi sempre al
  nome, non all'id, perché può cambiare. NEVER toccare pm2 id 9
  (easycashflows), 12 (protecta) o 14 (easystripe).
- **Env vars di prod**: caricate da
  `/var/www/incentive-w3/ecosystem.config.cjs` (NON da `.env` — l'app non
  usa dotenv). Per modificarle: editare ecosystem +
  `pm2 delete incentive-w3 && pm2 start ecosystem.config.cjs && pm2 save`.
  Variabili presenti: `NODE_ENV`, `PORT=3001`, `DATABASE_URL`,
  `SESSION_SECRET`, `SMTP_SECRET_KEY` (chiave AES per cifrare password SMTP
  e `client_secret` BiSuite — **mai cambiarla**, altrimenti i segreti
  cifrati nel DB diventano illeggibili).
- **Mechanism**: client `BASE_PATH` constant + `apiUrl()` helper, server
  sub-app mounting, base href injection.

## Deploy

- **Script**: `scripts/deploy-prod.sh` (richiede `VPS_PASSWORD`). Lo
  script: quality gate (vedi sotto) → build → **precompressione asset**
  (`scripts/precompress-dist.mjs`, Task #243: genera sidecar `.gz`/`.br`
  accanto a ogni file compressibile di `dist/public` così il boot di prod
  li carica da disco invece di ricomprimere ~15s) → tar → scp → **sync
  schema sul DB di prod via tunnel SSH (`drizzle-kit push`) PRIMA del
  restart** → swap dist → `pm2 restart incentive-w3 --update-env`. Lo step
  di schema sync evita i 500 "column does not exist" che si presentavano
  quando il `db:push` post-merge in dev non veniva replicato in prod. Se i
  sidecar mancano (es. deploy manuale senza precompressione), il boot NON
  blocca: i file senza sidecar vengono compressi in background (warm-up
  asincrono) e il primo hit eventuale paga la compressione lazy.
- **Deploy manuale (fallback)**: `npm run build` →
  `node scripts/precompress-dist.mjs` →
  `tar czf /tmp/incentivew3-deploy.tgz -C dist public index.cjs` → scp →
  ssh: `cd /var/www/incentive-w3 && rm -rf dist_old && mv dist dist_old &&
  mkdir dist && tar xzf /tmp/incentivew3-deploy.tgz -C dist &&
  pm2 restart incentive-w3 --update-env`. Se il deploy include modifiche a
  `shared/schema.ts`, applica anche a mano le ALTER/CREATE sul DB prod
  (`PGPASSWORD=… psql -U incentive_w3 -d incentive_w3 -h localhost`).
- **Verifica post-deploy**: sul VPS
  `curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/mystoredesk/`
  ⇒ 200 (root `/` ⇒ 302 redirect, normale);
  `curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/incentivew3/`
  ⇒ 301 verso `/mystoredesk/`.
- **Nginx (solo se cambia la config)**: il blocco `location` dell'app è in
  `nginx-incentivew3.conf` (repo). Dopo averlo copiato sul VPS nel file
  incluso dal server block: `nginx -t && systemctl reload nginx`. Gli altri
  siti (easycashflows, protecta, easystripe) non vanno toccati.

## Quality gate pre-deploy

- **Step 1a — suite pure (Task #220)**: `scripts/deploy-prod.sh` esegue
  come primo step (prima di build/scp/restart) il type-check + le suite di
  test **pure** (senza dev server né DB): `run-typecheck.sh`,
  `run-customer-journey-timeline-tests.sh`,
  `run-customer-journey-validity-gettone-parity-tests.sh`,
  `run-customer-journey-export-tests.sh`, `run-incentivazione-tests.sh`,
  `run-customer-journey-report-tests.sh`, `run-telegram-report-tests.sh`.
  Se una qualsiasi fallisce (`set -e`) il deploy si ferma prima di toccare
  la prod.
- **Step 1b — suite integration (Task #221)**: subito dopo 1a lancia ANCHE
  le suite che richiedono il workflow "Start application" e/o
  `DATABASE_URL`. È orchestrato da
  `scripts/run-deploy-integration-tests.sh`, che: (1) richiede
  `DATABASE_URL` (riusa il DB di dev — ogni suite semina/pulisce i propri
  dati con prefissi univoci, quindi non serve un DB separato e non resta
  sporco); (2) se l'app NON risponde già su `localhost:5000` avvia
  `npm run dev` in background in modo **effimero**, attende la readiness
  (fino a `APP_READY_TIMEOUT`, default 90s) e la **ferma con teardown
  pulito dell'intero albero di processi** al termine (trap EXIT); se l'app
  è già su (workflow attivo) la **riusa e NON la ferma**; (3) esegue in
  sequenza `run-customer-journey-authz-tests.sh`,
  `run-admin-authz-tests.sh`, `run-customer-journey-reconcile-tests.sh`,
  `run-customer-journey-trigger-date-tests.sh`,
  `run-incentivazione-dashboard-authz-tests.sh`,
  `run-incentivazione-accessori-servizi-tests.sh`, `run-finplan-tests.sh`,
  `run-incentivazione-sort-ui-tests.sh` (Playwright),
  `run-customer-journey-gettone-ui-tests.sh` (Playwright + chromium di
  sistema, la più lenta, per ultima); al primo fallimento (`set -e`) il
  deploy si ferma.
- **Bypass**: `SKIP_QUALITY_GATE=1` salta TUTTO il cancello (1a + 1b);
  `SKIP_INTEGRATION_TESTS=1` salta SOLO lo step 1b tenendo le suite pure.
  Le suite restano lanciabili singolarmente via i rispettivi step di
  validation (vedi `docs/testing.md`).

## Cache anti-pagina-bianca (Task #230)

Il fallback SPA in `server/static.ts` serve `index.html` con
`Cache-Control: no-cache, no-store, must-revalidate` (gli asset hashati
`/assets/*` restano `immutable` 1 anno), così dopo un deploy il browser
ricarica sempre il manifest aggiornato e non punta a chunk rimossi. In più
`client/src/main.tsx` ascolta `vite:preloadError` e ricarica la pagina una
sola volta (flag sessionStorage) per le schede aperte prima del deploy.
Nginx fa da reverse proxy e inoltra questi header.

## Backup DB prod (Task #153)

Sorgenti in repo: `scripts/incentive-w3-backup.sh` (lo script che gira sul
VPS) e `scripts/install-prod-backup.sh` (deploy idempotente — richiede
`VPS_PASSWORD` + `sshpass`, carica lo script in
`/usr/local/bin/incentive-w3-backup.sh`, scrive
`/etc/incentive-w3-backup.env` mode 600 con `PGPASSWORD`, garantisce la
riga di crontab). Cron root `30 3 * * *` esegue `pg_dump` del **solo** db
`incentive_w3` (NON tocca easycashflows né protecta) in
`/var/backups/incentive-w3/incentive_w3_YYYYMMDD_HHMMSS.sql.gz` con
retention 7 giorni (`find -mtime +7 -delete`) e log su `backup.log`.
Verifica post-install eseguita Task #153: `ls -lh` mostra
`incentive_w3_20260515_152151.sql.gz` da 15M (ben >1MB), log
`dump complete, size=15457480 bytes` + `done`.

- Restore: `gunzip -c <file>.sql.gz | PGPASSWORD=… psql -U incentive_w3 -d <target> -h localhost`.
- Run manuale: `ssh root@85.215.124.207 /usr/local/bin/incentive-w3-backup.sh`.

## Rotazione log prod (Task #245)

Su prod `out.log` era arrivato a 8,8 GB (nessuna rotazione). Ora esiste
`/etc/logrotate.d/incentive-w3` (installato via
`scripts/install-prod-logrotate.sh`, idempotente, richiede `VPS_PASSWORD`
+ `sshpass`): daily, `maxsize 50M`, `rotate 7`, `compress` +
`delaycompress`, **`copytruncate`** (obbligatorio: pm2 tiene il fd aperto,
la rotazione per rename senza truncate lascerebbe pm2 a scrivere sul file
ruotato). Scoped SOLO su `/var/log/incentive-w3/*.log` — non tocca
easycashflows né protecta. Il timer di sistema `logrotate.timer` (daily,
mezzanotte UTC) applica la config. Il file da 8,8 GB è stato troncato in
sicurezza (`truncate -s 0`, fd pm2 intatto) salvando prima gli ultimi
20 MB compressi in `out.log.pre-task245-tail.gz`; disco da 24 GB a 15 GB
usati. Il logger API (`server/index.ts`) tronca già i body a 2000 char
(Task #239), quindi nessuna modifica al codice server.

- Rotazione forzata manuale:
  `ssh root@85.215.124.207 'logrotate -f /etc/logrotate.d/incentive-w3'`.
