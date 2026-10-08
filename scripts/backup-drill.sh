#!/usr/bin/env bash
# Backup and restore drill for the LOCAL docker compose database.
#
# Proves, end to end, that a dump of the database can be restored and that the restored copy holds
# exactly the same rows: it dumps `raring2go`, restores into a scratch database, compares exact row
# counts for every table, then drops the scratch database. It never writes to the source database.
#
# Usage: scripts/backup-drill.sh
# For a hosted database (Neon, Railway) the same steps apply with that provider's dump/restore or
# point-in-time-restore tooling: see docs/BACKUP_RESTORE.md.
set -euo pipefail

SERVICE="${DRILL_SERVICE:-db}"
USER_NAME="${DRILL_DB_USER:-raring2go}"
SOURCE_DB="${DRILL_SOURCE_DB:-raring2go}"
SCRATCH_DB="raring2go_restore_drill"
DUMP_FILE="/tmp/raring2go-drill-$$.dump"

psql_in() { docker compose exec -T "$SERVICE" psql -U "$USER_NAME" -v ON_ERROR_STOP=1 -tA "$@"; }

counts() {
  # Exact counts (not planner estimates) for every user table, sorted so the output can be diffed.
  psql_in -d "$1" -c "
    SELECT table_name || '=' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;"
}

cleanup() {
  psql_in -d postgres -c "DROP DATABASE IF EXISTS ${SCRATCH_DB};" >/dev/null 2>&1 || true
  docker compose exec -T "$SERVICE" rm -f "$DUMP_FILE" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "1/5 Dumping ${SOURCE_DB} (custom format, includes schema and data)..."
started=$(date +%s)
docker compose exec -T "$SERVICE" pg_dump -U "$USER_NAME" -Fc -f "$DUMP_FILE" "$SOURCE_DB"
size=$(docker compose exec -T "$SERVICE" sh -c "wc -c < $DUMP_FILE" | tr -d '[:space:]')
echo "    dump written: ${size} bytes"

echo "2/5 Creating scratch database ${SCRATCH_DB}..."
psql_in -d postgres -c "DROP DATABASE IF EXISTS ${SCRATCH_DB};" >/dev/null
psql_in -d postgres -c "CREATE DATABASE ${SCRATCH_DB};" >/dev/null

echo "3/5 Restoring the dump into the scratch database..."
docker compose exec -T "$SERVICE" pg_restore -U "$USER_NAME" -d "$SCRATCH_DB" --no-owner --exit-on-error "$DUMP_FILE"
finished=$(date +%s)

echo "4/5 Comparing exact row counts, table by table..."
counts "$SOURCE_DB" >/tmp/drill-source.$$
counts "$SCRATCH_DB" >/tmp/drill-restored.$$
tables=$(wc -l </tmp/drill-source.$$ | tr -d '[:space:]')

if ! diff /tmp/drill-source.$$ /tmp/drill-restored.$$ >/tmp/drill-diff.$$; then
  echo "FAIL: restored database differs from the source:" >&2
  cat /tmp/drill-diff.$$ >&2
  rm -f /tmp/drill-source.$$ /tmp/drill-restored.$$ /tmp/drill-diff.$$
  exit 1
fi
rows=$(awk -F= '{sum += $2} END {print sum}' /tmp/drill-source.$$)
rm -f /tmp/drill-source.$$ /tmp/drill-restored.$$ /tmp/drill-diff.$$

echo "5/5 Checking constraints and migrations survived the restore..."
applied_source=$(psql_in -d "$SOURCE_DB" -c "SELECT count(*) FROM drizzle.__drizzle_migrations;")
applied_restored=$(psql_in -d "$SCRATCH_DB" -c "SELECT count(*) FROM drizzle.__drizzle_migrations;")
fks_source=$(psql_in -d "$SOURCE_DB" -c "SELECT count(*) FROM pg_constraint WHERE contype = 'f';")
fks_restored=$(psql_in -d "$SCRATCH_DB" -c "SELECT count(*) FROM pg_constraint WHERE contype = 'f';")
if [ "$applied_source" != "$applied_restored" ] || [ "$fks_source" != "$fks_restored" ]; then
  echo "FAIL: migrations (${applied_source} vs ${applied_restored}) or foreign keys (${fks_source} vs ${fks_restored}) differ." >&2
  exit 1
fi

echo
echo "PASS: ${tables} tables, ${rows} rows identical after restore; ${applied_restored} migrations and ${fks_restored} foreign keys preserved."
echo "      dump + restore took $((finished - started))s for ${size} bytes."
