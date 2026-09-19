#!/usr/bin/env bash
# database/scripts/restore.sh
#
# Restores a database/scripts/backup.sh dump into a NEW database (never
# overwrites an existing one — this script always creates the target
# database itself and refuses if it already exists), so running this is
# always a fresh, side-effect-free proof of the backup's integrity rather
# than a destructive in-place restore.
#
# This is how this phase PROVES a backup ("A backup that has never been
# restored is not considered verified") — see docs/04-backup-restore.md.
#
# Usage:
#   database/scripts/restore.sh <dump-file> <target-database-name>
#
# The connection host/port/user come from standard libpq environment
# variables (PGHOST/PGPORT/PGUSER/...), exactly as in every other script
# here; only the database name is a positional argument, since restoring
# always targets a NEW name distinct from PGDATABASE.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."   # -> database/

DUMP_FILE="${1:-}"
TARGET_DB="${2:-}"

if [[ -z "$DUMP_FILE" || -z "$TARGET_DB" ]]; then
  echo "Usage: $0 <dump-file> <target-database-name>" >&2
  exit 1
fi

if [[ ! -f "$DUMP_FILE" ]]; then
  echo "REFUSED: dump file not found: $DUMP_FILE" >&2
  exit 1
fi

if psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$TARGET_DB'" | grep -q 1; then
  echo "REFUSED: target database '$TARGET_DB' already exists. Restore always targets a brand-new database so it never overwrites live data — pick a different name." >&2
  exit 1
fi

echo "[restore] creating fresh database: $TARGET_DB"
createdb "$TARGET_DB"

echo "[restore] restoring $DUMP_FILE -> $TARGET_DB"
pg_restore -v --no-owner --no-privileges -d "$TARGET_DB" "$DUMP_FILE"

echo "[restore] done. Next: re-run validation against PGDATABASE=$TARGET_DB to prove integrity."
