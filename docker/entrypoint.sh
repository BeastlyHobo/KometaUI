#!/bin/sh
set -eu

PORT="${PORT:-6161}"

exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
