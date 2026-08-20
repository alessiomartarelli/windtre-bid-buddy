#!/usr/bin/env bash
set -euo pipefail

npm install --prefer-offline --no-audit --no-fund
npm run db:push
