#!/usr/bin/env sh
set -eu

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

wait -n "$CLAMD_PID" "$NODE_PID"
EXIT_CODE="$?"

echo "Scanner container process exited with code $EXIT_CODE"
exit "$EXIT_CODE"
