// ============================================================
// SVMKPI_IDENTITY_MFA.gs
// Phase 1H-C — MFA foundation (D-028): authenticator-app TOTP
// (RFC 6238), implemented natively because no external Identity
// Provider is selected yet to own it instead. A documented, temporary
// exception to D-022 ("SVMI must not store MFA secrets") — see D-028 for
// the full rationale, and reviews/006 §2 for why this was not left
// unimplemented instead.
// ------------------------------------------------------------
// Disclosed scope limitation: this pilot has no session mechanism
// (unchanged since Phase 1H-A/1H-B.1 — session redesign is explicitly
// out of scope for this task), so MFA here is enrollment-time proof of
// possession, not a per-request re-check. getAccessState() reports
// whether MFA is enrolled; nothing in this phase re-prompts for a TOTP
// code on every subsequent page load. This is the honest, foundation-
// level scope of "MFA required for all Active users" achievable without
// inventing session infrastructure this task forbids.
// ============================================================

const IDENTITY_MFA_COL = { USER_ID: 1, STATUS: 2, METHOD: 3, SECRET: 4, ENROLLED_AT: 5, LAST_VERIFIED_AT: 6 };
const IDENTITY_TOTP_STEP_SECONDS = 30;
const IDENTITY_TOTP_DIGITS = 6;
const IDENTITY_TOTP_WINDOW_STEPS = 1; // +/- 1 step (30s) clock-drift tolerance


// ═══════════════════════════════════════════════════════════════
// SECTION 1: TOTP PRIMITIVES (RFC 4648 base32, RFC 6238 TOTP)
// ═══════════════════════════════════════════════════════════════

function _identity_base32Encode_(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  bytes.forEach(b => { bits += (b < 0 ? b + 256 : b).toString(2).padStart(8, '0'); });
  let out = '';
  let i = 0;
  for (; i + 5 <= bits.length; i += 5) out += alphabet[parseInt(bits.substring(i, i + 5), 2)];
  const remainder = bits.length - i;
  if (remainder > 0) out += alphabet[parseInt(bits.substring(i).padEnd(5, '0'), 2)];
  return out;
}

function _identity_base32Decode_(str) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  String(str || '').toUpperCase().split('').forEach(ch => {
    const val = alphabet.indexOf(ch);
    if (val !== -1) bits += val.toString(2).padStart(5, '0');
  });
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.substring(i, i + 8), 2));
  return bytes;
}

function _identity_generateTotpSecret_() {
  const bytes = [];
  for (let i = 0; i < 20; i++) bytes.push(Math.floor(Math.random() * 256));
  return _identity_base32Encode_(bytes);
}

function _identity_totpCodeForTime_(secretBase32, unixSeconds) {
  const keyBytes = _identity_base32Decode_(secretBase32);
  const timeStep = Math.floor(unixSeconds / IDENTITY_TOTP_STEP_SECONDS);
  const counterBytes = new Array(8);
  let t = timeStep;
  for (let i = 7; i >= 0; i--) { counterBytes[i] = t % 256; t = Math.floor(t / 256); }

  const hmacRaw = Utilities.computeHmacSha1Signature(counterBytes, keyBytes);
  const hmac = hmacRaw.map(b => (b < 0 ? b + 256 : b));
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode = ((hmac[offset] & 0x7f) << 24) |
                  ((hmac[offset + 1] & 0xff) << 16) |
                  ((hmac[offset + 2] & 0xff) << 8) |
                  (hmac[offset + 3] & 0xff);
  const mod = Math.pow(10, IDENTITY_TOTP_DIGITS);
  return String(binCode % mod).padStart(IDENTITY_TOTP_DIGITS, '0');
}

function _identity_verifyTotpCode_(secretBase32, submittedCode, windowSteps) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const w = windowSteps == null ? IDENTITY_TOTP_WINDOW_STEPS : windowSteps;
  const normalizedSubmitted = String(submittedCode || '').trim();
  if (!normalizedSubmitted) return false;
  for (let step = -w; step <= w; step++) {
    if (_identity_totpCodeForTime_(secretBase32, nowSeconds + step * IDENTITY_TOTP_STEP_SECONDS) === normalizedSubmitted) return true;
  }
  return false;
}


// ═══════════════════════════════════════════════════════════════
// SECTION 2: ENROLLMENT / VERIFICATION — self-service only (never on
// behalf of another user; no adminEnrollMfa()/adminVerifyMfa() exists)
// ═══════════════════════════════════════════════════════════════

/**
 * enrollMfa()
 * Self-service — always acts on the calling browser's own linked
 * identity (D-025), never a client-supplied userId. Requires ACTIVE
 * status. Returns the shared secret and an otpauth:// URI ONCE, at
 * enrollment time — this is the only function in the identity surface
 * that ever returns the secret; no read function returns it afterward.
 * @returns {{success:boolean, message:string, secret?:string, otpauthUri?:string}}
 */
function enrollMfa() {
  const current = _identity_currentUserRecord_();
  if (!current) return { success: false, message: 'No SVMI identity linked to this Google account.' };
  if (current.accountStatus !== IDENTITY_STATUS.ACTIVE) {
    return { success: false, message: 'Account must be ACTIVE to enroll in MFA.' };
  }

  const sheet = _identity_ensureSheet_(IDENTITY_SHEET.MFA, IDENTITY_HEADERS.MFA);
  const rows = _identity_readAll_(sheet);
  let rowNum = -1, wasEnrolled = false;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][IDENTITY_MFA_COL.USER_ID - 1]) === String(current.userId)) {
      rowNum = i + 2;
      wasEnrolled = rows[i][IDENTITY_MFA_COL.STATUS - 1] === 'ENROLLED';
      break;
    }
  }

  const secret = _identity_generateTotpSecret_();
  if (rowNum === -1) {
    sheet.appendRow([current.userId, 'NOT_ENROLLED', 'TOTP', secret, '', '']);
  } else {
    sheet.getRange(rowNum, IDENTITY_MFA_COL.STATUS).setValue('NOT_ENROLLED');
    sheet.getRange(rowNum, IDENTITY_MFA_COL.SECRET).setValue(secret);
    sheet.getRange(rowNum, IDENTITY_MFA_COL.ENROLLED_AT).setValue('');
  }
  SpreadsheetApp.flush();

  if (wasEnrolled) {
    _identity_writeAudit_(IDENTITY_AUDIT_EVENT.MFA_RESET, current.userId, current.userId, 'MFA re-enrollment started');
  }

  const otpauthUri = 'otpauth://totp/SVMI:' + encodeURIComponent(current.email) +
    '?secret=' + secret + '&issuer=SVMI&digits=' + IDENTITY_TOTP_DIGITS + '&period=' + IDENTITY_TOTP_STEP_SECONDS;

  return {
    success: true,
    message: 'Scan this into your authenticator app, then confirm with verifyMfa().',
    secret: secret,
    otpauthUri: otpauthUri,
  };
}

/**
 * verifyMfa(code)
 * Self-service. On the FIRST successful verification after enrollMfa(),
 * transitions IDENTITY_MFA status NOT_ENROLLED -> ENROLLED and writes
 * MFA_ENROLLED. On any later successful call, just updates
 * lastVerifiedAt (no audit spam for routine re-verification). On
 * failure, writes MFA_VERIFY_FAILED — never reveals the correct code or
 * the stored secret.
 * @returns {{success:boolean, message:string}}
 */
function verifyMfa(code) {
  const current = _identity_currentUserRecord_();
  if (!current) return { success: false, message: 'No SVMI identity linked to this Google account.' };

  const sheet = _identity_ensureSheet_(IDENTITY_SHEET.MFA, IDENTITY_HEADERS.MFA);
  const rows = _identity_readAll_(sheet);
  let rowNum = -1, record = null;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][IDENTITY_MFA_COL.USER_ID - 1]) === String(current.userId)) { rowNum = i + 2; record = rows[i]; break; }
  }
  const secret = record ? record[IDENTITY_MFA_COL.SECRET - 1] : '';
  if (!record || !secret) return { success: false, message: 'MFA not enrolled — call enrollMfa() first.' };

  if (!_identity_verifyTotpCode_(secret, code, IDENTITY_TOTP_WINDOW_STEPS)) {
    _identity_writeAudit_(IDENTITY_AUDIT_EVENT.MFA_VERIFY_FAILED, current.userId, current.userId, '');
    return { success: false, message: 'Incorrect code.' };
  }

  const wasEnrolled = record[IDENTITY_MFA_COL.STATUS - 1] === 'ENROLLED';
  const now = new Date();
  sheet.getRange(rowNum, IDENTITY_MFA_COL.STATUS).setValue('ENROLLED');
  if (!wasEnrolled) sheet.getRange(rowNum, IDENTITY_MFA_COL.ENROLLED_AT).setValue(now);
  sheet.getRange(rowNum, IDENTITY_MFA_COL.LAST_VERIFIED_AT).setValue(now);
  SpreadsheetApp.flush();

  if (!wasEnrolled) {
    _identity_writeAudit_(IDENTITY_AUDIT_EVENT.MFA_ENROLLED, current.userId, current.userId, '');
  }
  return { success: true, message: 'Verified.' };
}
