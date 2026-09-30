---
name: security
description: Project-specific security rules for SVMI — Apps Script web-app auth layers, google.script.run endpoint exposure, admin/identity authorization and MFA, secrets (guest password, TOTP, clasp token, DB credentials), XSS in HtmlService pages, SQL in the Postgres tooling, and sheet-sharing exposure. Use for any change touching access, a new endpoint, rendered data, credentials, or deployment settings, and as a pre-merge checklist.
---

# Security

Security history and rationale live in `reviews/003`–`010` and
`DECISIONS.md` D-015–D-033. Read the relevant ones before changing
anything in this area; this skill is the checklist.

## The real boundaries (know these before reasoning about risk)

1. **Google sign-in** — `appsscript.json` `access: ANYONE` = any Google
   account, not the public.
2. **Guest password** — gates only the page render in
   `_handleWebAppRequest_()`. Once the portal loads, the browser can call
   **any** public function.
3. **Server-side gates** — `sl_isAdmin()` (admin list + MFA when enforced)
   and `_identity_authorizeCurrentUser_()` (ACTIVE + permission + MFA).
   These are the only in-app authorization.
4. **Sheet sharing — the actual outer boundary.** Because the Web App
   runs as `USER_ACCESSING`, every user needs their own Viewer access,
   and Editor access to submit visits (`SVMI_Project/DEPLOY.md`). Anyone
   with that access can open the Sheet directly and read or (as Editor)
   edit every tab, including `SETTINGS!G` (admin list), `SETTINGS!I`
   (guest password), `IDENTITY_*` (roles, statuses, TOTP secrets), and
   the audit sheets — no Apps Script check runs for a direct edit. Treat
   any design that assumes users can't see or edit a sheet as broken
   unless the sheet is protected or moved out of the shared file.

## Authentication and authorization

- Every public function's **first statement** is its gate (`backend`
  skill table). Never rely on the portal hiding a button, on the caller
  having checked, or on a parameter the client supplies ("isAdmin",
  "userId of self").
- **Endpoint exposure:** any top-level function without a trailing `_`
  is callable via `google.script.run` by any user who loaded the
  portal — including names starting with `_`. New helpers end in `_`.
  When you add a public function, add it to `API_CONTRACT.md` with its
  gate.
- **Insecure direct object references:** functions that take a
  `userId`, `storeId`, `versionId`, or `snapshotId` must authorize the
  caller for that object, not just "logged in". Self-service identity
  functions resolve the caller with `_identity_currentUserRecord_()`.
- Keep `sl_isAdmin()` and the identity permission model independent
  (D-026). MFA: don't weaken `_identity_authorizeCurrentUser_()` /
  D-031/D-032 checks; the pilot toggle `IDENTITY_MFA_ENFORCED` (D-033)
  is changed only on the owner's explicit instruction.
- Don't add native-secret features beyond TOTP without a decision
  (D-028); the target is an external IdP (D-015, D-022).

## Secrets and environment

| Secret | Where | Rule |
|---|---|---|
| Guest password | `SETTINGS!I2`, read via `_SL_SECRET_` | Never returned by any endpoint; never logged. Note it is currently sent as `?pw=` on GET and cached in `localStorage` by the portal |
| Admin list | `SETTINGS!G2:G`, via `_SL_SECRET_` | Same |
| TOTP secrets | `IDENTITY_MFA` sheet | Never in any list/read path, audit row, log, or response after enrollment |
| Email verification codes | Only a hash is stored (`IDENTITY_VERIFICATIONS`) | Plaintext only in the outgoing email |
| clasp OAuth token | `~/.clasprc.json`, restored from `CLASPRC_JSON_B64` by `.claude/hooks/session-start.sh` | Never print, cat, echo, commit, or paste it. `.gitignore` covers it. Revocation steps: `SVMI_Project/DEPLOY.md` "Security" |
| Postgres credentials | libpq env vars / uncommitted `database/.env.dev` | Only `.env.*.example` placeholders are committed |

Secrets go in object properties (`_SL_SECRET_` pattern) or
`PropertiesService` — never in a top-level function, a source literal,
or a test fixture that resembles a real value.

## Input validation and injection

- Validate and normalize every argument server-side (`backend` skill).
- **SQL:** Postgres tooling builds SQL text for `psql`. Use the existing
  `sqlLiteral()` / `sqlJsonb()` helpers (`database/import/load.js`) for
  every value, explicit column lists, and never interpolate a value into
  an identifier. Shell scripts that embed values in `psql -c` must only
  embed values they generated themselves (e.g. migration filenames).
- **Formula injection:** values written to Sheets from user input that
  begin with `=`, `+`, `-`, or `@` can execute as formulas when someone
  opens the Sheet. Write user text with `setValues` and treat a leading
  formula character as data (prefix with `'`) in any new write path.

## XSS (HtmlService pages)

- Portal rendering uses `innerHTML`; **every** server- or user-derived
  value goes through `esc()` — text and attribute positions alike.
- Templates: `<?= ?>` escapes, `<?!= ?>` does not. Use `<?!= ?>` only for
  values you serialize yourself; inside a `<script>`, JSON must also have
  `<` escaped (`.replace(/</g, '\\u003c')`) so a value can't close the
  tag.
- Error messages rendered to the page are escaped too.

## CSRF and CORS

- There is no cookie-authenticated REST API and no `fetch` from other
  origins: `google.script.run` calls are bound to the Google session and
  the HtmlService iframe, and `doGet`/`doPost` only return HTML. Don't
  add a `doPost` that performs a state change based on request
  parameters — that would reintroduce CSRF risk. CORS headers are not
  configurable in Apps Script and should not be needed.

## Sensitive data exposure

- Return the minimum: guest-tier reads must not include emails, identity
  details, or audit internals unless the view needs them.
- `IDENTITY_AUDIT` and `CONFIG_AUDIT` stay separate (D-023) and never
  contain secrets or codes (`identity.test.js` asserts this — keep that
  assertion for new audit events).
- Log with `Logger.log`/`console.error` without payloads that contain
  personal data or credentials.

## Dependencies

- The app has **no runtime dependencies** (`appsscript.json`
  `dependencies: {}`, no external `<script src>` or CSS). Keep it that
  way unless the owner approves; a CDN script would run with the user's
  Google-authorized session.
- Tooling dependencies are global/installed by the environment
  (`@google/clasp` via the SessionStart hook, Playwright from the
  image). Don't add packages or a lockfile without asking; if one is
  added, pin versions and audit it.

## Pre-merge checklist

- [ ] New/changed public functions gated as their first statement, with
      denied-path tests.
- [ ] No new public helper that should be private (trailing `_`).
- [ ] Every rendered value escaped; no new `<?!= ?>` on untrusted data.
- [ ] No secret, code, or token in code, logs, responses, tests, or commits.
- [ ] Object-level authorization for ID-taking functions.
- [ ] `API_CONTRACT.md` updated; security-relevant choices recorded in
      `DECISIONS.md` / a `reviews/` entry.
- [ ] Deployment targets the test copy only (`.clasp.json`).
