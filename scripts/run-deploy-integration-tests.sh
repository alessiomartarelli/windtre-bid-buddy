#!/usr/bin/env bash
# Orchestrate the dev-server / DB-backed test suites for the pre-deploy
# quality gate (Task #221).
#
# Le suite "pure" (typecheck, cj-timeline, cj-validity-gettone-parity,
# cj-export, incentivazione, cj-report) girano già nel cancello di
# deploy-prod.sh senza dipendenze esterne. Questo script chiude il buco di
# copertura lanciando ANCHE le suite che richiedono il dev server e/o il DB:
#   - cj-authz, admin-authz, cj-reconcile, cj-trigger-date,
#     inc-dashboard-authz, finplan        (richiedono il dev server)
#   - incentivazione-accessori-servizi     (richiede solo DATABASE_URL)
#   - cj-gettone-ui, inc-sort-ui, gara-weights-ui, home-landing-ui
#                                           (dev server + DB + chromium)
#
# Strategia:
#   1. Richiede DATABASE_URL. Le suite DB-backed seminano e ripuliscono i
#      propri dati nel DB di dev usando prefissi univoci, quindi è sicuro
#      riusare il DB di sviluppo: NON serve creare un DB separato e i dati
#      di test non restano sporchi (cleanup nei rispettivi suite).
#   2. Se l'app NON risponde già su localhost:5000, avvia `npm run dev` in
#      background in modo effimero, attende la readiness e si ricorda di
#      fermarla al termine. Se invece l'app è già su (workflow "Start
#      application" attivo), la riusa e NON la ferma.
#   3. Esegue le suite in sequenza; `set -e` ferma tutto al primo fallimento,
#      così non si pubblica codice che rompe questi percorsi critici.
#   4. Teardown pulito: ferma il dev server effimero SOLO se l'abbiamo
#      avviato noi (trap EXIT), insieme all'intero albero di processi.
#
# Variabili:
#   DATABASE_URL        (richiesta) DB su cui girano le suite DB-backed.
#   FINPLAN_BASE_URL    (opz.) override del base URL dell'app (def. :5000).
#   APP_READY_TIMEOUT   (opz.) secondi d'attesa per la readiness (def. 90).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_URL="${FINPLAN_BASE_URL:-http://localhost:5000}"
APP_LOG="/tmp/incentivew3-integration-app.log"
READY_TIMEOUT="${APP_READY_TIMEOUT:-90}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[integration-tests] ERROR: DATABASE_URL non impostata. Le suite" >&2
  echo "    DB-backed (reconcile, accessori-servizi, gettone-ui, ...) non" >&2
  echo "    possono girare. Esporta DATABASE_URL e riprova." >&2
  exit 1
fi

# L'app è raggiungibile? Probe sull'endpoint /api/auth/user (esiste sempre,
# risponde 401 se non autenticato): qualsiasi codice HTTP != 000 = "su".
is_up() {
  local code
  code=$(curl -sS -o /dev/null -w "%{http_code}" "${BASE_URL}/api/auth/user" 2>/dev/null || true)
  [[ -n "$code" && "$code" != "000" ]]
}

STARTED_APP=0
APP_PID=""

cleanup() {
  if [[ "$STARTED_APP" == "1" && -n "$APP_PID" ]]; then
    echo "[integration-tests] arresto del dev server effimero (pid $APP_PID) ..."
    # Termina l'intero albero (npm -> tsx -> node): prima i figli, poi il
    # capostipite; SIGKILL come fallback dopo una breve attesa.
    pkill -TERM -P "$APP_PID" 2>/dev/null || true
    kill -TERM "$APP_PID" 2>/dev/null || true
    sleep 2
    pkill -KILL -P "$APP_PID" 2>/dev/null || true
    kill -KILL "$APP_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if is_up; then
  echo "[integration-tests] app già raggiungibile su ${BASE_URL}: la riuso (no start/stop)."
else
  echo "[integration-tests] avvio 'npm run dev' in background (log: ${APP_LOG}) ..."
  npm run dev > "${APP_LOG}" 2>&1 &
  APP_PID=$!
  STARTED_APP=1
  echo "[integration-tests] attendo la readiness su ${BASE_URL} (fino a ${READY_TIMEOUT}s) ..."
  ready=0
  for ((i = 1; i <= READY_TIMEOUT; i++)); do
    if ! kill -0 "$APP_PID" 2>/dev/null; then
      echo "[integration-tests] ERROR: il dev server è uscito durante l'avvio. Ultimi log:" >&2
      tail -n 40 "${APP_LOG}" >&2 || true
      exit 1
    fi
    if is_up; then
      echo "[integration-tests] app pronta dopo ${i}s."
      ready=1
      break
    fi
    sleep 1
  done
  if [[ "$ready" != "1" ]]; then
    echo "[integration-tests] ERROR: app non raggiungibile dopo ${READY_TIMEOUT}s. Ultimi log:" >&2
    tail -n 40 "${APP_LOG}" >&2 || true
    exit 1
  fi
fi

# Ordine: prima le suite leggere (fail-fast veloce), poi la UI Playwright
# (la più lenta, ~25s) per ultima.
SUITES=(
  "run-customer-journey-authz-tests.sh"
  "run-admin-authz-tests.sh"
  "run-customer-journey-reconcile-tests.sh"
  "run-customer-journey-trigger-date-tests.sh"
  "run-incentivazione-dashboard-authz-tests.sh"
  "run-incentivazione-accessori-servizi-tests.sh"
  "run-finplan-tests.sh"
  "run-incentivazione-sort-ui-tests.sh"
  "run-customer-journey-gettone-ui-tests.sh"
  "run-gara-config-weights-ui-tests.sh"
  "run-home-landing-ui-tests.sh"
)

echo "[integration-tests] eseguo ${#SUITES[@]} suite dev-server/DB-backed ..."
for suite in "${SUITES[@]}"; do
  echo "[integration-tests] === ${suite} ==="
  bash "${SCRIPT_DIR}/${suite}"
done

echo "[integration-tests] tutte le suite dev-server/DB-backed sono passate."
