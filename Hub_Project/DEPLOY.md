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

Everything Code.gs reads (`HUB_PASSWORD`, `SVMI_URL`, `TLM_URL`) lives in
this project's **Script Properties** — no Sheet, no code edit needed:

1. In the Apps Script editor: **Project Settings** (gear icon, left
   sidebar) → scroll to **Script Properties** → **Add script property**.
2. Add three properties:

   | Property | Value |
   |---|---|
   | `HUB_PASSWORD` | whatever shared password you want visitors to enter |
   | `SVMI_URL` | SVMI Command Center's deployed Web app URL |
   | `TLM_URL` | TL Tracker's deployed Web app URL |

   Get each sub-system's URL from its own project: **Deploy → Manage
   deployments** → copy the "Web app" URL.
3. Reload the Hub's own URL — both cards should now link out instead
   of showing "Not yet configured", and the login screen should ask
   for the password you set.

Editing a Script Property takes effect immediately — no redeploy
needed. Blanking out `HUB_PASSWORD` turns the gate off entirely (any
password, or none, gets in) — don't leave it blank once real users
have the link.

If you'd rather script this (e.g. from `clasp run` or a one-off
call), `setupHub_setPassword(pw)` and
`setupHub_setSubSystemUrls(svmiUrl, tlmUrl)` in `Code.gs` write to the
same properties and are safe to re-run any time — but for a single
manual setup, the Script Properties panel above is simpler.

---

## Security

Same guidance as SVMI_Project/DEPLOY.md applies if you use `clasp` here
too: never commit `.clasprc.json` (already covered by the repo's
`.gitignore`), and treat the Hub password the same as SVMI's guest
password — a shared secret for "should this person even see the
links", not a real per-user credential. Rotating it signs out every
browser that had the old one remembered in `localStorage`.

---

## Access control

Two layers, same shape as SVMI's:

| Layer | Question it answers | Where it's configured |
|---|---|---|
| Google sign-in | Is this a real Google account? | `appsscript.json` |
| Hub password | Should this account see the two links at all? | Script Properties (`HUB_PASSWORD`) |

There is no admin list here — the Hub itself has nothing to
administer (no data, no destructive tools). Each sub-system's own
admin list (SVMI) or PIN (TL Tracker) still applies once a visitor
clicks through.
