# Review 015 — CONFIG_AUDIT writer made private

**Date:** 2026-09-30
**Type:** Security fix (server code, one rename). Closes `reviews/014` §6 finding 2.

## 1. Problem

`_cfg_writeAudit(area, entityId, action, previousValue, newValue,
effectiveFrom, effectiveTo, reason, version, actor, deferFlush)` in
`SVMKPI_CONFIG.gs` had a leading underscore only. Apps Script hides just
functions whose name **ends** in `_` from `google.script.run`, so any user
who had loaded the portal could call it directly, append `CONFIG_AUDIT`
rows, and choose the `actor`. That undermines the audit log D-009/D-023
rely on as a trustworthy record.

## 2. Fix

Renamed to `_cfg_writeAudit_` (private). Every caller was internal
(`cfg_createConfiguration`, `_cfg_setStatus`, `cfg_rollbackConfiguration`,
`finalizeReport`, `supersedeReportSnapshot`) and already derives the actor
from `sl_getCurrentUser()` — none took it from a client. No portal call,
test, or behavior changed. Note: `_identity_writeAudit_` was already
private.

## 3. Scope check — what else is reachable

Scanned all public functions with a leading `_` that mutate state
(`appendRow`, `setValues`, `clear*`, `insertSheet`, …). Besides the audit
writer, the rest either take a Sheet object (cannot be passed over RPC),
are gated (`_cfg_setStatus`), or only lazily create an empty header-only
sheet (`_cfg_ensureSheet`, `_cfg_ensureAuditSheet`,
`_store_ensureUnmappedSheet`). Those were left as is (no rename churn);
they cannot forge or alter data.

## 4. Tests

New `SVMI_Project/tests/audit-rpc-exposure.test.js` (8 assertions, written
first and confirmed failing): no public audit-writer name exists; all
references use the private name; no public function writes config audit
rows without a gate; and a real `cfg_createConfiguration()` still writes
exactly one audit row attributed to the server-side identity. Full suite:
**30 files, 1644 assertions, 0 failures** (`TZ=UTC`).

## 5. Not verified / remaining

Not deployed (no clasp credential in this session; test-copy deploy only
when the owner asks). Not exercised against a live Sheet.
