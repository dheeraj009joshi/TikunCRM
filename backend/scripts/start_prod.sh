#!/usr/bin/env bash
# Production backend start (venv + gunicorn) — used on Azure VM (not Docker).
# Sheet sync / email sync / reminders require the in-process APScheduler.
#
# Usage (from repo root or backend/):
#   bash backend/scripts/start_prod.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$BACKEND_DIR/.." && pwd)"

cd "$BACKEND_DIR"

if [ -f "$BACKEND_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$BACKEND_DIR/.env"
  set +a
elif [ -f "$REPO_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
fi

# Force scheduler ON for this process (overrides a copied local .env that disables it)
export BACKGROUND_SCHEDULER_ENABLED="${BACKGROUND_SCHEDULER_ENABLED:-true}"
export APP_ENV="${APP_ENV:-production}"

if [ "${BACKGROUND_SCHEDULER_ENABLED}" != "true" ] && [ "${BACKGROUND_SCHEDULER_ENABLED}" != "1" ]; then
  echo "ERROR: BACKGROUND_SCHEDULER_ENABLED must be true in production or Google Sheets will not auto-sync."
  echo "       Current value: ${BACKGROUND_SCHEDULER_ENABLED}"
  exit 1
fi

VENV_PY="${BACKEND_DIR}/venv/bin/python3"
GUNICORN_BIN="${BACKEND_DIR}/venv/bin/gunicorn"

if [ ! -x "$GUNICORN_BIN" ]; then
  echo "ERROR: gunicorn not found at $GUNICORN_BIN"
  exit 1
fi

# IMPORTANT: -w 1 so APScheduler runs in this process reliably.
# (Multi-worker gunicorn often leaves sheet sync stuck at "1 day ago".)
exec "$GUNICORN_BIN" \
  -k uvicorn.workers.UvicornWorker \
  -w 1 \
  -b 0.0.0.0:8000 \
  --timeout 120 \
  --graceful-timeout 30 \
  --access-logfile - \
  --error-logfile - \
  app.main:app
