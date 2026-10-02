# SVMI — Fix & Improve Plan

Last updated: 2026-10-02 · Working branch: `svmi/functional-fixes`
Rule for now: **functionality first.** Security is parked (except admin access).
Live backups (`live-backup-*`) are the safe fallback — never edited.

## Important: source of truth

`main`'s `Apps Script/` was **older than live**. This branch rebuilt
`Apps Script/` from `live-backup-20260930-pre-secfix/` (latest live backup,
incl. identity/MFA, MASTER_LOG Executive Summary, nav-perf fix) and applied
the changes below on top. `.clasp.json` now targets the **test copy**
(`1UU582…`) — it previously pointed at the **live** script (`1QHH…`).

Note: that backup was taken *before* the CONFIG_AUDIT security-fix deploy.
If anything was deployed to live after it, `clasp pull` the live script and
compare before pushing.

## 🔴 Fix

| # | Item | Status |
|---|------|--------|
| 1 | Compliance rule not switching after store category change | ✅ Test bug (UTC "today" + expired dates); app logic correct |
| 2 | Visitor config rollback crash | ✅ Same stale-date test bug |
| 3 | Wrong effective date in audit / migration | ✅ Test compared in UTC; data correct |
| 4 | "Visits This Month" table empty | ✅ Demo data had no visits early in month; test updated for live `{resolved, unmapped}` shape |
| 5 | Admin access | ✅ Code: added admin guard to `rebuildMasterLogHeaders`, `rebuildSettingsHeaders`, `regenerateReportSheet`. ⏳ **Verify on test copy** (see below) |

## 🟡 Improve

| # | Item | Status |
|---|------|--------|
| 6 | Reports Executive Summary from MASTER_LOG | ✅ Already on live (D-036/D-037). Added test (31 checks). Fixed leaderboard double-count when a name repeats in one row (`ANN\|ANN`) |
| 7 | Measure load speed on real data | 🟡 Timing logs added to 8 server functions — read `[SVMI PERF]` lines in Apps Script → Executions |
| 8 | Deployment setting mismatch | ✅ Docs now match live (`USER_DEPLOYING` + `ANYONE_ANONYMOUS`); manifest unchanged |
| 9 | Escaping in portal | ✅ Load-error message escaped; visitor colors sanitized |
| 10 | Project status doc | ✅ This file |

## ⏸️ Parked — security (after everything works)

- Server-side password check on every data function
- Guest password stored in browser localStorage
- Turn MFA enforcement on (`IDENTITY_MFA_ENFORCED`)
- Deployment setting itself (`USER_DEPLOYING` + anonymous) — see #5 check

## Test-copy checklist (Claude Code / deploy step)

1. Reports → Executive Summary loads; numbers look right for 2026
2. Unvisited / NAC, Store Insights, Visits This Month load
3. Executions → note `[SVMI PERF] … ms` for each screen (#7)
4. **#5:** open as a SETTINGS!G admin who is *not* the deployer — do System
   Tools work? With `USER_DEPLOYING`, likely only the deployer is seen as admin.
5. Submit one test visit through Input Portal

## Tests

21 files, 1,039 checks, all passing (`node tests/<file>.test.js`).
