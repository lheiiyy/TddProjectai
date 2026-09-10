# Moving TL Tracker to Claude Code (no more copy-paste)

This folder is now a `clasp`-ready Apps Script project. `clasp` is Google's own CLI for
pushing files straight into an Apps Script project — once it's set up, editing here and
running one command updates the live script, no copy-paste into the Extensions → Apps
Script editor.

**Why this has to happen on your machine, not in a cloud sandbox:** pushing code into
*your* Apps Script project means authenticating *as you* to Google — `clasp login` opens
a browser and asks you to sign in and approve access. That has to run somewhere you can
complete that sign-in, which is your own computer (Claude Code's terminal, desktop app,
or a local editor). Once it's authenticated once, it stays authenticated.

## One-time setup (do this once, in Claude Code on your computer)

1. **Install Node.js** if you don't have it (claude.ai/code or the Claude desktop app's
   Code tab can check/install this for you — just ask).

2. **Install clasp:**
   ```
   npm install -g @google/clasp
   ```

3. **Enable the Apps Script API for your account** (one-time, per Google account):
   open https://script.google.com/home/usersettings and turn it on.

4. **Log in:**
   ```
   clasp login
   ```
   This opens a browser — sign in with the same Google account that owns the
   `[cowork] Team Leader Monitoring` spreadsheet.

5. **Connect this folder to the live script.** You have two cases:

   - **If you already pasted Code.gs / TLForm.html into Extensions → Apps Script**
     (so a live script project already exists): open that script editor, copy the
     Script ID from **Project Settings** (gear icon), then run:
     ```
     clasp clone <SCRIPT_ID>
     ```
     — say yes if it asks to overwrite the files here; they're the same content.

   - **If no script exists yet:** run this from inside this folder, using the
     Spreadsheet ID from the sheet's URL (the long ID between `/d/` and `/edit`):
     ```
     clasp create --type sheets --parentId <SPREADSHEET_ID> --rootDir .
     ```
     This creates a brand-new script bound to your sheet and fills in `.clasp.json`
     for you (delete `.clasp.json.example` once that happens).

6. **Push:**
   ```
   clasp push
   ```
   That's the command that replaces copy-paste from now on. Reload the spreadsheet
   and the 🍕 TL Tracker menu should reflect whatever's in this folder.

7. **Deploy the web app (phone link) from the CLI too, instead of the Deploy menu:**
   ```
   clasp deploy --description "TL Tracker update"
   ```
   Run `clasp deployments` to see the deployment ID if you need to target a specific
   one on a re-deploy.

## From here on

Once `.clasp.json` has a real Script ID in it, just ask Claude Code to make whatever
change you need — it can edit `Code.gs` / `TLForm.html` in this folder and run
`clasp push` (and `clasp deploy` when the change should go live on the phone link)
as part of the same request, so you never touch the Apps Script editor by hand again.

## Files in this folder

- `Code.gs` — the Apps Script backend
- `TLForm.html` — the merged HTML form (New Entry / Certify / Uniform / Stock)
- `appsscript.json` — the project manifest (timezone, web app access settings) —
  clasp needs this to push cleanly
- `.clasp.json.example` — rename to `.clasp.json` and fill in your Script ID once you
  have one (steps 5 above does this for you automatically with `clasp create`)
- `INSTALL.md` — the original manual (copy-paste) install guide, kept for reference
