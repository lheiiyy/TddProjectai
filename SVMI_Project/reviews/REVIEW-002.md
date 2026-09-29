# REVIEW-002 — Canonical Branch Assessment Baseline (Product-Owner-Confirmed)

**Type:** Investigation baseline record only. No code, architecture, or branch state was changed to produce this document.
**Status:** Confirmed by the Product Owner as the current investigation baseline. Superseded only by an explicit future decision.
**Supersedes:** Nothing. Complements `REVIEW-001.md` (SVMI Fix Checklist / Implementation Backlog).
**Full supporting evidence:** the multi-turn investigation chain in this session — Unmapped Store functional trace, live-deployment gap review (production script `1QHHyLl8...`), test-copy functional comparison (`1UU582...`, 19 versions), governance-record recovery from `origin/claude/svmi-svmi-migration-performance-fix`/`origin/claude/svmi-reports-source-of-truth`, and the full `main` vs. `claude/svmi-reports-source-of-truth` delta. This document records the conclusions the Product Owner confirmed from that chain; it does not repeat the full evidentiary detail already delivered in-session.

---

## Confirmed Current State

1. **`origin/claude/svmi-reports-source-of-truth`** (commit `c078be5`) is the most complete *documented* SVMI development line currently identified — full governance record (`PROJECT_STATUS.md`, `PROJECT_MEMORY.md`, `REQUIREMENTS.md`, `ARCHITECTURE.md`, `DATA_MODEL.md`, `DECISIONS.md`, `IMPLEMENTATION_LOG.md`, `TESTING_LOG.md`, `reviews/001`–`013`), 47 commits ahead of `main` in ways `main` never received.
2. **`main`** (commit `d70d4af`) is not obsolete. It uniquely contains substantial Phase 2A Location+Brand canonical-identity reconciliation, Visitor identity reconciliation, and Purpose/CAPAR reconciliation tooling (`database/dryrun/*.js`) that does not exist on the candidate branch.
3. **Neither branch is the unquestioned final source of truth.** Each holds real, non-overlapping work the other lacks. A reconciliation decision, not a default preference for either, is required.
4. **D-025 manifest drift is a verified fact; its mechanism is not.** Every commit ever made to `appsscript.json`, on both branches, sets `executeAs:"USER_ACCESSING"` / `access:"ANYONE"`. Both actually-deployed live Apps Script scripts (production `1QHHyLl8...` and test-copy `1UU582...`) run `executeAs:"USER_DEPLOYING"` / `access:"ANYONE_ANONYMOUS"` instead — confirmed by direct `clasp pull` against both, in isolated scratch directories, in this session. No commit, decision, or review anywhere in this repository's history authorizes or explains the live value. No `.claspignore` exists on either branch to mechanically account for it. How the drift happened remains unresolved; that it happened, and exactly what it is, does not.
5. **D-034/D-035** (Store/Visitor/Purpose migration performance and idempotency fixes) are `Settled`, **live-verified** against real production-scale data (230 real stores, 12 real visitors, 4 real purposes, on the test-copy) — currently the more mature implementation of that subsystem versus `main`'s unwired, not-re-run-safe `store_migrateFromSettings()`.
6. **D-036/D-037** (Reports-tab source-of-truth fix; Additional Purpose; Visit Detail Records; presentation simplification) are `Settled` and comprehensively covered by the unit/Playwright test suite (1378 assertions/27 files), but **explicitly not yet live-verified** against the deployed test-copy or real production data — a materially different maturity level than D-034/D-035.
7. **FIX-002** (Unmapped Store reconciliation) remains explicitly deferred — not by oversight, but by the Product Owner's own prior, on-the-record instruction (recorded in D-035's live-verification note) to leave the 12 real unmapped `CONFIG_UNMAPPED_STORES` entries untouched as "a separate historical reconciliation matter."
8. **FIX-014** (Unmapped Store reconciliation UI) remains paused pending the reference-branch decision below — implementing it now, against either branch alone, risks creating a third divergent implementation of the same feature.

## The Next Governance Decision

**Decision A — Reference Branch:** *Should `claude/svmi-reports-source-of-truth` become the reference branch for future SVMI planning and implementation?*

This decision gates Decisions B (deployment manifest/access model), C (whether the Phase 1H identity/MFA/RBAC architecture is retained as-is), and D (FIX-002/FIX-014 scheduling) — none of those can be answered independently of which branch's manifest, identity architecture, and migration code are actually being planned against. No other implementation or branch operation should proceed until Decision A is made.

---

## Record of This Session's Investigation Chain (for future reference)

In order performed, each read-only:
1. Full repository audit (`main`) — architecture, security, testing, PostgreSQL migration readiness.
2. SVMI Fix Checklist (`REVIEW-001.md`) — FIX-001 through FIX-034, cross-checked against user acceptance findings.
3. Unmapped Store workflow functional investigation (repository-only).
4. Live deployment verification — discovered the production script (`1QHHyLl8...`) is ~15 commits/6 phases behind `main`, with a manifest already diverging from what the repository commits (`ANYONE_ANONYMOUS`/`USER_DEPLOYING` vs. committed `ANYONE`/`USER_ACCESSING`).
5. Discovery of the test-copy script (`1UU582...`, 19 versions) via `DEPLOY.md`'s own (stale) push-target documentation and git history (`fb7d117`).
6. Functional comparison of Unmapped Store logic between `main` and the test-copy — confirmed byte-identical core logic, with the test-copy adding a real (if incomplete) invocation/awareness layer.
7. Discovery of 11 GitHub branches never fetched into this local clone, via `mcp__github__list_branches` — recovering `DECISIONS.md` (D-001–D-037), `reviews/001`–`013`, and the full governance-document set from `origin/claude/svmi-reports-source-of-truth`.
8. Full `main` vs. `claude/svmi-reports-source-of-truth` delta — 78 changed paths, categorized; resolution of the D-025 contradiction to "verified fact, unresolved mechanism."
9. This document — Product-Owner confirmation of the resulting baseline.

---

*No files were modified in the SVMI Apps Script project, no branch was checked out, merged, or altered, and no Google Sheet or Apps Script deployment was touched in the course of producing this record. This is a documentation-only addition to `main`.*
