#!/usr/bin/env bash
# Daily pg_dump of the incentive_w3 production DB.
# Installed by Task #153 on the prod VPS at /usr/local/bin/incentive-w3-backup.sh
# and triggered by root crontab `30 3 * * *`.
#
# Scoped to db `incentive_w3` ONLY: never touches the other DBs that share the
# same Postgres instance on the VPS (notably easycashflows pm2 id 9 and
# protecta pm2 id 12).
#
# Output: /var/backups/incentive-w3/incentive_w3_YYYYMMDD_HHMMSS.sql.gz
# Retention: RETENTION_DAYS days (default 7).
# Log: /var/backups/incentive-w3/backup.log
#
# To deploy/refresh on the VPS, run scripts/install-prod-backup.sh from a
# machine that has VPS_PASSWORD in env and sshpass installed.
set -euo pipefail

BACKUP_DIR="/var/backups/incentive-w3"
DB_NAME="incentive_w3"
DB_USER="incentive_w3"
DB_HOST="localhost"
DB_PORT="5432"
RETENTION_DAYS=7
TS="$(date +%Y%m%d_%H%M%S)"
OUT="${BACKUP_DIR}/${DB_NAME}_${TS}.sql.gz"
LOG="${BACKUP_DIR}/backup.log"

mkdir -p "${BACKUP_DIR}"

# PGPASSWORD is read from /etc/incentive-w3-backup.env (mode 600, root-only)
# so the secret is not embedded in this script. The env file defines
# PGPASSWORD=... and is sourced here.
if [ -r /etc/incentive-w3-backup.env ]; then
  # shellcheck disable=SC1091
  . /etc/incentive-w3-backup.env
fi

if [ -z "${PGPASSWORD:-}" ]; then
  echo "[$(date -Is)] ERROR: PGPASSWORD not set (expected in /etc/incentive-w3-backup.env)" >> "${LOG}"
  exit 1
fi

{
  echo "[$(date -Is)] starting pg_dump of ${DB_NAME} -> ${OUT}"
  PGPASSWORD="${PGPASSWORD}" pg_dump \
    -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" \
    --no-owner --no-privileges --format=plain "${DB_NAME}" \
    | gzip -9 > "${OUT}.tmp"
  mv "${OUT}.tmp" "${OUT}"
  SIZE=$(stat -c%s "${OUT}")
  echo "[$(date -Is)] dump complete, size=${SIZE} bytes"
  if [ "${SIZE}" -lt 1048576 ]; then
    echo "[$(date -Is)] WARNING: backup smaller than 1MB (${SIZE} bytes)" >&2
  fi
  # Retention: delete dumps older than RETENTION_DAYS
  find "${BACKUP_DIR}" -maxdepth 1 -name "${DB_NAME}_*.sql.gz" -type f -mtime +${RETENTION_DAYS} -print -delete
  echo "[$(date -Is)] done"
} >> "${LOG}" 2>&1
