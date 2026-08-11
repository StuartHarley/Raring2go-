#!/usr/bin/env sh
set -eu

echo "Updating ClamAV definitions..."
freshclam || echo "freshclam update failed; clamd will use any bundled/cached definitions if available"

echo "Starting clamd..."
clamd --config-file=/etc/clamav/clamd.conf &

echo "Starting Raring2go scanner service..."
node /app/services/clamav-scanner/dist/server.js
