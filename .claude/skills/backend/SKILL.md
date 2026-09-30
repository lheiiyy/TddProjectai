---
name: backend
description: How to write or change SVMI's server code — the Google Apps Script (.gs, V8) files in SVMI_Project/Apps Script that the portal calls over google.script.run. Use for any server function, validation, authorization check, sheet read/write, trigger, or error-handling change.
---

# Backend — Google Apps Script

There is no Node/Express/REST backend. The backend is 29 `.gs` files in
`SVMI_Project/Apps Script/`, bound to the SVMI Google Sheet, run on the
V8 runtime in time zone `Asia/Manila`, deployed with `clasp`. All files
share **one global scope** — a top-level name in any file is visible in
every file. Ownership of each file: `ARCHITECTURE.md` §4. Callable
surface and conventions: `API_CONTRACT.md`.

## Layering (keep it)

```
SVMI_PORTAL.html  →  public endpoint (prefix_verb)      ← gate + argument checks, envelope
                          ↓
                     domain/service helpers (_prefix_…_) ← business rules, validation
                          ↓
                     sheet access (_ensureSheet/_readAll, SHEET/COL constants, _getData)
```

- **Business logic never lives in the portal**, and endpoints stay thin:
  gate, validate, delegate, return.
- **Reuse the engines.** Configuration writes go through
  `cfg_createConfiguration()` / `_cfg_setStatus()` / rollback in
  `SVMKPI_CONFIG.gs` — never append to a `CONFIG_*` sheet directly. Area
  wrappers (`store_*`, `purpose_*`, `risk_*`, `cmp_*`, `kpi_*`) add
  domain rules on top. Visit data is read with `_getData()`
  (`SVMKPI_CORE.gs`), never a bespoke `MASTER_LOG` parse.
- **Cross-file calls that might not be loaded** (legacy-mirror sync) use
  `typeof fn === 'function'` soft-dispatch, as `_cfg_syncLegacyMirror()`
  does.

## Naming and visibility

- Every file uses a prefix: `sl_` (store lookup/access), `cfg_`,
  `store_`, `purpose_`, `risk_`, `cmp_`, `kpi_`, `portal_` (admin tool
  wrappers), `admin_` (admin reads), `settingsMigration_`,
  `_identity_…_`. New functions take their file's prefix.
- **Trailing underscore = private.** `google.script.run` cannot call
  `fnName_()`. A leading underscore alone does **not** hide a function:
  `_cfg_setStatus`, `_cfg_writeAudit`, and `_getData` are all public
  endpoints today. Every new helper that the portal doesn't call ends in
  `_`.
- Secrets are properties of an object (`_SL_SECRET_`), never top-level
  functions.
- Sheet names and column indices come from constants (`SHEET`, `COL`,
  `CFG_AUDIT_COL`, `IDENTITY_*_COL`) — no string or index literals.

## Authorization — first statement of every public function

| Operation | Gate |
|---|---|
| Admin tool, configuration write, snapshot finalize/supersede | `if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };` |
| Identity administration | `const auth = _identity_authorizeCurrentUser_(IDENTITY_PERMISSION.X); if (!auth.authorized) return { success: false, message: auth.reason };` |
| Acting on the caller's own identity | Resolve the caller server-side (`_identity_currentUserRecord_()`); never accept a user ID from the client for "self" operations |
| Guest-level read | No gate, but return only what any visitor may see |

The two authorization systems are intentionally independent (D-026) —
don't make one imply the other. MFA enforcement flows through both
(D-031/D-032) and is toggled by `IDENTITY_MFA_ENFORCED` (D-033); never
bypass it per function.

## Validation and input handling

- Treat every argument as untrusted: coerce with `String(x || '').trim()`
  and normalize names the way identity rules require (D-001, D-003).
  Brand/Region/Category are checked against the hardcoded lists in
  `SVMKPI_CORE.gs` (`APPROVED_BRANDS`, `APPROVED_REGIONS`,
  `APPROVED_CATEGORIES`; D-013). Stores, Visitors, and Purposes are
  checked against the current `CONFIG_*` versions, not a hardcoded list.
- Dates arrive as `'YYYY-MM-DD'`; parse sheet/user dates with the one
  shared parser, `_parseDateCell()` (`SVMKPI_CORE.gs`,
  `date-parsing.test.js`) — never `new Date(string)` inline, which
  ignores the script time zone. Years go through
  `normalizeReportingYear()`.
- Backdated effective dates need `options.backdateConfirmed` and a
  reason (Phase 1A behavior) — keep that contract for new areas.

## Writes, locking, and quotas

- `MASTER_LOG` appends run inside `LockService` (`processSubmissionAsync`)
  — keep any new shared-row write under a script lock. Configuration
  writes currently do not lock; don't make concurrency worse, and flag
  it if your change depends on it.
- Read a sheet once with `getValues()`, work in memory, write once with
  `setValues()`. Never call `getValue()`/`appendRow()` inside a loop over
  rows: that pattern caused the live "Exceeded maximum execution time"
  failures fixed by D-034/D-035 (6-minute execution limit).
- Bulk operations must suppress per-entity side effects (mirror rebuilds,
  validation re-reads) and do them once at the end (D-034/D-035).
- History is append-only: new version rows, new audit rows, superseding
  snapshots — never edit or delete a prior row (D-009).

## Errors and logging

- Mutations return the envelope (`API_CONTRACT.md` §3); catch expected
  failures and return `{ success: false, message }` in plain language.
- Reads may throw on unexpected failure; the portal's `callServer`
  failure handler shows the message.
- Menu handlers use `_adminError(context, e)`. Server logging is
  `Logger.log` / `console.error` (Stackdriver). Never log secrets, codes,
  TOTP values, or full request payloads containing personal data.
- Every configuration mutation writes `CONFIG_AUDIT` via
  `_cfg_writeAudit`; every identity mutation writes `IDENTITY_AUDIT` via
  `_identity_writeAudit_` (D-029). Keep the two domains separate (D-023).

## Before you finish

- Syntax-check every `.gs` (`testing` skill) and run the full suite.
- Update `API_CONTRACT.md` for any public-surface change and
  `ARCHITECTURE.md` §4 for a new file.
- Deploy only to the test copy, only when asked (`SVMI_Project/DEPLOY.md`).
  Changing `appsscript.json` web-app settings needs a **new deployment
  version**, not just `clasp push`.
