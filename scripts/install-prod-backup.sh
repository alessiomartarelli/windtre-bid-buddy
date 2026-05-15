#!/usr/bin/env bash
# Install / refresh the daily DB backup on the prod VPS (Task #153).
#
# Idempotent: re-running this script overwrites the script on the VPS,
# rewrites /etc/incentive-w3-backup.env (PGPASSWORD), and ensures the
# crontab entry exists exactly once.
#
# Requirements: VPS_PASSWORD env var, sshpass, ssh, scp.
# NEVER touches pm2 id 9 (easycashflows) or id 12 (protecta).
set -euo pipefail

VPS_HOST="85.215.124.207"
VPS_USER="root"
SCRIPT_SRC="$(dirname "$0")/incentive-w3-backup.sh"
SCRIPT_DST="/usr/local/bin/incentive-w3-backup.sh"
ENV_FILE="/etc/incentive-w3-backup.env"
CRON_LINE="30 3 * * * ${SCRIPT_DST}"

if [[ -z "${VPS_PASSWORD:-}" ]]; then
  echo "ERROR: VPS_PASSWORD env var is required" >&2
  exit 1
fi

SSH="sshpass -p ${VPS_PASSWORD} ssh -o StrictHostKeyChecking=no ${VPS_USER}@${VPS_HOST}"
SCP="sshpass -p ${VPS_PASSWORD} scp -o StrictHostKeyChecking=no"

echo "==> [1/5] Reading prod DATABASE_URL to extract PGPASSWORD..."
PROD_DB_URL=$(${SSH} "grep -E 'DATABASE_URL' /var/www/incentive-w3/ecosystem.config.cjs | head -1 | sed -E \"s/.*'(postgresql:[^']+)'.*/\\1/\"")
if [[ -z "${PROD_DB_URL}" ]]; then
  echo "ERROR: could not read DATABASE_URL from VPS ecosystem.config.cjs" >&2
  exit 1
fi
PGPASS=$(echo "${PROD_DB_URL}" | sed -E 's#postgresql://[^:]+:([^@]+)@.*#\1#')

echo "==> [2/5] Uploading backup script to ${SCRIPT_DST}..."
${SCP} "${SCRIPT_SRC}" "${VPS_USER}@${VPS_HOST}:${SCRIPT_DST}"
${SSH} "chmod 700 ${SCRIPT_DST}"

echo "==> [3/5] Writing ${ENV_FILE} (mode 600)..."
${SSH} "umask 077 && printf 'PGPASSWORD=%s\n' '${PGPASS}' > ${ENV_FILE} && chmod 600 ${ENV_FILE}"

echo "==> [4/5] Ensuring backup dir /var/backups/incentive-w3 exists..."
${SSH} "mkdir -p /var/backups/incentive-w3 && chmod 700 /var/backups/incentive-w3"

echo "==> [5/5] Installing crontab entry (idempotent)..."
${SSH} "(crontab -l 2>/dev/null | grep -v 'incentive-w3-backup.sh'; echo '${CRON_LINE}') | crontab - && crontab -l | grep incentive-w3-backup.sh"

echo "==> Done. Run one verification dump with:"
echo "    sshpass -p \$VPS_PASSWORD ssh ${VPS_USER}@${VPS_HOST} ${SCRIPT_DST} && \\"
echo "    sshpass -p \$VPS_PASSWORD ssh ${VPS_USER}@${VPS_HOST} 'ls -lh /var/backups/incentive-w3/'"
