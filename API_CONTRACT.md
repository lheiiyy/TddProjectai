# SVMI — API Contract

The server surface that `SVMI_PORTAL.html` depends on. SVMI has **no REST
or HTTP JSON API**: the client talks to the `.gs` files through Apps
Script's `google.script.run` RPC bridge, and the only HTTP entry points
are `doGet`/`doPost`, which serve HTML. See `ARCHITECTURE.md` §1–§4 for the
runtime model and file map, and `reviews/003-phase-1h-security-identity-audit.md`
§H for the full privileged-function inventory this file does not repeat.

Scope: `SVMI_Project/` only. `Hub_Project/` and `TLM_Project/` have their
own, unrelated entry points.

## 1. Transport

| Entry point | Where | What it does |
|---|---|---|
| `doGet(e)` / `doPost(e)` | `SVMKPI_ADMIN.gs` → `_handleWebAppRequest_()` | Compares `e.parameter.pw` to the guest password (`_SL_SECRET_.guestPassword()`). Match, or no password configured → renders `SVMI_PORTAL.html`; otherwise renders `SVMI_LOCK.html`. The lock form POSTs; GET `?pw=` is also accepted. |
| `google.script.run.<fn>(...)` | Any top-level function in any `.gs` file | Async RPC from the rendered portal. The portal wraps it in `callServer(fnName, args, onSuccess, onError)` (`SVMI_PORTAL.html`). |

Web App deployment: `executeAs: USER_ACCESSING`, `access: ANYONE`
(`appsscript.json`) — every call runs as the visitor's own Google account,
which is why `Session.getActiveUser()` is trustworthy and why every
visitor needs their own Sheet access.

## 2. Platform rules every endpoint obeys

- **Visibility.** A top-level function whose name ends in `_` is private
  and cannot be called over `google.script.run`. **Every other top-level
  function is a public endpoint** — including names that merely *start*
  with `_` (e.g. `_cfg_setStatus`). Today: 166 public functions, of which
  78 are referenced by the portal (§4). The other 89 are still callable
  by any client that has loaded the portal.
- **Secrets are never top-level functions.** They live as properties of
  a plain object (`_SL_SECRET_` in `SVMKPI_ACCESS.gs`), which
  `google.script.run` cannot dispatch to (`reviews/005` Finding 1).
- **Serializable values only.** Parameters and return values must be
  primitives, `null`, or plain objects/arrays of those. Never pass or
  return a `Date`, function, or DOM element — dates cross the bridge as
  strings.
- **Dates are `'YYYY-MM-DD'` strings**, interpreted in the script time
  zone (`Asia/Manila`, `appsscript.json`). Parameter names ending in
  `Str` (`effectiveFromStr`, `evaluationDateStr`, `dateStr`) are always
  this format. Reporting years are integers or numeric strings, run
  through `normalizeReportingYear()`.
- **Authorization is re-checked server-side on every call.** Hiding a
  button is never the boundary (`ARCHITECTURE.md` §2).

## 3. Result and error conventions

**Mutations** return an envelope and do not throw for expected failures:

```js
{ success: true,  message: '...', /* operation-specific fields */ }
{ success: false, message: 'Admin access required.' }   // or a validation reason
```

Operation-specific fields sit beside `success`/`message` (e.g.
`createdStoreIds`, `mapping`, `unmappedCount`, `createdNames`,
`alreadyMigrated`, `failed`, `userId`, `versionId`). Bulk operations
report per-item failures in a `failed` array rather than failing the
whole call silently (`settings-config-migration.test.js`).

**Reads** return the data object/array directly (or `null` for "not
found"). An unexpected server error surfaces as a thrown exception, which
`callServer` routes to its `onError(message)` callback.

**Messages** are shown to users verbatim — they must be plain,
non-technical, and never contain a secret, a stack trace, or another
user's data.

## 4. Endpoints used by the portal

Gate legend:
- **guest** — no check beyond reaching the portal (Google sign-in +
  guest password).
- **admin** — `sl_isAdmin()`: on the `SETTINGS!G` admin list, and MFA
  satisfied when enforcement is on (D-032; currently OFF for pilot, D-033).
- **admin (delegated)** — the function body delegates to an internal
  helper that performs the `sl_isAdmin()` check.
- **identity** — `_identity_authorizeCurrentUser_()` with a named
  permission: `ACTIVE` account + permission + MFA satisfied (D-031).
- **self** — acts only on the caller's own identity record.

### Visit submission — `INPUT_PORTAL.gs`
| Function | Gate | Contract |
|---|---|---|
| `getSidebarData()` | guest | Picker lists for the Input Portal, read from `CONFIG_*` (not `SETTINGS`) |
| `checkDuplicateVisit(payload)` | guest | Pre-submit duplicate check |
| `processSubmissionAsync(payload)` | guest | Appends to `MASTER_LOG` under `LockService`. `payload`: `{ dateVisited, store, brand, region, visitedBy, purpose, remarks }`. Envelope result; duplicate visitors are partially accepted (`DEPLOY.md` Phase 1B) |

### Access and legacy admin MFA — `SVMKPI_ACCESS.gs`
| Function | Gate | Contract |
|---|---|---|
| `sl_getCurrentUser()` | guest | Caller's email |
| `sl_isAdmin()` | guest | Boolean — also the server-side gate used everywhere else |
| `sl_getAdminMfaStatus()` | guest | Caller's legacy-admin MFA state |
| `enrollAdminMfa()` / `verifyAdminMfa(code)` | self | Legacy-admin TOTP bridge (D-032) |

### Admin → Tools — `SVMKPI_ADMIN.gs`
| Function | Gate | Contract |
|---|---|---|
| `portal_rebuildExecutiveSummary()`, `portal_rebuildStoreHealth()`, `portal_rebuildKPI2026()`, `portal_rebuildDataHeaders()`, `portal_rebuildStoreMaster()`, `portal_validateMasterLog()` | admin | Rebuild/validate report sheets; envelope result |

### Admin → Configuration reads — `SVMKPI_ADMIN_API.gs`
| Function | Gate | Contract |
|---|---|---|
| `admin_getAreaSchema(area)`, `admin_listConfigEntityIds(area)`, `admin_getConfigEntityDetail(area, entityId, dateStr)`, `admin_getRiskDetail(dateStr)`, `admin_listPurposes(dateStr)`, `admin_listComplianceCategories()`, `admin_listAllStores(dateStr)`, `admin_getSystemAreaInfo()` | guest | Read-only listings; `dateStr` resolves the version effective on that date |

### Configuration engine — `SVMKPI_CONFIG.gs` and area wrappers
`area` is one of `STORES`, `VISITORS`, `PURPOSES`, `RISK`, `COMPLIANCE`,
`KPI`, `SYSTEM`. Every write is a new version row plus a `CONFIG_AUDIT`
entry, never an edit (D-009). Backdated `effectiveFromStr` requires
`options.backdateConfirmed` and a reason.

| Function | Gate | Contract |
|---|---|---|
| `cfg_validateConfiguration(area, entityId, fields, effectiveFrom, effectiveTo, existingVersions)` | guest | Pure validation, no write |
| `cfg_createConfiguration(area, entityId, fields, effectiveFromStr, effectiveToStr, reason, options)` | admin | New version |
| `cfg_activateConfiguration(area, versionId, reason)`, `cfg_deactivateConfiguration(area, versionId, reason)` | admin (delegated) | Envelope status change |
| `cfg_rollbackConfiguration(area, entityId, targetVersionId, reason, effectiveFromStr, options)` | admin | Rollback = a new version copying the target's fields |
| `cfg_getAuditLog(area, entityId)` | guest | `CONFIG_AUDIT` rows |
| `store_create(fields, effectiveFromStr, reason, options, explicitStoreId)`, `store_update(storeId, fields, effectiveFromStr, reason, options)` | admin | Mints/updates `STR-<uuid>` identity (D-001) |
| `store_activate(storeId, reason, effectiveFromStr, options)`, `store_deactivate(...)` | admin (delegated) | |
| `purpose_create(purposeName, fields, effectiveFromStr, reason, options)`, `purpose_rollback(purposeName, targetVersionId, reason, effectiveFromStr, options)` | admin | No weight inheritance (D-010) |
| `risk_create(fields, effectiveFromStr, reason, options)`, `risk_rollback(targetVersionId, reason, effectiveFromStr, options)` | admin | Singleton `DEFAULT` |
| `cmp_create(category, fields, effectiveFromStr, reason, options)`, `cmp_rollback(category, targetVersionId, reason, effectiveFromStr, options)` | admin | |
| `kpi_create(kpiName, fields, effectiveFromStr, reason, options)`, `kpi_rollback(kpiName, targetVersionId, reason, effectiveFromStr, options)` | admin | Stored, not yet consumed by any calculation |
| `settingsMigration_runStores()`, `settingsMigration_runVisitors()`, `settingsMigration_runPurposes()` | admin | Idempotent one-time import; three separate calls by design (D-034) |

### Reports and store insight — `SVMKPI_REPORTS.gs`, `SVMKPI_REPORTING_YEAR.gs`, `SVMKPI_STORE_LOOKUP.gs`, `SVMKPI_CORE.gs`
| Function | Gate | Contract |
|---|---|---|
| `getExecutiveSummaryReport(year)` | guest | Computed from `MASTER_LOG` only, never the `EXECUTIVE SUMMARY` sheet (D-036). Returns `selectedYear`, `availableYears`, KPI/breakdown sections, and a per-visit `records` array |
| `getKPI2026Report(year)`, `getStoreHealthReport()` | guest | Read-only report JSON |
| `getAvailableReportingYears()`, `sl_getDataYear()` | guest | Data-derived years (D-008) |
| `sl_getStoreList()`, `sl_getStoreData(storeName)`, `sl_getBrandList()`, `sl_getStoreFormOptions()` | guest | Store Insights |
| `sl_getVisitedThisMonth(brandFilter, monthNumber, reportingYear)`, `sl_getComplianceGaps(brandFilter, monthNumber, reportingYear, evaluationDateStr)` | guest | Unvisited/compliance views. `sl_getVisitedThisMonth` returns rows that don't resolve to a current store in an `unmapped` bucket rather than dropping them |
| `validateMasterLog()` | guest | Read-only validation report |

### Report snapshots — `SVMKPI_REPORT_SNAPSHOT.gs`
| Function | Gate | Contract |
|---|---|---|
| `finalizeReport(year, evaluationDateStr, reason, options)` | admin | Freezes a year; a second finalize for the same year is rejected (D-009) |
| `supersedeReportSnapshot(year, previousSnapshotId, evaluationDateStr, reason, options)` | admin | Correction = new linked snapshot, never an edit |
| `getReportSnapshot(snapshotId)`, `getLatestFinalizedReportSnapshot(year)`, `listReportSnapshots(year)`, `getDraftReport(year, evaluationDateStr)` | guest | Reads |
| `regenerateReportSheet(year)` | **guest — see §6** | Rewrites the per-year presentation sheet from the latest finalized snapshot |

### Identity (Phase 1H-C) — `SVMKPI_IDENTITY_*.gs`
| Function | Gate | Contract |
|---|---|---|
| `registerUser(fullName, email, department)` | guest | Creates a `PENDING_VERIFICATION` account and emails a code (only its hash is stored) |
| `verifyRegistrationEmail(email, code)` | guest | Attempt-limited, expiring |
| `getCurrentUser()`, `getAccessState()` | self | `getAccessState()` → `{ status, accountStatus, isActive, mfaRequired, mfaEnrolled, mfaSatisfied, roles, permissions }`; roles/permissions empty unless active |
| `enrollMfa()`, `verifyMfa(code)` | self | Requires `ACTIVE`; `verifyMfa` is replay-protected per TOTP step |
| `listPendingRegistrations()`, `approveRegistration(userId)`, `rejectRegistration(userId, reason)`, `suspendAccount(userId, reason)`, `reactivateAccount(userId, reason)`, `disableAccount(userId, reason)`, `assignRole(userId, roleId, grant)`, `assignPermissions(userId, permissionKey, grant)`, `assignScope(userId, scopeType, scopeValue, grant)` | identity | Every change written to `IDENTITY_AUDIT` (D-029) |
| `identityAdmin_getUserDetail(userIdOrEmail)` | identity (checked in body) | |

## 5. Changing this contract

- **Additive by default.** Add an optional trailing parameter or a new
  result field rather than renaming, reordering, or removing. The portal
  calls functions by string name (`callServer('fnName', ...)`), so a
  rename breaks at runtime, not at parse time — search
  `SVMI_PORTAL.html` for the quoted name before changing one.
- **New server helpers are private** (trailing `_`) unless the portal
  must call them. A new public function must carry its own gate as its
  first statement — never rely on the caller having checked.
- **A breaking change** (removed/renamed function, changed parameter
  meaning, changed result shape the portal reads) needs a `DECISIONS.md`
  entry, a same-commit portal update, and a note in `PROJECT_STATUS.md`.
- `SVMI_Command_Center_Demo.html` has its own in-memory mock of these
  calls. It is not required to stay in sync (D-037 precedent), but any
  drift must be disclosed in `PROJECT_STATUS.md`, since the Playwright
  suites test the demo, not the real portal.
- Update this file in the same commit as the change.

## 6. Known contract issues (open — not fixed by the review that wrote this file)

Recorded by `reviews/014-claude-code-environment-setup.md`. (The public `_cfg_writeAudit` that review found is fixed — it is now the private `_cfg_writeAudit_`, `reviews/015`, `audit-rpc-exposure.test.js`.)


- `regenerateReportSheet(year)` clears and rewrites a sheet but has no
  `sl_isAdmin()` check, and is absent from `reviews/003`'s inventory. Its
  source is a frozen snapshot, so no data is lost — the same impact
  class as the rebuild engines `reviews/005` gated.
- 88 public functions the portal never calls are still RPC-reachable.
  `reviews/003` inventoried the privileged ones at the time; nothing
  re-audits new public functions automatically.
- Guest-tier reads (`cfg_getAuditLog`, `admin_*`) return data such as
  actor emails. Under `USER_ACCESSING` every visitor already has Sheet
  access, so this adds no exposure beyond the Sheet itself — but it means
  the Sheet's sharing, not this API, is the real read boundary.
