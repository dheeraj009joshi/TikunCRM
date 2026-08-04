#!/usr/bin/env bash
# Production API start — keeps APScheduler (sheet sync, IMAP, reminders) alive.
# Use a single uvicorn worker so the in-process scheduler always has a leader.
set -euo pipefail

cd "$(dirname "$0")/.."

export APP_ENV="${APP_ENV:-production}"
export BACKGROUND_SCHEDULER_ENABLED="${BACKGROUND_SCHEDULER_ENABLED:-true}"

exec uvicorn app.main:app \
  --host "${HOST:-0.0.0.0}" \
  --port "${PORT:-8000}" \
  --workers 1
