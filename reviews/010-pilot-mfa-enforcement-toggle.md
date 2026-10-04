# Review 010 — Pilot-Testing Toggle: TOTP MFA Enforcement Turned Off

**Date:** 2026-09-27
**Type:** Application code change, at the project owner's explicit
request: remove the TOTP MFA login requirement for the duration of pilot
testing, while leaving Google sign-in (D-025) and the guest-password/
admin-list gate untouched. See `DECISIONS.md` D-033 for the durable
decision record; this review records what was inspected and changed.

---

## 1. Request handling before any code was touched

The initial request ("remove the security/log in requirements for pilot
testing") was ambiguous against this repository's own record: three
separate, `Status: Settled` decisions (D-025 — Google sign-in Web App
gate; the guest-password/admin-list gate described in `SVMKPI_ACCESS.gs`;
D-028/D-031/D-032 — native TOTP MFA) each gate a different layer of pilot
access, and `CLAUDE.md` requires an explicit, reversal-acknowledging
instruction before touching any of them. Rather than guess, the project
owner was walked through what each layer does and what removing it would
mean (deepest/highest-blast-radius first: Google sign-in, then the
password/admin-list gate, then TOTP MFA), and explicitly chose to remove
only the TOTP MFA layer, keeping the other two exactly as they are.

## 2. Inspection performed before changing code

Grepped the full `Apps Script/` tree for every point that reads MFA
satisfaction as an access gate (`_identity_hasSatisfiedMfa_` call sites),
confirming exactly three enforcement points — no others exist:

- `_identity_authorizeCurrentUser_()` (`SVMKPI_IDENTITY_CORE.gs`) — the
  single choke point every protected new-identity-surface function
  already calls (D-031).
- `sl_isAdmin()` (`SVMKPI_ACCESS.gs`) — the single choke point all 45+
  pre-existing `SETTINGS!G`-gated functions already call (D-032).
- `getAccessState().isActive`/`.mfaRequired` (`SVMKPI_IDENTITY_ACCESS.gs`)
  — read-only UI-convenience mirror of the first point, not itself an
  authorization boundary (D-016), but reported truthfully so the portal
  doesn't show a state the server wouldn't also enforce.

`enrollMfa()`/`verifyMfa()`/`enrollAdminMfa()`/`verifyAdminMfa()`
(`SVMKPI_IDENTITY_MFA.gs`, `SVMKPI_ACCESS.gs` §5) implement the TOTP
mechanism itself and enforce nothing on their own — confirmed by reading
every line of both files. Nothing about the guest-password gate
(`_handleWebAppRequest_()`) or Google sign-in (`appsscript.json`) reads
MFA state at all — confirmed those two layers have zero code path
overlap with the three points above.

## 3. What changed

**`SVMKPI_IDENTITY_CORE.gs`** — one new toggle, `var IDENTITY_MFA_ENFORCED
= false` (deliberately `var`, not `const`, so a test sandbox can flip it
without needing two copies of the source — mirrors how Apps Script's own
top-level declarations behave). `_identity_authorizeCurrentUser_()`'s MFA
check is now `if (IDENTITY_MFA_ENFORCED && !_identity_hasSatisfiedMfa_(...))`
— identical behavior to before when the toggle is `true`.

**`SVMKPI_IDENTITY_ACCESS.gs`** — `getAccessState()`'s `isActive` is now
`accountActive && (!IDENTITY_MFA_ENFORCED || mfaSatisfied)`; `mfaRequired`
now reports the live toggle value instead of a hardcoded `true`.
`mfaEnrolled`/`mfaSatisfied` are unchanged — still the real, truthful
standing either way, never faked.

**`SVMKPI_ACCESS.gs`** — `sl_isAdmin()`'s MFA check gained one more
`typeof`-guarded condition (`typeof IDENTITY_MFA_ENFORCED !== 'undefined'
&& IDENTITY_MFA_ENFORCED && ...`), consistent with the existing
`typeof _identity_hasSatisfiedMfa_ === 'function'` guard already there
for the same reason (a sandbox that never loads
`SVMKPI_IDENTITY_CORE.gs` degrades gracefully rather than throwing —
unaffected here since the new condition is added, not removed).
`sl_getAdminMfaStatus()` gained one new field, `mfaRequired`, mirroring
`getAccessState()`'s field of the same name, so the admin-MFA banner
knows whether to display at all.

**`SVMI_PORTAL.html`** — `renderAdminMfaBanner()` and `renderMfaArea()`
both now check `mfaRequired` first and render nothing when it is false,
so pilot testers are not prompted to enroll in or verify something that
currently gates nothing. The failure-handler fallback for
`getAccessState()` was changed from an implicit "not required" shape to
an explicit `mfaRequired: true` — conservative, fail-toward-showing-the-
prompt behavior on an RPC error, matching this codebase's existing
fail-closed convention elsewhere (e.g. `applyAdminGating(false)` on
`sl_isAdmin()` failure).

**No other file changed.** `SVMKPI_IDENTITY_MFA.gs` (the TOTP/anti-replay
primitives) and `SVMKPI_ACCESS.gs` §5 (the legacy admin MFA bridge,
`enrollAdminMfa()`/`verifyAdminMfa()`) are untouched — both remain fully
functional for anyone who wants to enroll voluntarily during the pilot.
`database/migrations/013_identity_extension.sql`: not touched.

## 4. Security model change

| Before this change | After this change (toggle off, current pilot state) |
|---|---|
| Google sign-in required to reach the app at all | **Unchanged** |
| Guest password / admin-email-list required past sign-in | **Unchanged** |
| ACTIVE new-identity-surface user also required a satisfied TOTP credential | No longer required — ACTIVE status alone is sufficient |
| SETTINGS!G-listed admin also required a satisfied TOTP credential | No longer required — admin-list membership alone is sufficient, exactly the pre-Security-Fix-R2 behavior |
| Setting the toggle back to `true` | Immediately and fully restores both requirements, no other code change needed |

## 5. Tests updated

`identity.test.js` and `identity-legacy-admin-mfa.test.js` — the two
files that load the real, affected source — were updated, not
rewritten. Every existing block whose assertions specifically prove "MFA
is required" (R1.1, R1.4, R1.6, and the Grace/`isActive`-after-reset
assertions in `identity.test.js`; R2.1, R2.3, R2.4, R2.6 in
`identity-legacy-admin-mfa.test.js`) now sets
`sandbox.IDENTITY_MFA_ENFORCED = true` on its own sandbox before running
— proving the underlying D-031/D-032 mechanism is fully intact and
exactly reversible, not deleted. Blocks that were already orthogonal to
enforcement (TOTP replay/expiry mechanics, permission-only denials,
secret-never-leaked checks, the R2.12 "identity subsystem not loaded"
degradation) were left unchanged. `identity-legacy-admin-mfa.test.js`'s
R2.10 exact-shape assertion was updated to include the new `mfaRequired`
field. A new section was added to each file (search "D-033") proving the
pilot DEFAULT directly: an ACTIVE/admin-listed user with no MFA at all is
authorized while the toggle is off, and re-enabling it on the same
sandbox/user takes effect immediately. `security-remediation.test.js`
was confirmed unaffected by inspection (it never loads
`SVMKPI_IDENTITY_CORE.gs`, so the new `typeof`-guarded condition is a
no-op there, exactly as it already was for the pre-existing MFA guard).

## 6. Test results — NOT run in this session (disclosed limitation)

**This is a deliberate, disclosed gap, not an oversight.** The updated
test files above were reasoned through line-by-line against the actual
mocked sandbox behavior (documented in §5), but this session's Bash tool
was denied for test-execution commands by an environment policy specific
to this security-sensitive change ("[Security Weaken]" classifier),
including for the plain `node tests/identity.test.js` invocation itself.
Per that policy's own instruction, no workaround was attempted. **Before
relying on this change in the actual pilot deployment, run:**

```
node "SVMI_Project/tests/identity.test.js"
node "SVMI_Project/tests/identity-legacy-admin-mfa.test.js"
```

and ideally the full suite referenced in `TESTING_LOG.md`, to confirm
the counts and catch anything this review's static reasoning missed.
`TESTING_LOG.md` records this same caveat rather than a fabricated pass
count.

## 7. What was deliberately NOT touched

- **D-025 (Google sign-in Web App gate)** — `appsscript.json` untouched.
- **The guest-password / admin-email-list gate** (`_handleWebAppRequest_()`,
  `_SL_SECRET_`, `_isOnLegacyAdminList_()`) — untouched; still required
  exactly as before.
- **D-028's native TOTP implementation itself** — every primitive
  (`_identity_generateTotpSecret_`, `_identity_matchTotpStep_`,
  anti-replay, audit writes) is untouched and still fully operational.
- **D-026** — the two independent authorization systems (new identity
  surface vs. legacy `sl_isAdmin()`) remain independent; this change
  affects both identically (one shared toggle) but does not unify them.
- Any other `DECISIONS.md` entry not named above.

## 8. Reverting

Set `IDENTITY_MFA_ENFORCED = false` → `true` in
`SVMI_Project/Apps Script/SVMKPI_IDENTITY_CORE.gs` (one line) and
redeploy. No other file needs to change. The R1/R2 test sections that
already run with the toggle forced `true` (§5) will continue to pass
unchanged; the new pilot-default sections (search "D-033") will need
their own re-check against the new default, or removal, once the pilot
period ends — left for that future task, not done speculatively now.

---

## Confirmation

No Google sign-in, guest-password, or admin-list behavior was touched.
No TOTP/anti-replay/audit mechanism built by D-028/D-031/D-032 was
removed or altered — only whether satisfying it is currently *required*.
The change is a single boolean, fully reversible, with its own
code-level pointer back to this review and `DECISIONS.md` D-033. Test
files were updated and reasoned through but **not executed** in this
session — see §6.
