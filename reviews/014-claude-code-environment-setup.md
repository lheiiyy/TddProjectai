# Review 014 — Claude Code Development Environment Setup

**Date:** 2026-09-30
**Type:** Documentation / tooling setup (no application code, schema, or
data touched). See `DECISIONS.md` D-038 for the durable decision.

---

## 0. Repository identity gate

Confirmed before any change: remote `https://github.com/lheiiyy/TddProjectai`,
default branch `claude/file-review-kvc56h` at `f0186e3`, root contains
`SVMI_Project/`, `PROJECT_STATUS.md`, `PROJECT_MEMORY.md`,
`REQUIREMENTS.md`, `ARCHITECTURE.md`, `DATA_MODEL.md`, `DECISIONS.md`.

## 1. Objective

The project owner supplied a generic "establish a long-term production
web app Claude Code environment" prompt: inspect the stack, create a
`docs/` set (`PROJECT-BIBLE`, `ARCHITECTURE`, `PROJECT-STATE`,
`DATABASE-SCHEMA`, `API-CONTRACT`, `DECISIONS/`), improve `CLAUDE.md`,
and create seven stack-specific skills under `.claude/skills/` — setup
only, no features, no new dependencies, no invented technology.

## 2. Conflict found, and the owner's resolution

The repository already has a mature, D-014-governed documentation
system. Five of the six requested `docs/` files would have duplicated an
existing authority, which D-014 (Settled) forbids. The owner was asked
and chose **"extend what exists"**: map the template onto the existing
authorities, add only the missing category, build the skills, tighten
`CLAUDE.md`. Recorded as D-038.

| Requested | Mapped to |
|---|---|
| `docs/PROJECT-BIBLE.md` | `PROJECT_MEMORY.md` + `REQUIREMENTS.md` |
| `docs/ARCHITECTURE.md` | `ARCHITECTURE.md` |
| `docs/PROJECT-STATE.md` | `PROJECT_STATUS.md` |
| `docs/DATABASE-SCHEMA.md` | `DATA_MODEL.md` + `database/docs/` + `database/migrations/` |
| `docs/API-CONTRACT.md` | **New:** `API_CONTRACT.md` (no prior authority) |
| `docs/DECISIONS/` | `DECISIONS.md` entries |

## 3. Stack discovered (verified, not assumed)

- Google Apps Script (V8, `Asia/Manila`), 29 `.gs` files bound to one
  Google Sheet; `executeAs: USER_ACCESSING`, `access: ANYONE`.
- Client: single vanilla-JS file `SVMI_PORTAL.html` (ES5 style, `var`
  only), HtmlService; `google.script.run` via a `callServer()` helper; no
  external scripts or styles.
- No `package.json` anywhere, no package manager, no build, no linter, no
  CI. `@google/clasp` is installed globally by the SessionStart hook.
- Storage: the Sheet (live); PostgreSQL 16 plain-SQL migrations
  `000`–`013` + rollbacks, `psql`-driven scripts, Node import/dry-run
  tooling (DEV-only, D-011). No ORM.
- Tests: 27 standalone Node suites in `SVMI_Project/tests/` running the
  real `.gs` code in a `vm` sandbox (two are Playwright against the
  standalone demo), `responsive-check.js`, `database/dryrun/dryrun.test.js`.
- 167 public (RPC-reachable) server functions; 78 referenced by the
  portal.

## 4. Changes

Created:
- `API_CONTRACT.md` — transport, platform rules, envelope/error
  conventions, all 78 portal-used endpoints with their gates, change
  rules, known issues.
- `.claude/skills/{project-context,feature-workflow,frontend,backend,database,testing,security}/SKILL.md`.
- `SVMI_Project/tests/run-all.sh` — one command for the `.gs` and inline
  `<script>` syntax checks from `DEPLOY.md` plus every suite, under
  `TZ=UTC`, with totals.
- This review.

Modified (documentation only):
- `CLAUDE.md` — added purpose, stack, repo map, authority pointer, skills
  table, commands, engineering rules, git conventions; the original
  eight rules and the workflow reference are kept verbatim.
- `PROJECT_MEMORY.md` — repo map now lists `Hub_Project/`, `archive/`,
  `.claude/` (it previously said "three projects" and omitted the Hub);
  authority table gained `API_CONTRACT.md`, the skills row, and the
  template-mapping note.
- `DECISIONS.md` — D-038.
- `ARCHITECTURE.md` — one pointer to `API_CONTRACT.md` in §3.
- `IMPLEMENTATION_LOG.md`, `TESTING_LOG.md`, `PROJECT_STATUS.md` —
  recorded this pass.

Not touched: any `.gs`/`.html`, schema, migrations, tests' contents,
`.claude/settings.json`, the hook, `TLM_Project/`, `Hub_Project/`,
`archive/`. No packages installed into the repo.

## 5. Tests

`run-all.sh`: **29 files, 1636 assertions, 0 failures** under `TZ=UTC`
(1378/27 Apps Script, as `TESTING_LOG.md` recorded on 2026-09-28, plus
`responsive-check.js` 100 and `dryrun.test.js` 158). All `.gs` files and
all 3 inline `<script>` blocks parse.

## 6. Findings — risks and inconsistencies (recorded, not fixed)

Ordered by importance. None was fixed: this was a setup task (CLAUDE.md
rules 6–7). Each is a candidate for its own owner-approved phase.

1. **Sheet sharing is the effective authorization boundary.** With
   `USER_ACCESSING`, every user needs Viewer (browse) or Editor (submit
   visits) access to the Sheet (`SVMI_Project/DEPLOY.md`). An Editor can
   directly edit `SETTINGS!G` (make themselves admin), `IDENTITY_*`
   (roles/status), and audit sheets; any Viewer can read `SETTINGS!I`
   (guest password) and `IDENTITY_MFA` (every user's TOTP secret).
   `reviews/003` noted the menu-path and the guest-password case; the
   identity/MFA consequence isn't recorded. No sheet protection or
   hiding exists in code. Not verified: the live Sheet's actual sharing.
2. **[FIXED — `reviews/015`] `_cfg_writeAudit(...)` was RPC-callable with no gate** and takes an
   arbitrary `actor` argument (leading `_`, no trailing `_`), so a portal
   user can append forged `CONFIG_AUDIT` rows. Same family:
   `_cfg_setStatus` and `_getData` are public (the former is gated).
3. **`regenerateReportSheet(year)` rewrites a sheet with no
   `sl_isAdmin()` check** and is absent from `reviews/003`'s inventory
   (low impact: source is a frozen snapshot).
4. **Timezone-dependent tests.** In `Asia/Manila` (the production and
   the owner's zone), `risk-config.test.js` and `store-identity.test.js`
   each fail one assertion because the tests convert a local-midnight
   `Date` with `toISOString()`. Passes under UTC. Looks like a test
   fragility, not an app bug, but it hasn't been proven.
5. **Guest password handling:** accepted as a GET `?pw=` query parameter
   (can land in history/logs), and written into `localStorage` via
   `<?!= JSON.stringify(...) ?>` inside a `<script>` without `<`
   escaping (admin-controlled value, so low risk).
6. **Configuration writes don't take `LockService`**, unlike visit
   submission; two simultaneous admin edits to one entity could race on
   version numbering. Low likelihood at pilot scale.
7. **89 public functions aren't used by the portal** but remain
   RPC-reachable; nothing re-audits new public functions.
8. **Docs drift:** `PROJECT_MEMORY.md` omitted `Hub_Project/` (fixed
   here). `Hub_Project/README.txt` says to rename `.clasp.json.example`,
   but a real `.clasp.json` is already committed alongside it.
9. **Two Playwright suites depend on a machine-installed Playwright**
   (`/opt/node22/...`) with no pinned version; nothing in the repo
   declares it.

## 7. Recommended external Claude skills / plugins

Only for this stack; none installed.

- **Google Workspace / Drive connector** — the owner already has Drive
  connected; useful to read the live Sheet's structure or a data export
  (the paused Phase 2 dry run needs one) without a code push.
- **A GitHub connector/`gh`** for PR review flow on the
  `claude/<topic>` → default-branch process.
- **Playwright MCP / browser automation** (Claude in Chrome or the
  built-in browser) for ad-hoc checks of the *real* portal on the test
  copy — the documented coverage gap.
- **A Postgres MCP server** only once a persistent DEV database exists
  (D-011); not useful before then.
- Not recommended: framework skills (React/Next/Tailwind/ORM) — no such
  technology is present.

## 8. Known issues / remaining work

- Owner decision on findings 1–3 (security) and 4 (test time zone).
- The skills are new and untested in real sessions; correct them against
  the authoritative docs whenever they disagree (D-038).
