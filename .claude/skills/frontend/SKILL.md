---
name: frontend
description: How to build or change SVMI's browser UI — SVMI_PORTAL.html (single-file vanilla-JS app served by Apps Script HtmlService) and SVMI_LOCK.html. Use for any tab, form, report view, admin screen, styling, or mobile-layout change.
---

# Frontend — `SVMI_PORTAL.html`

## What the frontend actually is

- **One file**, `SVMI_Project/Apps Script/SVMI_PORTAL.html` (~4,100
  lines): one `<style>` block, markup for every tab, one `<script>`
  block. Served by `HtmlService.createTemplateFromFile()` in
  `_handleWebAppRequest_()` (`SVMKPI_ADMIN.gs`). No framework, no build
  step, no bundler, no external JS/CSS — nothing to `npm install`.
- `SVMI_LOCK.html` is the guest-password form.
- `SVMI_Command_Center_Demo.html` is a **separate standalone preview** with
  an in-memory mock backend. The Playwright suites test it, not the real
  portal (`ARCHITECTURE.md` §4, §8).
- Tab structure and admin sub-tabs: `ARCHITECTURE.md` §3. Don't add a
  top-level tab without a plan checkpoint (`feature-workflow`).

## Conventions to match (verified in the current file)

- **ES5 style in the client script:** `var` and `function` declarations,
  string concatenation — the file currently has no `const`, arrow
  functions, or template literals. Match it. (Server `.gs` is V8 and does
  use modern syntax; the two are different codebases.)
- **Server calls go through `callServer(fnName, args, onSuccess, onError)`**
  — never raw `google.script.run` in new code. `fnName` is a string, so
  a server rename breaks silently; check `API_CONTRACT.md`.
- **Rendering is HTML-string building + `innerHTML`.** Every value that
  came from the server or the user goes through `esc()` — no exceptions,
  including names, remarks, purposes, error messages, and IDs placed in
  attributes. Numbers you computed yourself are the only safe unescaped
  values.
- **Styling:** use the `:root` CSS variables (`--navy`, `--gold`, `--text`,
  `--muted`, `--border`, `--bg`, `--card`, status colors). No hardcoded new
  colors. Mobile breakpoint is `@media (max-width:820px)`, with
  `(hover:none) and (pointer:coarse)` for touch.
- **Global state** uses `g`-prefixed vars (`gBrands`, …). Reuse existing
  state; don't introduce a second copy of the same selection.

## Required states for every data view

| State | Use |
|---|---|
| Loading | `stateMsg`-style block with `<div class="spinner"></div>`, or `showStatus(msg, 'loading')` for inline actions |
| Empty | `stateMsg(icon, title, msg)` with a plain-language explanation — never a blank area |
| Error | `onError(message)` → `stateMsg`/`showStatus` with the server's `message`, escaped. Also handle `{ success: false }` envelopes — a mutation can "succeed" at transport level and still fail |
| Success | Envelope `message` shown via `showStatus`, then refresh the affected view |

Disable a submit button while its call is in flight; re-enable in both
handlers. Visit submission already uses a queue (`queueEmpty`) — reuse it.

## Forms and validation

- Data-entry fields are **type-to-filter**, not dropdown-only (commit
  `e06d779`). Reuse that component for any new picker.
- Store pickers use `sl_getStoreFormOptions()` guided choices, never free
  text (Admin Configuration precedent).
- Client validation is for usability only. The server re-validates
  everything (`cfg_validateConfiguration`, submission checks) — never
  move a rule to the client only.
- Dates sent to the server are `'YYYY-MM-DD'` strings (`todayDateStr()`).

## Access in the UI

- Hiding the Admin tab for non-admins is convenience, not security. Any
  new admin control must call an admin-gated server function.
- The Account tab is always visible (registration must reach
  not-yet-approved users). Don't gate it.

## Accessibility and responsive

- The current file has almost no ARIA. New controls must at least use
  real `<button>`/`<label for>`, keyboard-reachable elements, visible
  focus, and text (not color alone) for status.
- Touch targets and overflow are what `responsive-check.js` asserts on the
  demo (6 device profiles). Design for ~360px wide first; nothing may
  scroll horizontally or clip popovers off-screen.

## Performance

- Fetch once per view; filter/sort in the browser. Avoid a server round
  trip per keystroke or per row.
- Large tables: render in one `innerHTML` assignment, not row-by-row DOM
  appends.

## Avoid duplicated UI logic

Before writing a helper, search the script for an existing one (`esc`,
`stateMsg`, `showStatus`, `pill`, badge helpers, year selector, brand
filter). The demo file has look-alike code — changes to the portal don't
automatically belong in the demo; disclose any drift in
`PROJECT_STATUS.md`.

## Checking your change

1. Extract and syntax-check the `<script>` block (see `testing` skill).
2. Run `settings-config-migration.test.js` (it loads the real portal).
3. If the demo was changed too, run `portal-ui.test.js` and
   `responsive-check.js`.
4. State plainly that the real portal UI was not browser-tested unless
   you did so.
