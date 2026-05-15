#!/usr/bin/env bash
set -euo pipefail

# Deploy incentive-w3 to production VPS.
#
# Steps:
#   1. Build the bundle locally (npm run build)
#   2. Pack dist/public + dist/index.cjs into a tarball
#   3. scp the tarball to the VPS
#   4. Sync the production DB schema (drizzle-kit push) via SSH tunnel,
#      using the prod DATABASE_URL read from /var/www/incentive-w3/.env
#      BEFORE swapping the new bundle in. This avoids the "column does
#      not exist" 500s that happen when the new code expects schema
#      changes that were never applied to prod.
#   5. Swap dist on the VPS and restart pm2 process named "incentive-w3"
#      ONLY (we use the name, not the numeric id, because the id can
#      change after a `pm2 delete`+`start`).
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

echo "==> [1/5] Building bundle..."
npm run build

echo "==> [2/5] Packing tarball..."
# Copia il preload FinPlan (server-only, fuori da public/) dentro dist/server-data
# così il tar lo include senza esporlo via Nginx. Il resolver lato server
# (`_resolvePreloadPath` in server/routes.ts) cerca in `dist/server-data/`
# in produzione.
rm -rf dist/server-data
mkdir -p dist/server-data
cp server/data/finplan-preload.json dist/server-data/finplan-preload.json
tar czf "${LOCAL_TAR}" -C dist public index.cjs server-data

echo "==> [3/5] Uploading tarball to VPS..."
${SCP} "${LOCAL_TAR}" "${VPS_USER}@${VPS_HOST}:/tmp/incentivew3-deploy.tgz"

echo "==> [4/5] Syncing prod DB schema via SSH tunnel..."
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

echo "==> [5/5] Swapping bundle and restarting pm2 ${PM2_NAME}..."
${SSH} "cd ${VPS_DIR} && rm -rf dist_old && mv dist dist_old && mkdir dist && tar xzf /tmp/incentivew3-deploy.tgz -C dist && pm2 restart ${PM2_NAME} --update-env"

echo "==> Done. Verifying pm2 status..."
${SSH} "pm2 list"
