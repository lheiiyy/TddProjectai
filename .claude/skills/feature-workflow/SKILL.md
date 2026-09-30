---
name: feature-workflow
description: The required end-to-end workflow for any SVMI feature, bug fix, or behavior change — requirements through project-state update. Use before writing code for anything beyond a one-line fix; it produces a plan with affected files first, then implementation, tests, deployment notes, and the documentation updates this repo's phase/review process requires.
---

# Feature workflow

Run `project-context` first. Then work through these stages in order.
For a **non-trivial** change — more than one file, any new server
function, any sheet/schema change, anything touching auth, reporting
numbers, or `MASTER_LOG` — stop after stage 6 and present the plan to
the owner before implementing. A trivial fix (typo, one obvious
local bug with a test) may compress stages 2–6 into two sentences.

## Stages

1. **REQUIREMENTS** — Restate the ask in one paragraph. Name what is
   out of scope. Check `REQUIREMENTS.md` §4 and `PROJECT_STATUS.md`
   "deferred": if it's listed, confirm with the owner. Ambiguous and
   expensive → ask before building.
2. **CODEBASE ANALYSIS** — Trace the current path end to end: portal
   tab/render function → `callServer('fn', …)` → `.gs` function → sheet.
   List what already exists and will be reused. Record surprises (a
   pre-existing bug, a doc that's wrong) rather than silently fixing
   them outside scope.
3. **ARCHITECTURE IMPACT** — Which `.gs` file owns this (`ARCHITECTURE.md`
   §4)? Does it respect the single-path rules (D-005, D-006, D-036) and
   the live/DEV split (Postgres is DEV-only, D-011)? A new cross-file
   concept or a change to a settled decision needs a `DECISIONS.md` entry.
4. **DATA MODEL IMPACT** — New/changed sheet columns or `CONFIG_*`
   fields? Follow the `database` skill. Additive only; history is never
   rewritten. If a Postgres mirror exists for that sheet, plan the
   matching new migration.
5. **API DESIGN** — New or changed `google.script.run` functions: name
   with the file's prefix, gate as the first statement, envelope result
   for mutations, string dates. Follow the `backend` skill and update
   `API_CONTRACT.md`.
6. **UI DESIGN** — Which tab/sub-tab; loading/empty/error states; phone
   width. Follow the `frontend` skill. Say whether
   `SVMI_Command_Center_Demo.html` will be updated or deliberately left
   out of sync (and disclose which).

   **→ Plan checkpoint.** Present: objective, affected files (explicit
   list), reused helpers, decisions touched, test plan, and deploy
   impact. Wait for the owner's go-ahead on non-trivial work.

7. **IMPLEMENTATION** — Smallest change that satisfies the plan. No
   drive-by refactors (CLAUDE.md rule 6). Keep `TLM_Project/`,
   `Hub_Project/`, `archive/` untouched.
8. **TESTING** — Follow the `testing` skill: add or extend a
   `SVMI_Project/tests/*.test.js` that fails without the change, then run
   the full suite.
9. **VALIDATION** — Syntax-check every `.gs`, run the full suite under
   `TZ=UTC`, review the diff line by line, and run the `security` skill's
   checklist for any new endpoint or rendered field. Deployment to the
   **test copy** (`SVMI_Project/DEPLOY.md`) happens only when the owner
   asks; never push to the live sheet.
10. **DOCUMENTATION** — Update the owning documents only:
    `ARCHITECTURE.md` / `DATA_MODEL.md` / `API_CONTRACT.md` /
    `REQUIREMENTS.md` where facts changed; `DECISIONS.md` for a durable
    call; a `reviews/NNN-<slug>.md` for the phase (next free number;
    sections as in `reviews/013`: objective, pre-implementation trace,
    changes, impact, tests, known issues).
11. **PROJECT STATE UPDATE** — `IMPLEMENTATION_LOG.md` row (date, commit,
    phase, summary); `TESTING_LOG.md` new baseline (files/assertions/
    failures, date); `PROJECT_STATUS.md` top summary, "currently being
    worked on", and "Immediate next task" — including what still needs
    the owner's live verification.

## Done means

- Full test suite passes, with counts recorded.
- Every changed fact lives in exactly one owning document.
- The summary to the owner says what changed, what was verified, what was
  **not** verified (e.g. real portal UI, live data), and the next step.
