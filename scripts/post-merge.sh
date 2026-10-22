#!/usr/bin/env bash
set -euo pipefail

# Multiple merged tasks can trigger this script close together. Serialize the
# dependency and schema steps so concurrent npm/drizzle processes cannot collide.
lock_id="$(printf '%s' "$PWD" | sha256sum | awk '{print substr($1, 1, 16)}')"
lock_file="${TMPDIR:-/tmp}/replit-post-merge-${lock_id}.lock"
exec 9>"$lock_file"
echo "Waiting for the post-merge setup lock..."
flock 9
echo "Post-merge setup lock acquired."

dependency_fingerprint() {
  {
    sha256sum package.json package-lock.json
    node --version
    npm --version
  } | sha256sum | awk '{print $1}'
}

dependency_stamp="node_modules/.post-merge-dependencies.sha256"
current_fingerprint="$(dependency_fingerprint)"

if [[ -f "$dependency_stamp" ]] && [[ "$(<"$dependency_stamp")" == "$current_fingerprint" ]]; then
  echo "Dependencies unchanged; skipping npm install."
else
  npm install --prefer-offline --no-audit --no-fund
  dependency_fingerprint > "${dependency_stamp}.tmp"
  mv "${dependency_stamp}.tmp" "$dependency_stamp"
fi

npm run db:push
