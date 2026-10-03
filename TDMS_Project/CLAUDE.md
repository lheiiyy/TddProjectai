# TDMS - rules for Claude Code

Applies to everything under `TDMS_Project/`. Master plan: https://claude.ai/code/artifact/f89076cb-9986-4a8a-abe2-f0eb70d83dab

## Working with Leo

- Leo is the owner and approves every structural change, scoring rule and deploy. Plan -> approval -> build -> Leo reviews -> deploy.
- Reply in Taglish; write specs, docs and UI text in plain formal English.
- Leo is still learning Git: create the branch, commit and open the PR for him, and explain in one line what changed.
- Build working screens first; keep docs short. Ground fixes in the actual code and observed behaviour.
- Use the `tdms-module-planning` skill before building any new module.

## Architecture (do not break)

1. Layers: screens -> `api.js` -> services -> repository. Only the repository calls `SpreadsheetApp`. Screens never call `google.script.run` directly.
2. API function names and JSON shapes are a contract; they stay the same after migration to a REST API.
3. One tab = one table, snake_case headers, `id` primary key with a code-generated prefix (`EMP-000123`, `STR-0042`, `CAP-2026-0015`).
4. Links by ID only. One value per cell; lists go to child tables. No monthly or status tabs.
5. Dates `yyyy-mm-dd`, timestamps ISO 8601 UTC, percentages stored as numbers.
6. Enums come from the `lookups` table.
7. Audit columns on every table: `created_at`, `created_by`, `updated_at`, `updated_by`, `is_active`, `row_version`. Soft delete only. Every write logs to `audit_log`.
8. No formulas, merged cells or formatting in data tabs.
9. Writes: LockService + one batch write. Reads: paged (about 50 rows), lookups cached, dashboards read summary tables.
10. Role checks run on the server for every call. Restricted area (KPI monitoring, approvals, restricted files, admin settings) is for Training Supervisor, Training Manager, Senior Training Manager and System Admin only.
11. Table names must line up with `database/migrations/` (SVMI PostgreSQL schema); extend it, do not start a second schema.

## Safety

- Never write into a live legacy sheet (SVMI, TL Monitoring, CAPAR, PMS). Import from copies.
- `.clasp.json` in the repo points to the TEST copy. Deploy to live only when Leo says so, after a dated live backup.
- Never commit credentials, tokens or private sheet IDs; use Script Properties.
