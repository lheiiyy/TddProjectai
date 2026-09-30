# Review 015 — CONFIG_AUDIT Writer Made Private (Production-Side Port)

**Date:** 2026-09-30
**Type:** Security fix, ported from a separate branch
(`claude/claude-code-environment-setup`, commit `2297d57`) onto this
branch — the branch production actually runs. Not a new finding; this
review records the port, not the discovery.

---

## 1. The vulnerability

`_cfg_writeAudit()` (`SVMKPI_CONFIG.gs`) had only a single leading
underscore. Apps Script's `google.script.run` exposes every top-level
function whose name does **not end** in an underscore to any client that
loaded the portal — a leading underscore is a naming convention, not a
privacy mechanism; only a **trailing** underscore keeps a function
server-only. `_cfg_writeAudit` therefore was, in practice, publicly
callable, and it takes `actor` as a plain argument rather than deriving
it itself. Any signed-in portal user could call it directly and append a
`CONFIG_AUDIT` row attributed to anyone — a forged audit trail entry,
not merely an unauthorized read.

## 2. The fix

Mechanical rename: `_cfg_writeAudit` → `_cfg_writeAudit_` (trailing
underscore) at its one definition and all 3 real call sites (all
internal, all already deriving `actor` server-side before calling it —
confirmed by reading each call site; none needed a code-shape change,
only the name). Two doc-comment references updated to match.

**Files changed:**
- `SVMI_Project/Apps Script/SVMKPI_CONFIG.gs` — the function definition
  and its 3 call sites (`cfg_createConfiguration`, `_cfg_setStatus`,
  `cfg_rollbackConfiguration`), plus 2 comments.
- `SVMI_Project/Apps Script/SVMKPI_REPORT_SNAPSHOT.gs` — 2 call sites
  (`finalizeReport`, `supersedeReportSnapshot`) plus 1 comment.
- `SVMI_Project/tests/audit-rpc-exposure.test.js` (new, 8 assertions) —
  ported verbatim from the source commit; it dynamically reads whichever
  `.gs` files are actually present rather than a hardcoded file list, so
  it required no adaptation to run against this branch's own file set.

**Not changed:** any business rule, validation, audit row shape,
Store ID, MASTER_LOG data, or deployment configuration. No other
function's behavior changes — this is a rename, not a logic change.

## 3. Why this needed porting rather than a direct merge

The fix originated on `claude/claude-code-environment-setup`, a branch
that forked from `claude/file-review-kvc56h` at the point PR #9
(`claude/svmi-reports-source-of-truth` as of D-036/D-037) was merged
into it — i.e., from a commit *before* this session's D-038 (Input
Portal load fix) and navigation-load-performance fix were pushed here.
The two branches have since diverged: this branch has 2 commits the
other lacks (the two fixes above), and the other branch has 2 commits
this one lacks (an unrelated environment/docs-tooling setup commit, and
this security fix). The source commit's diff also touched a parallel,
unrelated documentation tree (`PROJECT_STATUS.md`, `API_CONTRACT.md`,
`.claude/skills/`, `TESTING_LOG.md`, `IMPLEMENTATION_LOG.md`) that
belongs to that branch's own governance-doc convention and does not
exist here. Rather than merge the branches (which would pull in that
unrelated doc tree and an unreviewed environment-setup commit alongside
the fix), only the 3 code-relevant files were ported, verified to apply
cleanly against this branch's actual current content (confirmed
byte-for-byte identical context at every call site before editing).

## 4. Tests

`audit-rpc-exposure.test.js`: 8/8 passing against this branch's real
`.gs` sources, including the structural check that scans **every**
`.gs` file's top-level functions for any public function that writes to
`CONFIG_AUDIT` without an admin/identity gate — passed with zero
unexpected callers, confirming this branch's additional code (relative
to the source commit's branch) introduced no new exposure of this kind.

Full existing suite re-run: **28 files, 0 failures** (27 pre-existing +
this new one).

## 5. Live status

**Not yet deployed at the time this review was written.** Production
(`1QHHyLl8...`) was confirmed still running the unpatched, publicly
-callable `_cfg_writeAudit` at the start of this fix. See `DECISIONS.md`
for the deployment record once pushed.

---

## Confirmation

No validation rule, audit row shape, or business logic changed — this
is a visibility fix only (private vs. public naming), verified via a
dedicated structural test that would fail again if any future function
reintroduces a publicly-callable audit writer. Every existing test file
passes unmodified.
