-- 006_compliance_configuration.sql
-- Mirrors CONFIG_COMPLIANCE (SVMKPI_COMPLIANCE_CONFIG.gs) — genuinely
-- per-CATEGORY (not per-store; a store's category, itself effective-
-- dated, is resolved first via store_versions, then the category's rule
-- is looked up here — see resolveComplianceConfigurationAsOf()).
--
-- The 4 pre-Phase-1D hardcoded categories (NCR, NEAR PROVINCIAL, FAR
-- PROVINCIAL, FLIGHT PROVINCIAL — CMP_DEFAULT_RULES) are seeded as real
-- root rows at migration time for the same reason Purposes' 4 legacy
-- entries are (see 004_visitors_and_purposes.sql) — an explicit row
-- instead of an implicit hardcoded map, not a behavior change.

CREATE TABLE compliance_rules (
  category              text PRIMARY KEY, -- e.g. 'NCR', 'FAR PROVINCIAL' — matches CONFIG_COMPLIANCE's entity ID
  is_legacy_default     boolean NOT NULL DEFAULT false, -- true for the 4 CMP_DEFAULT_RULES categories
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE compliance_rule_versions (
  version_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category              text NOT NULL REFERENCES compliance_rules(category) ON DELETE RESTRICT,
  version_num           integer NOT NULL CHECK (version_num > 0),
  cadence_type          text NOT NULL CHECK (cadence_type IN ('MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL')),
  cadence_days          integer NOT NULL CHECK (cadence_days > 0),
  -- Derived FROM cadence_type at write time (never independently
  -- editable — mirrors _cal_familyFromCadenceType(), SVMKPI_CALENDAR.gs
  -- — so this column can never drift out of sync with cadence_type).
  period_definition     text NOT NULL CHECK (period_definition IN ('MONTH', 'QUARTER', 'SEMI_ANNUAL')),
  required_count        integer NOT NULL DEFAULT 1 CHECK (required_count > 0),
  grace_days            integer NOT NULL DEFAULT 0 CHECK (grace_days >= 0),
  effective_from        date NOT NULL,
  effective_to          date,
  envelope_status       text NOT NULL DEFAULT 'ACTIVE' CHECK (envelope_status IN ('ACTIVE', 'INACTIVE')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES users(user_id),
  reason                text,
  CONSTRAINT chk_compliance_effective_range CHECK (svmi_check_effective_range(effective_from, effective_to)),
  UNIQUE (category, version_num),
  UNIQUE (category, effective_from)
);
COMMENT ON TABLE compliance_rule_versions IS 'Period-to-date compliance evaluation (sl_getComplianceGaps()) resolves a store''s category as of the evaluation date, then this table''s rule for that category as of the SAME date — a 2027 evaluation must never use a rule created/effective only in 2026, and vice versa.';
CREATE INDEX idx_compliance_rule_versions_effective_from ON compliance_rule_versions (category, effective_from);
