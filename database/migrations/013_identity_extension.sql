-- 013_identity_extension.sql
-- Phase 1H-C: extends 002_users_roles.sql's Authentication identity <->
-- SVMI profile <-> role model with the account-lifecycle, RBAC,
-- configurable-scope, MFA, and identity/access-audit concepts approved
-- for this phase (see DECISIONS.md D-024-D-030,
-- reviews/006-phase-1h-c-planning.md). 002 is left as originally
-- written, corrected only with a header pointer to this file — see this
-- codebase's own append-only-correction discipline (D-009) applied to
-- schema evolution, not a rewrite of an already-numbered migration.
--
-- DEV-only, forward-looking infrastructure: no PERSISTENT DEV/PROD
-- instance exists for this project (matches every other migration
-- here), but this file (and its rollback,
-- rollback/013_identity_extension.rollback.sql) WAS applied
-- successfully, end-to-end with 000-012, against a local ephemeral
-- Postgres 16 instance during this phase's own work, then rolled back
-- and the throwaway database dropped — the same "proven locally, not
-- deployed anywhere" standard the original 000-012 migrations were held
-- to (see ARCHITECTURE.md §7). See database/scripts/run_migrations.sh to
-- apply it against a real target database.
--
-- Mirrors the pilot's new IDENTITY_* Sheets (Apps Script:
-- SVMKPI_IDENTITY_CORE.gs and friends) column-for-column, the same
-- Sheet-maps-to-table discipline every other CONFIG_* area already
-- follows.

-- ── users: add account lifecycle + email verification + auth metadata ──
-- 002 already has auth_provider/auth_subject/email/display_name.
-- auth_subject's original NOT NULL assumed a provider-supplied
-- identifier always exists; Phase 1H-C's native registration path
-- (D-024) has no external subject yet, so it is relaxed to nullable
-- here rather than edited in place in 002.
ALTER TABLE users ALTER COLUMN auth_subject DROP NOT NULL;

ALTER TABLE users ADD COLUMN department text;
ALTER TABLE users ADD COLUMN account_status text NOT NULL DEFAULT 'PENDING_VERIFICATION'
  CHECK (account_status IN (
    'PENDING_VERIFICATION', 'PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'DISABLED', 'REJECTED'
  )); -- D-027's binding 6-state list; supersedes D-019's illustrative 7-state list
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
ALTER TABLE users ADD COLUMN status_changed_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE users ADD COLUMN status_changed_by uuid REFERENCES users(user_id);
COMMENT ON COLUMN users.account_status IS 'D-027. A non-ACTIVE account must not receive normal protected application access — enforced server-side (getAccessState()), never inferred client-side.';
COMMENT ON COLUMN users.department IS 'Registration-required field (Phase 1H-C approved scope). Free text, not a controlled list — no business rule depends on its value in this phase.';

CREATE INDEX idx_users_account_status ON users (account_status);
CREATE INDEX idx_users_email ON users (lower(email));

-- ── registration email verification (one-time code, never stored plain) ──
CREATE TABLE identity_verifications (
  user_id               uuid PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  code_hash             text NOT NULL, -- hash only; the plaintext code is never persisted, matches SETTINGS-era guest-password lesson (reviews/003) deliberately NOT repeated here
  expires_at            timestamptz NOT NULL,
  attempts              integer NOT NULL DEFAULT 0
);
COMMENT ON TABLE identity_verifications IS 'One pending verification per user. A verified user has this row deleted, not marked verified-in-place — see verifyRegistrationEmail() (Apps Script). Never stores the plaintext code.';

-- ── roles: seed USER alongside 002's ADMIN-only seed ──
-- 002's own header comment ("there is one Admin role... NOT a general
-- RBAC system") is now superseded by the Phase 1H-C approved scope
-- (D-026) — corrected here via this pointer, not by rewriting 002.
INSERT INTO roles (role_id, role_name) VALUES (2, 'USER');
COMMENT ON TABLE roles IS 'Phase 1H-C (D-026): extensible role catalog, no longer "exactly one role" — see 013_identity_extension.sql. Adding a role is a new row here plus role_permissions grants, never a code change.';

-- ── permissions: named capabilities, independent of role ──
CREATE TABLE permissions (
  permission_key        text PRIMARY KEY,
  description            text NOT NULL
);
COMMENT ON TABLE permissions IS 'D-026. A named capability an action checks for — e.g. REGISTRATION_APPROVE. Roles grant permissions (role_permissions); code checks permissions, not roles, wherever practical.';

INSERT INTO permissions (permission_key, description) VALUES
  ('REGISTRATION_APPROVE',  'Approve or reject a pending registration'),
  ('USER_MANAGE',           'Suspend, reactivate, or disable an existing account'),
  ('ROLE_ASSIGN',           'Grant or revoke a role on a user'),
  ('PERMISSION_ASSIGN',     'Grant or revoke a permission override on a user'),
  ('SCOPE_ASSIGN',          'Grant or revoke a system/region/store access scope on a user'),
  ('IDENTITY_AUDIT_VIEW',   'View the identity/access audit log');

CREATE TABLE role_permissions (
  role_id               smallint NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
  permission_key        text NOT NULL REFERENCES permissions(permission_key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);
COMMENT ON TABLE role_permissions IS 'D-026. ADMIN is seeded with every permission defined above; USER is seeded with none — narrower grants are additive rows, not a code change.';

INSERT INTO role_permissions (role_id, permission_key)
  SELECT 1, permission_key FROM permissions; -- role_id 1 = ADMIN (002's seed)

-- ── user_permissions: direct per-user permission grants, additive to role ──
-- The approved scope's frontend/service boundary lists assignRole(...)
-- and assignPermissions(...) as two separate operations — this table is
-- what the second one writes to. A user's effective permission set is
-- the union of their role(s)' permissions (role_permissions) and any
-- direct grants here; this table never REMOVES a role-derived
-- permission, only adds beyond it.
CREATE TABLE user_permissions (
  user_id               uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  permission_key        text NOT NULL REFERENCES permissions(permission_key) ON DELETE CASCADE,
  granted_at            timestamptz NOT NULL DEFAULT now(),
  granted_by            uuid REFERENCES users(user_id),
  PRIMARY KEY (user_id, permission_key)
);
COMMENT ON TABLE user_permissions IS 'D-026. Direct per-user permission grants, additive to whatever the user''s role(s) already provide via role_permissions — lets an admin extend one user''s access without inventing a new role for them.';

-- ── user_scope: configurable system/region/store access grants ──
CREATE TABLE user_scope (
  user_id               uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  scope_type            text NOT NULL CHECK (scope_type IN ('SYSTEM', 'REGION', 'STORE')),
  scope_value           text, -- NULL for SYSTEM (unrestricted); a region name for REGION; a Store ID for STORE
  granted_at            timestamptz NOT NULL DEFAULT now(),
  granted_by            uuid REFERENCES users(user_id),
  PRIMARY KEY (user_id, scope_type, scope_value)
);
COMMENT ON TABLE user_scope IS 'D-026. A user may hold multiple scope grants (e.g. two REGION rows). scope_value is validated against the requested type by the application layer (a STORE row should reference a real Store ID — store_versions.store_id — but no FK is declared here, since Store IDs are versioned/entity-scoped, not a single lookup table row).';

-- ── MFA (D-028): native TOTP, a documented temporary exception to D-022 ──
CREATE TABLE identity_mfa (
  user_id               uuid PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  status                text NOT NULL DEFAULT 'NOT_ENROLLED' CHECK (status IN ('NOT_ENROLLED', 'ENROLLED')),
  method                text NOT NULL DEFAULT 'TOTP' CHECK (method IN ('TOTP')),
  secret                text, -- base32 TOTP shared secret; NULL until enrolled. See D-028 for why SVMI stores this natively for now.
  enrolled_at           timestamptz,
  last_verified_at      timestamptz
);
COMMENT ON TABLE identity_mfa IS 'D-028: a documented, temporary exception to D-022 (SVMI does not normally store MFA secrets) — no external Identity Provider is selected yet (D-024) to own this instead. Kept in its own table, never joined into any general user-listing query, so the secret is never an incidental part of a broader SELECT.';

-- ── identity/access audit (D-023/D-029) — a separate domain from audit_logs ──
CREATE TABLE identity_audit_log (
  audit_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at           timestamptz NOT NULL DEFAULT now(),
  event_type            text NOT NULL CHECK (event_type IN (
    'REGISTRATION_SUBMITTED', 'EMAIL_VERIFIED', 'REGISTRATION_APPROVED', 'REGISTRATION_REJECTED',
    'ACCOUNT_ACTIVATED', 'ACCOUNT_SUSPENDED', 'ACCOUNT_REACTIVATED', 'ACCOUNT_DISABLED',
    'ROLE_CHANGED', 'PERMISSION_CHANGED', 'SCOPE_CHANGED',
    'MFA_ENROLLED', 'MFA_RESET', 'MFA_VERIFY_FAILED',
    'LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGOUT'
  )),
  actor_user_id         uuid REFERENCES users(user_id), -- NULL for a self-service event with no actor yet (e.g. REGISTRATION_SUBMITTED)
  target_user_id        uuid REFERENCES users(user_id),
  details               text -- short human-readable summary; NEVER a secret value (verification code, MFA secret) — enforced by the Apps Script audit-writer helper only accepting non-secret fields, mirrored here by convention
);
COMMENT ON TABLE identity_audit_log IS 'D-023/D-029. Separate domain from audit_logs (which stays scoped to CONFIG_* configuration mutations only, 009_audit_logs.sql) — identity/access events are a different actor set and sensitivity. Append-only: see database/scripts/harden_grants.sql for the REVOKE UPDATE, DELETE applied to this table.';

CREATE INDEX idx_identity_audit_target ON identity_audit_log (target_user_id);
CREATE INDEX idx_identity_audit_occurred_at ON identity_audit_log (occurred_at);
CREATE INDEX idx_identity_audit_event_type ON identity_audit_log (event_type);
