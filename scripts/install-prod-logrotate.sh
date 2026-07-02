#!/usr/bin/env bash
# Install / refresh log rotation for incentive-w3 on the prod VPS (Task #245).
#
# Idempotent: re-running this script rewrites /etc/logrotate.d/incentive-w3
# and verifies the config with `logrotate -d`.
#
# Rotation is handled by the system logrotate (daily systemd timer already
# active on the VPS). It is scoped to /var/log/incentive-w3/*.log only, so it
# NEVER touches pm2 id 9 (easycashflows) or id 12 (protecta), whose logs live
# elsewhere. `copytruncate` is required because pm2 keeps the log file
# descriptor open: rotating by rename without truncation would leave pm2
# writing to the rotated file forever.
#
# Requirements: VPS_PASSWORD env var, sshpass, ssh.
set -euo pipefail

VPS_HOST="85.215.124.207"
VPS_USER="root"
CONF_DST="/etc/logrotate.d/incentive-w3"

if [[ -z "${VPS_PASSWORD:-}" ]]; then
  echo "ERROR: VPS_PASSWORD env var is required" >&2
  exit 1
fi

SSH="sshpass -p ${VPS_PASSWORD} ssh -o StrictHostKeyChecking=no ${VPS_USER}@${VPS_HOST}"

echo "==> [1/3] Writing ${CONF_DST}..."
${SSH} "cat > ${CONF_DST} <<'EOF'
/var/log/incentive-w3/*.log {
    daily
    maxsize 50M
    rotate 7
    missingok
    notifempty
    compress
    delaycompress
    copytruncate
}
EOF
chmod 644 ${CONF_DST}"

echo "==> [2/3] Validating config with logrotate -d (dry run)..."
${SSH} "logrotate -d ${CONF_DST} 2>&1 | tail -20"

echo "==> [3/3] Current log sizes:"
${SSH} "ls -lh /var/log/incentive-w3/"

echo "==> Done. The system logrotate timer (daily) will pick up the config."
echo "    Force a rotation now with:"
echo "    sshpass -p \$VPS_PASSWORD ssh ${VPS_USER}@${VPS_HOST} 'logrotate -f ${CONF_DST}'"
