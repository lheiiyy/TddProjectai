#!/usr/bin/env bash
# Exports v_cross_training_monthly as JSON for KPI-MONITORING-HUB
# (data/cross-training.json). Aggregates only — no staff names.
# Usage: PGHOST=... PGUSER=... PGDATABASE=... scripts/export_cross_training.sh > cross-training.json
set -euo pipefail
psql -X -A -t -v ON_ERROR_STOP=1 -c "
SELECT jsonb_pretty(jsonb_build_object(
  'generated_at', now(),
  'rows', coalesce(jsonb_agg(to_jsonb(v) ORDER BY month, brand), '[]'::jsonb)))
FROM v_cross_training_monthly v;"
