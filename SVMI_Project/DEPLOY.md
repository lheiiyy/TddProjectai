# Deploying SVMI

Two ways to get the code into Google Apps Script: `clasp push` (one command)
or pasting files by hand (no setup, but tedious).

---

## Which sheet does this push to?

`Apps Script/.clasp.json` holds the target Script ID. It currently points at:

| | |
|---|---|
| **Target** | `Copy of sys.STORE VISIT 2026` — the test copy |
| **Script ID** | `1UU582VPImQRpvQCtNHLOjmp6_0MBN5v0XA9Z1OJPnxpjDEz8NswYTVLb` |

That default is deliberate. The live sheet (`sys.STORE VISIT 2026`) is owned by
someone else, and a stray `clasp push` against it would overwrite their script.
To deploy to a different sheet, change the `scriptId` — get it from that sheet's
**Extensions → Apps Script → ⚙ Project Settings → Script ID**.

**`clasp push` overwrites the online files with the local ones.** If anyone has
been editing in the browser, run `clasp pull` first or you will discard their work.

---

## Deploying from your own machine

One-time setup:

1. Enable the API: <https://script.google.com/home/usersettings> → **Google Apps Script API** → **On**
2. Install [Node.js](https://nodejs.org) (LTS), then:
   ```
   npm install -g @google/clasp
   clasp login
   ```

Then, any time:

```
cd "SVMI_Project/Apps Script"
clasp push
```

`clasp pull` brings browser-side edits back down into the repo.

---

## Deploying from a Claude Code web session

`.claude/hooks/session-start.sh` runs at session start and prepares the
container: it installs clasp and restores the OAuth credential from an
environment variable. After that, `clasp push` works in-session.

### Setting the credential

The hook reads **`CLASPRC_JSON_B64`** — base64 of your local `~/.clasprc.json`.
It is base64 rather than raw JSON because the environment-variable field parses
`KEY=value` lines, and raw JSON braces and quotes break that.

After `clasp login` on your machine, in **PowerShell**:

```powershell
$b=[Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\.clasprc.json")); "CLASPRC_JSON_B64=$b" | Set-Clipboard
```

On macOS or Linux:

```bash
echo "CLASPRC_JSON_B64=$(base64 -w0 ~/.clasprc.json)" | pbcopy   # or xclip -selection clipboard
```

Neither command prints anything — the value goes straight to the clipboard.
Paste it into the environment variable settings for this repo's Claude Code
environment, then **start a new session**; environment changes do not reach
sessions that are already running.

`CLASPRC_JSON` (unencoded) also works if your settings field accepts raw JSON.

### Match your clasp version

The session hook installs **clasp v3** (3.4.1 at the time of writing). The
credential file's internal format changed between v2 and v3, so a
`.clasprc.json` produced by a local clasp v2 may not be readable by the v3 in
the container. Check yours with `clasp --version`; if it reports v2, upgrade
with `npm install -g @google/clasp@latest`, run `clasp login` again, and re-copy
the value.

### Verifying it arrived

```
printenv CLASPRC_JSON_B64 | wc -c     # low thousands = set, 0 = not set
clasp show-authorized-user            # confirms the credential actually works
```

---

## Security

Read this before setting the credential.

- `~/.clasprc.json` contains an OAuth **refresh token**. Refresh tokens do not
  expire on their own — they work until revoked.
- The token is **not scoped to one spreadsheet**. clasp's default scopes cover
  your Drive files, script projects and deployments. Anything holding it can act
  as you across those.
- **Never paste it into a chat, issue, commit or email.** Use the clipboard
  commands above so the value is never displayed.
- **It is deliberately not in this repo**, and `.gitignore` excludes
  `.clasprc.json` so it cannot be committed by accident.
- **Revoke any time:** <https://myaccount.google.com/permissions> → **clasp** →
  **Remove access**. Do this immediately if it is ever exposed.
- **Safest setup:** a throwaway Google account that owns only the test copy.
  Then a leak costs one test spreadsheet rather than your whole Drive.

---

## Publishing the Web App

`clasp push` uploads code but does **not** publish a new version of a running
Web App. After pushing, either:

- **In the editor:** Deploy → Manage deployments → pencil icon → New version → Deploy
- **Or:** `clasp deploy`

Until you do, the `/exec` URL keeps serving the previous version.

The Web App matters because **Apps Script custom menus and dialogs do not run in
the Google Sheets mobile apps** — the `/exec` URL is the only way to use the
Command Center from a phone.

---

## Checks before you push

No linter or unit tests here, but two checks are worth running:

```bash
# every .gs file parses as valid JavaScript
for f in "SVMI_Project/Apps Script"/*.gs; do
  node -e "new Function(require('fs').readFileSync('$f','utf8'))" || echo "FAILED: $f"
done

# drive the standalone preview in a headless browser (122 checks)
node SVMI_Project/tests/portal-ui.test.js
```

The browser suite exercises the preview's in-memory sample data, not a real
spreadsheet. **Nothing in this repo has been verified against a live Sheet** —
deploy to the Copy and try it there first.
