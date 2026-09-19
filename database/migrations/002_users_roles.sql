-- 002_users_roles.sql
-- Authentication identity <-> SVMI profile <-> role, kept as separate
-- concepts per the target architecture (see docs/01-architecture.md,
-- "Authentication and authorization boundary"). The CURRENT
-- spreadsheet-backed system has no `users` table at all today — identity
-- is just "whichever Google account is signed in" (Session.getActiveUser())
-- and authorization is "is that email on the SETTINGS!G admin list"
-- (sl_isAdmin()/_getAdminEmails(), SVMKPI_ACCESS.gs). This schema is
-- forward architecture for the eventual migration, not a reflection of
-- data that exists yet — there is nothing to import into these three
-- tables from the spreadsheet (see docs/03-migration-mapping.md).
--
-- Business rule #9 (SVMI — Database Architecture & Migration Phase):
-- "There is one Admin role." `roles` is seeded with exactly ADMIN — this
-- is NOT a general RBAC system; it exists so the CURRENT one-role reality
-- has an explicit row instead of an implicit hardcoded email list, never
-- to invent multiple roles/permissions the app doesn't have.

CREATE TABLE users (
  user_id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Authentication identity — provider-independent by design (today:
  -- Google via Session.getActiveUser()/Apps Script's own OAuth; the
  -- column shape does not assume Google forever).
  auth_provider         text NOT NULL DEFAULT 'google',
  auth_subject          text NOT NULL, -- the provider's stable identifier (Google account email today)
  email                 text NOT NULL,
  display_name          text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  last_seen_at          timestamptz,
  UNIQUE (auth_provider, auth_subject)
);
COMMENT ON TABLE users IS 'Authentication identity only. No SVMI business meaning lives here — see user_profiles.';

-- Kept separate from `users` per the authentication/profile boundary —
-- today this is intentionally minimal (the spreadsheet system has no
-- per-user profile data beyond "is this email an admin"), never padded
-- with invented fields.
CREATE TABLE user_profiles (
  user_id               uuid PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE user_profiles IS 'SVMI-specific profile data, separate from authentication identity. Intentionally minimal today — no profile field exists in the current spreadsheet-backed system beyond identity + admin membership (see user_roles).';

CREATE TABLE roles (
  role_id               smallint PRIMARY KEY,
  role_name             text NOT NULL UNIQUE
);
COMMENT ON TABLE roles IS 'Exactly one role exists today (ADMIN) — see this file''s header comment. Not a general permissions system.';

INSERT INTO roles (role_id, role_name) VALUES (1, 'ADMIN');

CREATE TABLE user_roles (
  user_id               uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role_id               smallint NOT NULL REFERENCES roles(role_id) ON DELETE RESTRICT,
  granted_at            timestamptz NOT NULL DEFAULT now(),
  granted_by            uuid REFERENCES users(user_id),
  PRIMARY KEY (user_id, role_id)
);
COMMENT ON TABLE user_roles IS 'Membership in a role. Authorization decisions (see docs/01-architecture.md) are made server-side by checking this table — never by trusting a client-supplied isAdmin/role value.';

CREATE INDEX idx_user_roles_role_id ON user_roles (role_id);
