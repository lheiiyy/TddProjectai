# Deploying the Training & Development Hub

The Hub is a **standalone** Apps Script project — it isn't attached to any
Google Sheet, so setup looks slightly different from SVMI or TL Tracker.

---

## 1. Create the project

1. Go to <https://script.google.com/home> → **New project**.
2. Rename it (e.g. "Figaro Training & Development Hub").
3. Paste in the three files from `Apps Script/`:
   - `Code.gs`
   - `HUB_LOGIN.html` (+ icon → HTML file, name it exactly `HUB_LOGIN`)
   - `HUB_LANDING.html` (name it exactly `HUB_LANDING`)
4. `appsscript.json` is edited via **Project Settings → "Show
   'appsscript.json' manifest file in editor"** — it isn't pasted in
   like the others.

Or, with `clasp` (see `README-CLASP.md`-style setup in SVMI_Project /
TLM_Project if you want the same workflow here): `clasp create --type
webapp --title "Figaro Training & Development Hub"` from inside this
`Apps Script/` folder, then `clasp push`.

---

## 2. Deploy as a Web App

1. **Deploy → New deployment**.
2. Gear icon next to "Select type" → **Web app**.
3. Description: anything (e.g. "T&D Hub v1").
4. **Execute as:** "User accessing the web app" (matches `appsscript.json`).
5. **Who has access:** "Anyone" (any Google account) or "Anyone within
   [your org]" if you're on Google Workspace and want it internal-only.
6. **Deploy**, then authorize access the first time.
7. Copy the Web app URL — that's the Hub's link. Share it instead of
   either sub-system's own URL, so everyone starts from one place.

To ship an update after editing any file: **Deploy → Manage
deployments → pencil icon → New version → Deploy**. Pushing code
alone does not update a live deployment.

---

## 3. One-time configuration

Everything Code.gs reads (`HUB_PASSWORD`, `SVMI_URL`, `TLM_URL`,
`HUB_SHARED_SECRET`) lives in this project's **Script Properties** — no
Sheet, no code edit needed:

1. In the Apps Script editor: **Project Settings** (gear icon, left
   sidebar) → scroll to **Script Properties** → **Add script property**.
2. Add four properties:

   | Property | Value |
   |---|---|
   | `HUB_PASSWORD` | whatever shared password you want visitors to enter |
   | `SVMI_URL` | SVMI Command Center's deployed Web app URL |
   | `TLM_URL` | TL Tracker's deployed Web app URL |
   | `HUB_SHARED_SECRET` | a long random string — see step 4 below |

   Get each sub-system's URL from its own project: **Deploy → Manage
   deployments** → copy the "Web app" URL.
3. Reload the Hub's own URL — both cards should now link out instead
   of showing "Not yet configured", and the login screen should ask
   for the password you set.
4. **`HUB_SHARED_SECRET` must be copied into SVMI_Project's and
   TLM_Project's own Script Properties too, under the exact same key
   and value.** This is the secret the Hub uses to sign the one-click
   access tokens its "Open …" buttons mint — see "Access control"
   below. Generate one long random string (a password manager's
   generator, or `openssl rand -hex 32` on a machine that has it) and
   paste the identical value into all three projects' Script
   Properties. Until all three have it, `_verifyHubToken_` on the
   receiving end can never validate anything, so "Open …" clicks will
   fail with "That system has not been configured yet" — that's the
   sign this step is missing.

Editing a Script Property takes effect immediately — no redeploy
needed. Blanking out `HUB_PASSWORD` turns the gate off entirely (any
password, or none, gets in) — don't leave it blank once real users
have the link.

If you'd rather script the password/URLs (e.g. from `clasp run` or a
one-off call), `setupHub_setPassword(pw)` and
`setupHub_setSubSystemUrls(svmiUrl, tlmUrl)` in `Code.gs` write to the
same properties and are safe to re-run any time — but for a single
manual setup, the Script Properties panel above is simpler.
`HUB_SHARED_SECRET` has no equivalent helper — set it directly as a
Script Property in all three projects, since it needs to reach two
other projects you may not be scripting from.

---

## Security

Same guidance as SVMI_Project/DEPLOY.md applies if you use `clasp` here
too: never commit `.clasprc.json` (already covered by the repo's
`.gitignore`).

Treat both `HUB_PASSWORD` and `HUB_SHARED_SECRET` as shared secrets —
neither is a real per-user credential. `HUB_SHARED_SECRET` is the more
sensitive of the two: anyone who has it can mint their own valid
access token for either sub-system without ever going through the
Hub's password screen, so share it only with whoever manages these
three projects, never with end users. Rotating either one only
matters going forward — nothing is cached anywhere (no
`localStorage`, in this project or either sub-system), so there's no
"signed-out browser" to worry about; every visitor already re-enters
the current gate on every fresh page load.

---

## Access control

Three layers now, not two — the token is new:

| Layer | Question it answers | Where it's configured |
|---|---|---|
| Google sign-in | Is this a real Google account? | `appsscript.json` |
| Hub password | Should this account see the two links at all? | Script Properties (`HUB_PASSWORD`) |
| Access token | Did this visit actually come from clicking "Open" in the Hub, recently? | Script Properties (`HUB_SHARED_SECRET`, shared with both sub-systems) |

There is no admin list here — the Hub itself has nothing to
administer (no data, no destructive tools). Each sub-system's own
admin list (SVMI) or PIN (TL Tracker) still applies independently —
a token from the Hub is an *alternative* way in for either
sub-system's own gate, never a replacement for it. Concretely, for
each sub-system:

- **Click "Open …" from the Hub** → the Hub mints a token signed with
  `HUB_SHARED_SECRET`, good for 5 minutes, and only that URL (never
  the bare one) is what actually opens. The sub-system verifies the
  token's signature and expiry before serving anything.
- **Go straight to a sub-system's own URL** → its own password/PIN
  gate applies exactly as before, unaffected by any of this.
- **A copied/bookmarked link with an old token** → the token has
  expired (or was never valid), so it falls through to that
  sub-system's own password/PIN gate instead of getting in for free —
  a leaked link is no more useful than the bare URL always was.
- **Once inside either sub-system**, staying idle for 2 minutes (no
  mouse/key/touch activity) drops you back to that gate automatically,
  and closing the tab or refreshing does too — neither the guest
  password/PIN nor the token is ever remembered client-side.
