#!/usr/bin/env bash
# database/scripts/backup.sh
#
# Zero-cost-first backup: a plain `pg_dump -Fc` (PostgreSQL's own custom
# archive format) written to database/backups/. No cloud/paid dependency,
# no third-party tool — just the same libpq/PGDATABASE-style environment
# variables every other script in this directory uses (see
# run_migrations.sh's header), so this script never hardcodes a database
# name, dev OR prod.
#
# A backup produced by this script is NOT considered verified until
# restore.sh has actually restored it into a fresh database and
# validation has been re-run against the restored copy — see
# docs/04-backup-restore.md for the proof this phase requires.
#
# Usage:
#   PGDATABASE=svmi_dev PGHOST=localhost PGUSER=svmi_migrator \
#     database/scripts/backup.sh

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."   # -> database/

BACKUP_DIR="backups"
mkdir -p "$BACKUP_DIR"

if [[ -z "${PGDATABASE:-}" ]]; then
  echo "REFUSED: PGDATABASE must be set (the database to back up)." >&2
  exit 1
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="$BACKUP_DIR/${PGDATABASE}-${STAMP}.dump"

echo "[backup] database: $PGDATABASE  ->  $OUT_FILE"
pg_dump -Fc --no-owner --no-privileges -f "$OUT_FILE" "$PGDATABASE"

echo "[backup] done. size: $(du -h "$OUT_FILE" | cut -f1)"
echo "[backup] verify with: database/scripts/restore.sh $OUT_FILE <new-database-name>"
