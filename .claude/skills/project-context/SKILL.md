---
name: project-context
description: Load the right SVMI project context before any non-trivial change — code, schema, config, or docs. Use at the start of a session and before planning a feature, fix, refactor, migration, or security change, so nothing that already exists gets rebuilt and no settled decision gets reversed.
---

# Project context check

This repository, not the conversation, is the source of truth. Run this
check before planning or editing anything beyond a typo.

## 1. Always read

1. `CLAUDE.md` — operating rules (already loaded; re-read if unsure).
2. `PROJECT_STATUS.md` — at minimum the top summary, "What is currently
   being worked on", "What remains unresolved", "What is explicitly
   deferred", and "Immediate next task".
3. `PROJECT_MEMORY.md` — the repo map and the documentation-authority
   table. Use it to decide what else to open.

## 2. Read when the task touches it

Consult only the authority that owns the question (D-014):

| Task touches | Read |
|---|---|
| What the system must do / is out of scope | `REQUIREMENTS.md` |
| Runtime model, access layers, portal tabs, which `.gs` file owns what | `ARCHITECTURE.md` (§4 is the file map) |
| Sheets (`MASTER_LOG`, `SETTINGS`, `CONFIG_*`, `IDENTITY_*`) or Postgres tables | `DATA_MODEL.md`, then `database/docs/` for Postgres procedure |
| A server function the portal calls, or adding one | `API_CONTRACT.md` |
| Anything that sounds like a policy ("identity is…", "never…", "sole path…") | `DECISIONS.md` — search for the D-number; `Status: Settled` is binding |
| How a past phase was built and why | `IMPLEMENTATION_LOG.md`, the matching `reviews/NNN-*.md` |
| Current test baseline | `TESTING_LOG.md` |
| Deploying Apps Script | `SVMI_Project/DEPLOY.md` ("Which sheet does this push to?" first) |

Do not read `TLM_Project/`, `Hub_Project/`, or `archive/` for SVMI
context. They are separate projects or frozen history.

## 3. Prove it doesn't already exist

Before writing anything new:

- **Search the code by behavior, not just by name.**
  `Grep` across `SVMI_Project/Apps Script/` for the sheet name, column,
  enum, or verb involved (e.g. `CONFIG_STORES`, `effectiveFrom`,
  `LockService`, `normalizeReportingYear`). Most cross-cutting helpers
  already exist in `SVMKPI_CORE.gs`, `SVMKPI_CONFIG.gs`,
  `SVMKPI_CALENDAR.gs`, `SVMKPI_REPORTING_YEAR.gs`, and
  `SVMKPI_IDENTITY_CORE.gs`.
- **Check the portal** (`SVMI_PORTAL.html`) for an existing tab, helper
  (`callServer`, `esc`, `stateMsg`, `showStatus`), or render function.
- **Check `PROJECT_STATUS.md` "deferred"** — if the feature is listed
  there, it was deliberately postponed; confirm with the owner before
  starting it.
- **Known single-path rules** — never add a second way to do these:
  - Stores/Visitors/Purposes are created or changed only through Admin →
    Configuration (D-005). `SETTINGS` A–E/F/H is a generated mirror
    (D-006).
  - Reports compute from `MASTER_LOG`, never from a generated report
    sheet (D-036).
  - Configuration changes are new versions; snapshots are superseded,
    never edited (D-009).
  - No purpose inherits another's configuration (D-010).

## 4. Before you act, state

In one short message: what you read, what already exists that you'll
reuse, which decisions constrain the change, and which files you expect
to touch. If the task conflicts with a settled decision, stop and ask
the owner — quoting the D-number — rather than working around it.

## 5. If the docs look wrong

Code and docs disagree → trust neither blindly. Verify against the code
and tests, then fix the owning document (not a new one), and mention the
correction in your summary.
