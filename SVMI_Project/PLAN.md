# SVMI — Fix & Improve Plan

Last updated: 2026-10-02 · Working branch: `svmi/functional-fixes`
Rule for now: **functionality first.** Security is parked (except admin access).
Live backups (`live-backup-*`) are the safe fallback — never edited.

## 🔴 Fix

| # | Item | Status |
|---|------|--------|
| 1 | Compliance rule not switching after store category change | ✅ Done — test bug (UTC "today" + expired dates), app logic was correct |
| 2 | Visitor config rollback crash | ✅ Done — same stale-date test bug |
| 3 | Wrong effective date in audit / migration | ✅ Done — test compared in UTC, data was correct |
| 4 | "Visits This Month" table empty | ✅ Done — demo data had no visits early in the month; check live still |
| 5 | Admin access check (`sl_isAdmin()` + SETTINGS!G emails) | ⏳ To do — verify on live |

## 🟡 Improve

| # | Item | Status |
|---|------|--------|
| 6 | Reports Executive Summary reads MASTER_LOG directly | ✅ Done — new test added |
| 7 | Measure Unvisited/NAC, Reports, Store Insights speed on real data | 🟡 Timing logs added — deploy to test copy, read `[SVMI PERF]` in Executions |
| 8 | Deployment setting mismatch (`USER_ACCESSING` vs README "Execute as Me") | ⏳ To do — decide one |
| 9 | Escape visitor chip color + error messages in portal | ⏳ To do |
| 10 | Project status doc | ✅ This file |

## ⏸️ Parked — security (after everything works)

- Server-side password check on every data function
- Guest password stored in browser localStorage
- Turn MFA enforcement on (`IDENTITY_MFA_ENFORCED`) — live already in use, test first

## ⚠️ Before any deploy

`Apps Script/` is missing 7 files that exist on live:
`SVMKPI_IDENTITY_ACCESS / _ADMIN / _CORE / _MFA / _REGISTRATION`,
`SVMKPI_SETTINGS_MIGRATION`, `SVMKPI_VISITOR_CONFIG`.
`clasp push` deletes online files that aren't local — add these from
`live-backup-20260930-pre-secfix/` first, and push to the **test copy** only.

## Next steps

1. Add the 7 live files to `Apps Script/`
2. Push to test copy → check Reports numbers vs old sheet, read PERF logs (#7)
3. #5 admin check, #8 deploy setting, #9 escaping
4. Then deploy to live
