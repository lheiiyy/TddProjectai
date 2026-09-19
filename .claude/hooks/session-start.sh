#!/bin/bash
# ============================================================
# SessionStart hook — prepares this container for deploying the
# SVMI Apps Script project.
#
# Does two things:
#   1. installs @google/clasp (Google's Apps Script CLI) if absent
#   2. restores the clasp OAuth credential from CLASPRC_JSON_B64
#
# Both are safe to skip: with no credential set, the session still
# starts normally and everything except `clasp push/pull` works.
# Nothing here ever prints the credential.
# ============================================================
set -euo pipefail

# Web sessions only — a local checkout shouldn't get a global npm
# install or a credential file written behind the user's back.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# ── 1. clasp ────────────────────────────────────────────────
if command -v clasp >/dev/null 2>&1; then
  echo "[svmi] clasp already present ($(clasp --version 2>/dev/null || echo 'version unknown'))"
else
  echo "[svmi] installing @google/clasp…"
  if npm install -g @google/clasp >/tmp/clasp-install.log 2>&1; then
    echo "[svmi] clasp installed ($(clasp --version 2>/dev/null || echo 'version unknown'))"
  else
    echo "[svmi] WARNING: clasp install failed — see /tmp/clasp-install.log"
    echo "[svmi] session continues; deploys will be unavailable until this is fixed"
  fi
fi

# ── 2. credential ───────────────────────────────────────────
# CLASPRC_JSON_B64 holds base64 of the user's ~/.clasprc.json. It is
# base64 so it survives a KEY=value environment field without the
# braces and quotes tripping the parser.
CRED="$HOME/.clasprc.json"

if [ -n "${CLASPRC_JSON_B64:-}" ]; then
  if printf '%s' "$CLASPRC_JSON_B64" | base64 -d > "$CRED.tmp" 2>/dev/null \
     && [ -s "$CRED.tmp" ] \
     && head -c 1 "$CRED.tmp" | grep -q '{'; then
    mv "$CRED.tmp" "$CRED"
    chmod 600 "$CRED"
    echo "[svmi] clasp credential restored from CLASPRC_JSON_B64"
  else
    rm -f "$CRED.tmp"
    echo "[svmi] WARNING: CLASPRC_JSON_B64 is set but did not decode to JSON."
    echo "[svmi] Re-copy it with the PowerShell one-liner in SVMI_Project/DEPLOY.md."
  fi
elif [ -n "${CLASPRC_JSON:-}" ]; then
  # Plain-JSON fallback, for environments where the value went in unencoded.
  printf '%s' "$CLASPRC_JSON" > "$CRED"
  chmod 600 "$CRED"
  echo "[svmi] clasp credential restored from CLASPRC_JSON"
else
  echo "[svmi] no clasp credential in the environment — skipping."
  echo "[svmi] Deploys are unavailable this session; see SVMI_Project/DEPLOY.md."
fi
