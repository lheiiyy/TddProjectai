#!/usr/bin/env bash
# database/scripts/run_migrations.sh
#
# Applies every un-applied file in database/migrations/, in filename
# order, tracked in the schema_migrations table (000_schema_migrations.sql)
# so re-running this script is idempotent — already-applied files are
# skipped, never re-executed. Every run is logged to
# database/scripts/logs/migrate-<timestamp>.log.
#
# SAFETY (per this phase's explicit "incapable of accidentally targeting
# production without an explicit production configuration" requirement):
#   - SVMI_DB_ENV must be set to exactly "dev" or "prod". Unset -> refuse.
#   - "prod" additionally requires SVMI_ALLOW_PROD_MIGRATION=yes-i-mean-it
#     or this script refuses. There is no default that ever targets prod.
#   - The actual PostgreSQL connection comes ENTIRELY from standard libpq
#     environment variables (PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD,
#     or PGSERVICE/a DATABASE_URL exported as PGDATABASE etc.) — this
#     script never hardcodes a host/database name, dev OR prod.
#
# Usage:
#   SVMI_DB_ENV=dev PGDATABASE=svmi_dev PGHOST=localhost PGUSER=svmi_app \
#     database/scripts/run_migrations.sh

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."   # -> database/
MIGRATIONS_DIR="migrations"
LOG_DIR="scripts/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/migrate-$(date -u +%Y%m%dT%H%M%SZ).log"

if [[ "${SVMI_DB_ENV:-}" != "dev" && "${SVMI_DB_ENV:-}" != "prod" ]]; then
  echo "REFUSED: SVMI_DB_ENV must be exactly 'dev' or 'prod' (got: '${SVMI_DB_ENV:-<unset>}')." >&2
  echo "This is a deliberate safety gate — see this script's header comment." >&2
  exit 1
fi

if [[ "$SVMI_DB_ENV" == "prod" && "${SVMI_ALLOW_PROD_MIGRATION:-}" != "yes-i-mean-it" ]]; then
  echo "REFUSED: SVMI_DB_ENV=prod requires SVMI_ALLOW_PROD_MIGRATION=yes-i-mean-it." >&2
  echo "This phase's own scope explicitly excludes a production cutover." >&2
  exit 1
fi

echo "[migrate] target env: $SVMI_DB_ENV  database: ${PGDATABASE:-<unset>}  host: ${PGHOST:-<unset>}" | tee -a "$LOG_FILE"

psql -v ON_ERROR_STOP=1 -q -f "$MIGRATIONS_DIR/000_schema_migrations.sql" 2>&1 | tee -a "$LOG_FILE"

applied=0
skipped=0
for f in $(ls "$MIGRATIONS_DIR"/*.sql | sort); do
  base="$(basename "$f")"
  [[ "$base" == "000_schema_migrations.sql" ]] && continue

  checksum="$(sha256sum "$f" | awk '{print $1}')"
  already="$(psql -tA -c "SELECT checksum FROM schema_migrations WHERE filename = '$base';" 2>>"$LOG_FILE" || true)"

  if [[ -n "$already" ]]; then
    if [[ "$already" != "$checksum" ]]; then
      echo "REFUSED: $base was already applied with a DIFFERENT checksum (it changed after being applied). Create a NEW migration file instead of editing an applied one." | tee -a "$LOG_FILE" >&2
      exit 1
    fi
    echo "[migrate] skip (already applied): $base" | tee -a "$LOG_FILE"
    skipped=$((skipped + 1))
    continue
  fi

  echo "[migrate] applying: $base" | tee -a "$LOG_FILE"
  psql -v ON_ERROR_STOP=1 -q -1 \
    -c "\\i $f" \
    -c "INSERT INTO schema_migrations (filename, checksum) VALUES ('$base', '$checksum');" \
    2>&1 | tee -a "$LOG_FILE"
  applied=$((applied + 1))
done

echo "[migrate] done. applied=$applied skipped=$skipped log=$LOG_FILE" | tee -a "$LOG_FILE"
