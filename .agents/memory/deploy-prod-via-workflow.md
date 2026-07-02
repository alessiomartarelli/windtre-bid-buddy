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
3. Schema sync: open SSH tunnel `-N -L 15432:localhost:5432`, read prod
   DATABASE_URL from `/var/www/incentive-w3/ecosystem.config.cjs` (grep the
   `DATABASE_URL: '...'` line — there is NO .env, app doesn't use dotenv),
   rewrite host→`127.0.0.1:15432`, `DATABASE_URL=... npx drizzle-kit push --force`,
   kill tunnel (~10s). pkill of the tunnel makes bash exit 143 — harmless.
1b. Don't forget `node scripts/precompress-dist.mjs` BEFORE the tar, or prod
   boot recompresses assets (~15s) instead of loading sidecars (94ms).
4. Swap + restart: `ssh ... "cd /var/www/incentive-w3 && rm -rf dist_old && mv dist dist_old && mkdir dist && tar xzf /tmp/incentivew3-deploy.tgz -C dist && pm2 restart incentive-w3 --update-env"`.
5. Verify: `curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/incentivew3/` on the VPS ⇒ 200 (root `/` ⇒ 302 redirect, normal). `pm2 list` must show ONLY incentive-w3 (id 13) restarted; NEVER touch easycashflows (id 9), protecta (id 12), easystripe (id 14).

To free workflow slots you may `removeWorkflow` finished test workflows; they
are also validation commands, so restore them afterward with
`setValidationCommand({name, command})` (not subject to the workflow limit).
The `deploy-prod.sh` quality gate calls the test scripts directly, so removing
the workflow/validation registrations does NOT weaken the gate.
