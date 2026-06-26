#!/usr/bin/env bash
set -euo pipefail

# Deploy incentive-w3 to production VPS.
#
# Steps:
#   1. Quality gate: type-check (npx tsc --noEmit) + the fast PURE test
#      suites (no dev server / no DB). Aborts the deploy if any fails, so
#      we never publish code with type errors or pure-logic regressions.
#   2. Build the bundle locally (npm run build)
#   3. Pack dist/public + dist/index.cjs into a tarball
#   4. scp the tarball to the VPS
#   5. Sync the production DB schema (drizzle-kit push) via SSH tunnel,
#      using the prod DATABASE_URL read from /var/www/incentive-w3/.env
#      BEFORE swapping the new bundle in. This avoids the "column does
#      not exist" 500s that happen when the new code expects schema
#      changes that were never applied to prod.
#   6. Swap dist on the VPS and restart pm2 process named "incentive-w3"
#      ONLY (we use the name, not the numeric id, because the id can
#      change after a `pm2 delete`+`start`).
#
# The quality gate runs ONLY the pure suites (typecheck, cj-timeline,
# cj-validity-gettone-parity, cj-export, incentivazione, cj-report) because
# they need neither the dev server nor the DB, so they run unattended in a
# couple of seconds. The dev-server / DB-backed suites (authz, reconcile,
# gettone-ui, finplan, accessori-servizi, dashboard-authz, trigger-date)
# are NOT run here — they require the "Start application" workflow and/or
# DATABASE_URL. Set SKIP_QUALITY_GATE=1 to bypass the gate in an emergency.
#
# Requirements: VPS_PASSWORD env var, sshpass, scp, ssh, npx.
# NEVER touches pm2 id 9 (easycashflows) or id 12 (protecta).

VPS_HOST="85.215.124.207"
VPS_USER="root"
VPS_DIR="/var/www/incentive-w3"
PM2_NAME="incentive-w3"
LOCAL_TAR="/tmp/incentivew3-deploy.tgz"
TUNNEL_PORT="15432"

if [[ -z "${VPS_PASSWORD:-}" ]]; then
  echo "ERROR: VPS_PASSWORD env var is required" >&2
  exit 1
fi

SSH="sshpass -p ${VPS_PASSWORD} ssh -o StrictHostKeyChecking=no ${VPS_USER}@${VPS_HOST}"
SCP="sshpass -p ${VPS_PASSWORD} scp -o StrictHostKeyChecking=no"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SKIP_QUALITY_GATE:-0}" == "1" ]]; then
  echo "==> [1/6] Quality gate SKIPPED (SKIP_QUALITY_GATE=1)."
else
  echo "==> [1/6] Quality gate: type-check + pure test suites..."
  # Each step exits non-zero on failure; `set -e` aborts the whole deploy.
  QUALITY_STEPS=(
    "run-typecheck.sh"
    "run-customer-journey-timeline-tests.sh"
    "run-customer-journey-validity-gettone-parity-tests.sh"
    "run-customer-journey-export-tests.sh"
    "run-incentivazione-tests.sh"
    "run-customer-journey-report-tests.sh"
  )
  for step in "${QUALITY_STEPS[@]}"; do
    echo "    -> ${step}"
    bash "${SCRIPT_DIR}/${step}"
  done
  echo "==> [1/6] Quality gate passed."
fi

echo "==> [2/6] Building bundle..."
npm run build

echo "==> [3/6] Packing tarball..."
# Task #148: niente più preload FinPlan server-side, il tar contiene solo
# `dist/public` e `dist/index.cjs`. La directory `dist/server-data` non
# viene più creata; rimuoviamo eventuali residui da deploy precedenti.
rm -rf dist/server-data
tar czf "${LOCAL_TAR}" -C dist public index.cjs

echo "==> [4/6] Uploading tarball to VPS..."
${SCP} "${LOCAL_TAR}" "${VPS_USER}@${VPS_HOST}:/tmp/incentivew3-deploy.tgz"

echo "==> [5/6] Syncing prod DB schema via SSH tunnel..."
# Read prod DATABASE_URL from VPS .env, rewrite host:port to localhost:TUNNEL_PORT
PROD_DB_URL=$(${SSH} "grep -E '^DATABASE_URL=' ${VPS_DIR}/.env | head -1 | sed 's/^DATABASE_URL=//'")
if [[ -z "${PROD_DB_URL}" ]]; then
  echo "ERROR: could not read DATABASE_URL from ${VPS_DIR}/.env" >&2
  exit 1
fi
TUNNELED_DB_URL=$(echo "${PROD_DB_URL}" | sed -E "s#@[^/]+/#@127.0.0.1:${TUNNEL_PORT}/#")

# Open SSH tunnel in background: local TUNNEL_PORT -> VPS localhost:5432
sshpass -p "${VPS_PASSWORD}" ssh -o StrictHostKeyChecking=no \
  -o ExitOnForwardFailure=yes \
  -N -L "${TUNNEL_PORT}:localhost:5432" \
  "${VPS_USER}@${VPS_HOST}" &
TUNNEL_PID=$!
trap "kill ${TUNNEL_PID} 2>/dev/null || true" EXIT

# Wait for tunnel to come up
for i in 1 2 3 4 5 6 7 8 9 10; do
  if (echo > /dev/tcp/127.0.0.1/${TUNNEL_PORT}) 2>/dev/null; then
    break
  fi
  sleep 1
done

# Run drizzle-kit push against prod DB (additive changes apply automatically;
# any destructive prompt aborts so prod data stays safe).
DATABASE_URL="${TUNNELED_DB_URL}" npx drizzle-kit push

# Close tunnel
kill ${TUNNEL_PID} 2>/dev/null || true
trap - EXIT

echo "==> [6/6] Swapping bundle and restarting pm2 ${PM2_NAME}..."
${SSH} "cd ${VPS_DIR} && rm -rf dist_old && mv dist dist_old && mkdir dist && tar xzf /tmp/incentivew3-deploy.tgz -C dist && pm2 restart ${PM2_NAME} --update-env"

echo "==> Done. Verifying pm2 status..."
${SSH} "pm2 list"
