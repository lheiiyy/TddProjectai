#!/usr/bin/env bash
# SVMI_Project/tests/run-all.sh
#
# Runs the full SVMI validation baseline in one command:
#   1. every .gs file parses as JavaScript (DEPLOY.md "Checks before you push")
#   2. every inline <script> block in the portal/lock HTML parses
#   3. every SVMI_Project/tests/*.test.js plus responsive-check.js
#   4. database/dryrun/dryrun.test.js
#
# Each test file is standalone Node (no package.json, no test runner):
# it prints ✓/✗ lines and exits non-zero on any failure. This script
# only adds them up. It runs under TZ=UTC because two suites
# (risk-config, store-identity) compare dates via toISOString() and fail
# in a UTC+ zone such as Asia/Manila — see TESTING_LOG.md.
#
# Usage (from anywhere):   bash SVMI_Project/tests/run-all.sh
# Skip the Playwright suites (no browser available):
#                          SVMI_SKIP_BROWSER=1 bash SVMI_Project/tests/run-all.sh
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."   # repo root
export TZ=UTC
export SVMI_TEST_OUT="${SVMI_TEST_OUT:-$(mktemp -d)}"

status=0
echo "── Syntax: .gs files"
for f in "SVMI_Project/Apps Script"/*.gs; do
  node -e "new Function(require('fs').readFileSync(process.argv[1],'utf8'))" "$f" \
    || { echo "  ✗ $f"; status=1; }
done

echo "── Syntax: inline <script> blocks"
for f in "SVMI_Project/Apps Script"/*.html; do
  node -e "
    const s = require('fs').readFileSync(process.argv[1], 'utf8');
    const blocks = [...s.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
      .map(m => m[1].replace(/<\?!?=[\s\S]*?\?>/g, 'null'));   // HtmlService scriptlets
    blocks.forEach((b, i) => { try { new Function(b); } catch (e) {
      console.log('  ✗ ' + process.argv[1] + ' block ' + i + ': ' + e.message); process.exitCode = 1; } });
  " "$f" || status=1
done

echo "── Test files"
total_pass=0; total_fail=0; files=0
tests=(SVMI_Project/tests/*.test.js SVMI_Project/tests/responsive-check.js database/dryrun/dryrun.test.js)
for f in "${tests[@]}"; do
  case "$f" in
    *portal-ui.test.js|*responsive-check.js)
      if [ -n "${SVMI_SKIP_BROWSER:-}" ]; then echo "  – skipped (browser): $f"; continue; fi ;;
  esac
  out="$(node "$f" 2>&1)"; rc=$?
  p=$(printf '%s\n' "$out" | grep -c '✓'); x=$(printf '%s\n' "$out" | grep -c '✗')
  files=$((files+1)); total_pass=$((total_pass+p)); total_fail=$((total_fail+x))
  if [ $rc -ne 0 ] || [ "$x" -ne 0 ]; then
    status=1; echo "  ✗ $f  ($p passed, $x failed, exit $rc)"
    printf '%s\n' "$out" | grep '✗' | head -20 | sed 's/^/      /'
  else
    echo "  ✓ $f  ($p)"
  fi
done

echo "── $files files, $total_pass passed, $total_fail failed"
[ $status -eq 0 ] && echo "ALL CHECKS PASSED" || echo "CHECKS FAILED"
exit $status
