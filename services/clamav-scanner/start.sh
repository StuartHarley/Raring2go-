#!/usr/bin/env sh
set -eu

CLAMD_PID=""
NODE_PID=""

terminate_children() {
  if [ -n "$CLAMD_PID" ]; then
    kill "$CLAMD_PID" 2>/dev/null || true
  fi

  if [ -n "$NODE_PID" ]; then
    kill "$NODE_PID" 2>/dev/null || true
  fi
}

handle_shutdown() {
  echo "Scanner container received shutdown signal"
  terminate_children
  exit 143
}

is_running() {
  kill -0 "$1" 2>/dev/null
}

trap handle_shutdown INT TERM

echo "Updating ClamAV definitions..."
freshclam || echo "freshclam update failed; clamd will use any bundled/cached definitions if available"

echo "ClamAV database directory:"
ls -la /var/lib/clamav || true

echo "Starting clamd..."
clamd --config-file=/etc/clamav/clamd.conf &
CLAMD_PID="$!"

if ! kill -0 "$CLAMD_PID" 2>/dev/null; then
  echo "clamd failed to start"
  exit 1
fi

echo "Starting Raring2go scanner service..."
node /app/services/clamav-scanner/dist/server.js &
NODE_PID="$!"

EXIT_CODE=0

while :; do
  if ! is_running "$CLAMD_PID"; then
    wait "$CLAMD_PID" || EXIT_CODE="$?"
    echo "clamd exited with code $EXIT_CODE"
    terminate_children
    wait "$NODE_PID" 2>/dev/null || true
    break
  fi

  if ! is_running "$NODE_PID"; then
    wait "$NODE_PID" || EXIT_CODE="$?"
    echo "Raring2go scanner service exited with code $EXIT_CODE"
    terminate_children
    wait "$CLAMD_PID" 2>/dev/null || true
    break
  fi

  sleep 1
done

echo "Scanner container process exited with code $EXIT_CODE"
exit "$EXIT_CODE"
