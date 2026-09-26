#!/usr/bin/env bash
# database/scripts/setup_dev_db.sh
# One-time DEV bootstrap: creates the svmi_dev database (if missing),
# then applies database/scripts/create_roles.sql. Run as a PostgreSQL
# superuser. Never targets anything but the database named by
# SVMI_DEV_DB (default: svmi_dev) — there is no "prod" mode for this
# script at all; provisioning a production database is a separate,
# explicit, out-of-scope operation for this phase (see docs/05-environments.md).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

DB_NAME="${SVMI_DEV_DB:-svmi_dev}"

if ! psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1; then
  echo "[setup] creating database: $DB_NAME"
  createdb "$DB_NAME"
else
  echo "[setup] database already exists: $DB_NAME"
fi

echo "[setup] applying roles/grants to: $DB_NAME"
psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f scripts/create_roles.sql

echo "[setup] done. Next: SVMI_DB_ENV=dev PGDATABASE=$DB_NAME scripts/run_migrations.sh"
