# CLAUDE.md — Operating Rules for This Repository

This repository (not this conversation) is the project's source of truth.
Read `PROJECT_STATUS.md` first, every session, before doing anything else.

## Project in one paragraph

**SVMI (Store Visit Monitoring Initiative) — "SVMI Command Center"**: a
Google Sheets + Apps Script web app for Figaro Coffee Group's Training &
Development team. Field staff log store visits; admins track
visit compliance, per-store risk ("Store Health"), weekly KPIs, and
executive reports, backed by versioned, audited configuration and a
registration/approval/RBAC/MFA identity layer. A PostgreSQL redesign in
`database/` is DEV-only and has never touched real data. Details:
`PROJECT_MEMORY.md`, `REQUIREMENTS.md`.

## Stack (actual — don't assume anything else)

- **Server:** Google Apps Script, V8, 29 `.gs` files bound to one Google
  Sheet, time zone `Asia/Manila`; deployed with `@google/clasp`.
- **Client:** one vanilla-JS single-page file, `SVMI_PORTAL.html`, served
  by HtmlService; client ↔ server over `google.script.run`. No framework,
  no build step, no runtime dependencies.
- **Storage:** the Google Sheet (live). PostgreSQL 16 plain-SQL
  migrations + Node/psql tooling (DEV-only). No ORM.
- **Tests:** standalone Node scripts running the real `.gs` code in a
  `vm` sandbox; Playwright against a standalone demo page. No
  `package.json`, no test runner, no linter, no CI.

## Repository map

| Path | What |
|---|---|
| `SVMI_Project/` | **SVMI, live.** `Apps Script/` (code), `tests/`, `DEPLOY.md` |
| `database/` | **SVMI, DEV-only** Postgres: `migrations/`, `rollback/`, `scripts/`, `import/`, `dryrun/`, `validation/`, `docs/` |
| `TLM_Project/` | Unrelated project (TL Tracker). Never read or touch under an SVMI task |
| `Hub_Project/` | Separate T&D Hub landing-page app. Not SVMI |
| `archive/` | Frozen backups. Never edit or deploy |
| Root `*.md`, `reviews/` | Project documentation (authority table in `PROJECT_MEMORY.md`) |
| `.claude/` | SessionStart hook (installs clasp, restores its credential) and project skills |

## Where facts live (one authority each — D-014, D-038)

`PROJECT_MEMORY.md` orientation + authority table · `PROJECT_STATUS.md`
current state + next task · `REQUIREMENTS.md` · `ARCHITECTURE.md` ·
`DATA_MODEL.md` · `API_CONTRACT.md` · `DECISIONS.md` ·
`IMPLEMENTATION_LOG.md` · `TESTING_LOG.md` · `reviews/` ·
`SVMI_Project/DEPLOY.md` (Apps Script deploy) · `database/docs/`
(Postgres procedure). Never create a second document for a category
(no `docs/` mirror tree); update the owner.

## Skills — use them

| Skill | When |
|---|---|
| `project-context` | Start of any non-trivial task |
| `feature-workflow` | Any feature/fix/behavior change — plan with affected files before coding |
| `frontend` | `SVMI_PORTAL.html` / `SVMI_LOCK.html` |
| `backend` | Any `.gs` change |
| `database` | Sheets columns/areas, Postgres migrations, data backfills |
| `testing` | Adding tests, validating, recording baselines |
| `security` | Access, endpoints, rendered data, secrets, deploy settings |

## Commands

```bash
bash SVMI_Project/tests/run-all.sh      # syntax checks + all suites (TZ=UTC); must pass before "done"
node SVMI_Project/tests/<name>.test.js  # one suite
node database/dryrun/dryrun.test.js     # Postgres dry-run tooling tests
# Deploy (only when the owner asks; targets the TEST COPY in .clasp.json):
#   see SVMI_Project/DEPLOY.md — clasp pull first if anyone edited online, then clasp push
# Postgres (DEV only): SVMI_DB_ENV=dev database/scripts/run_migrations.sh — see database/docs/05
```

## Rules

1. **Read `PROJECT_STATUS.md` first.** It states current state, what's
   deferred, and the immediate next task. Do not assume a previous
   conversation's understanding of project state still holds.
2. **Respect `DECISIONS.md`.** Entries marked `Status: Settled` are not
   open questions. Do not reverse one without an explicit new instruction
   from the project owner that acknowledges the reversal.
3. **Do not rely on chat history.** If something isn't in the repository
   (docs, code, tests, or git history), treat it as unknown — ask, or
   investigate the repo, rather than assuming a prior conversation's
   context still applies.
4. **Consult only the relevant document(s)** for the task at hand — the
   authority table in `PROJECT_MEMORY.md` tells you which one.
5. **Record meaningful changes.** A completed implementation phase gets an
   `IMPLEMENTATION_LOG.md` entry; a test run whose result should persist
   gets a `TESTING_LOG.md` entry; a durable architectural/business call
   gets a `DECISIONS.md` entry. Don't let new durable facts exist only in
   a chat transcript.
6. **Avoid unrelated modifications.** A documentation task does not touch
   `.gs`/`.html`/schema/production data. An application-code task does not
   rewrite unrelated documentation. Match the change to what was asked.
7. **Follow the project's phase/review workflow.** Implementation work
   proceeds in named phases (see `IMPLEMENTATION_LOG.md`); a
   documentation/architecture audit is a review, recorded under
   `reviews/`, not a code change. Don't start a new implementation phase
   as a side effect of a review or documentation task.
8. **Never assume a file is obsolete without checking its actual current
   content** — an older document may still be the authority for its own
   narrow purpose (e.g. `SVMI_Project/DEPLOY.md` for deploy steps).

## Engineering rules (details in the skills)

- **Architecture:** keep the portal → public endpoint → `_private_` helper
  → sheet layering. One authoritative path per operation: Stores/
  Visitors/Purposes only via Admin → Configuration (D-005); reports from
  `MASTER_LOG`, never a generated sheet (D-036).
- **Code conventions:** file prefix on every function (`sl_`, `cfg_`,
  `store_`, …); trailing `_` for anything the portal doesn't call; sheet
  names/columns via constants; portal script stays ES5-style and escapes
  every value with `esc()`.
- **API:** gate as the first statement of every public function;
  mutations return `{ success, message, … }`; dates as `'YYYY-MM-DD'`
  strings; changes additive; update `API_CONTRACT.md` in the same commit.
- **Database:** history is append-only (versions, audit, supersede —
  D-009); identity rules D-001/D-003 are fixed; batch sheet I/O (6-minute
  limit, D-034/D-035).
- **Migrations:** Sheets — idempotent, admin-gated, owner-approved before
  running on live data. Postgres — never edit an applied migration; add
  `NNN_*.sql` + rollback; DEV only, never set the prod override.
- **Security:** see the `security` skill. Never print or commit the clasp
  token (`~/.clasprc.json`), DB passwords, the guest password, or TOTP
  secrets. Sheet sharing is the outer boundary — don't assume a sheet is
  hidden from users.
- **Testing:** every behavior change gets a failing-first test in
  `SVMI_Project/tests/`, including the denied path for gated functions;
  run `run-all.sh`; say plainly what was not tested (real portal UI, live
  data).
- **Modifying existing code:** smallest change that satisfies the plan;
  read the surrounding code and its tests first; don't reformat or
  refactor untouched code; don't "fix" a disclosed limitation unless it's
  the task.
- **Dependencies:** none at runtime, none to add without the owner's
  approval — no CDN scripts, no npm packages, no lockfiles.
- **Breaking changes** (renamed/removed endpoint, changed result shape,
  changed sheet header, changed decision): stop and get approval; record
  a `DECISIONS.md` entry; update portal + docs in the same commit; note
  it in `PROJECT_STATUS.md`.
- **Deployment:** only when asked, only to the test copy in
  `SVMI_Project/Apps Script/.clasp.json`; never the live sheet. Web-app
  setting changes need a new deployment version.

## Git

- Work on a `claude/<topic>` branch; open a PR into the default branch
  (`claude/file-review-kvc56h`). Don't push to `main` or force-push shared
  branches.
- Commit subjects: imperative, specific, with the phase or D-number when
  there is one (e.g. `D-035: fix Stores migration timeout…`,
  `fix(reports): …`). One logical change per commit; docs updated in the
  same commit as the code they describe.
- Never commit `.clasprc.json`, `.clasp.local.json`, `.env.dev`/`.env.prod`,
  `database/backups/`, or logs.

## Full workflow reference

The complete *AI Web App Development Workflow, Version 2.0* this file is
a compact operating guide for is not duplicated here — consult the
project owner's copy of it for anything beyond the rules above.
