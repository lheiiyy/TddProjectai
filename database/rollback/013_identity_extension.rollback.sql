DROP TABLE IF EXISTS identity_audit_log;
DROP TABLE IF EXISTS identity_mfa;
DROP TABLE IF EXISTS user_scope;
DROP TABLE IF EXISTS user_permissions;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS permissions;
DELETE FROM roles WHERE role_id = 2; -- USER, seeded by 013 — leaves 002's ADMIN (role_id 1) intact
DROP TABLE IF EXISTS identity_verifications;
DROP INDEX IF EXISTS idx_users_email;
DROP INDEX IF EXISTS idx_users_account_status;
ALTER TABLE users DROP COLUMN IF EXISTS status_changed_by;
ALTER TABLE users DROP COLUMN IF EXISTS status_changed_at;
ALTER TABLE users DROP COLUMN IF EXISTS email_verified_at;
ALTER TABLE users DROP COLUMN IF EXISTS account_status;
ALTER TABLE users DROP COLUMN IF EXISTS department;
ALTER TABLE users ALTER COLUMN auth_subject SET NOT NULL;
