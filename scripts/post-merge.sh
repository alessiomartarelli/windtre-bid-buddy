#!/usr/bin/env bash
set -euo pipefail

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
