-- 009_audit_logs.sql
-- Mirrors CONFIG_AUDIT (SVMKPI_CONFIG.gs, cfg_getAuditLog()/_cfg_writeAudit())
-- column-for-column. Append-only: no UPDATE/DELETE grant is ever given
-- to the application role on this table (see docs/05-environments.md).
-- previous_value/new_value stay as short structured TEXT (a compact
-- "field=value; field=value" summary — see _cfg_summarize(), not a full
-- row dump) exactly as the source system already does, per this phase's
-- own instruction not to store unnecessarily huge raw payloads when a
-- structured representation already suffices.

CREATE TABLE audit_logs (
  audit_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at           timestamptz NOT NULL DEFAULT now(),
  actor_user_id         uuid REFERENCES users(user_id), -- nullable: mirrors sl_getCurrentUser() returning '' when identity can't be resolved
  entity_type           text NOT NULL, -- 'STORES' | 'VISITORS' | 'PURPOSES' | 'RISK' | 'COMPLIANCE' | 'KPI' | 'SYSTEM' | 'REPORT'
  entity_id             text NOT NULL,
  action                text NOT NULL CHECK (action IN ('CREATE', 'ACTIVATE', 'DEACTIVATE', 'ROLLBACK', 'FINALIZE', 'SUPERSEDE')),
  previous_value        text,
  new_value             text,
  effective_from        date,
  effective_to          date,
  reason                text,
  version_num           integer,
  -- Explicit backdating flags — the source system infers "was this
  -- backdated" from effective_from vs. created_at rather than storing a
  -- flag; this schema makes it an explicit, queryable column instead
  -- (an improvement enabled by real columns, not a behavior change).
  was_backdated         boolean NOT NULL DEFAULT false,
  backdate_confirmed    boolean NOT NULL DEFAULT false
);
COMMENT ON TABLE audit_logs IS 'Append-only. Mirrors CONFIG_AUDIT exactly (entity_type=Area, entity_id=Entity ID, action, previous_value/new_value, effective_from/to, reason, version_num) plus explicit backdating flags. No UPDATE or DELETE is ever performed against this table by the application.';

CREATE INDEX idx_audit_logs_entity ON audit_logs (entity_type, entity_id);
CREATE INDEX idx_audit_logs_occurred_at ON audit_logs (occurred_at);
CREATE INDEX idx_audit_logs_action ON audit_logs (action);
CREATE INDEX idx_audit_logs_actor ON audit_logs (actor_user_id);

-- Defense in depth: revoke UPDATE/DELETE from the application role once
-- that role exists (see docs/05-environments.md's role-provisioning
-- script) — documented here so the intent travels with the schema even
-- before the role is created in a given environment.
COMMENT ON COLUMN audit_logs.audit_id IS 'Never updated after insert. See database/scripts/create_roles.sql for the REVOKE UPDATE, DELETE that enforces this at the database level, not just by application convention.';
