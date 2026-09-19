-- 004_visitors_and_purposes.sql
-- Visitors (CONFIG_VISITORS) and Purposes (CONFIG_PURPOSES +
-- APPROVED_PURPOSES) — both use normalized-name entity identity in the
-- source system today (an interim identity choice Phase 1A/1B already
-- disclosed: "a real Visitor/Purpose ID is a later migration, out of
-- scope"). This schema keeps that same interim identity (visitor_id/
-- purpose_id are the normalized name itself) rather than inventing a
-- surrogate identity the source system doesn't have yet — see
-- docs/01-architecture.md's "Implementation Notes" for why.

CREATE TABLE visitors (
  visitor_id            text PRIMARY KEY, -- normalized visitor name (interim identity, matches CONFIG_VISITORS)
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE visitor_versions (
  version_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id            text NOT NULL REFERENCES visitors(visitor_id) ON DELETE RESTRICT,
  version_num           integer NOT NULL CHECK (version_num > 0),
  visitor_name          text NOT NULL,
  effective_from        date NOT NULL,
  effective_to          date,
  envelope_status       text NOT NULL DEFAULT 'ACTIVE' CHECK (envelope_status IN ('ACTIVE', 'INACTIVE')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES users(user_id),
  reason                text,
  CONSTRAINT chk_visitor_effective_range CHECK (svmi_check_effective_range(effective_from, effective_to)),
  UNIQUE (visitor_id, version_num),
  UNIQUE (visitor_id, effective_from)
);
CREATE INDEX idx_visitor_versions_visitor_id ON visitor_versions (visitor_id);

-- Purposes: the 4 legacy purposes (STORE VISIT, TLTC, FAILED QA/MS,
-- CURING/SUPPORT — SVMKPI_CORE.gs's APPROVED_PURPOSES) have ALWAYS
-- existed in the spreadsheet system WITHOUT ever needing a
-- CONFIG_PURPOSES row (see purpose_getConfigurationStatus()'s own
-- documented two-tier "exists" concept). In PostgreSQL every purpose
-- MUST have a root row (there is no implicit-existence-via-hardcoded-
-- array escape hatch here) — migration seeds exactly those 4 (see
-- database/seed/dev_seed.sql and docs/03-migration-mapping.md); this is
-- a normalization improvement (an explicit row instead of an implicit
-- list), not a change to which purposes exist or how they behave.
CREATE TABLE purposes (
  purpose_id            text PRIMARY KEY, -- normalized purpose name (interim identity, matches CONFIG_PURPOSES)
  is_legacy             boolean NOT NULL DEFAULT false, -- true for the 4 APPROVED_PURPOSES seeded at migration time
  created_at            timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE purposes IS 'is_legacy=true marks the 4 purposes that exist without deliberate configuration (SVMKPI_CORE.gs APPROVED_PURPOSES) — informational only; it does NOT grant KPI/Risk configuration. A new (is_legacy=false) purpose never inherits another purpose''s configuration — see purpose_versions.risk_weight and kpi_configuration_versions.purpose_id.';

CREATE TABLE purpose_versions (
  version_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose_id            text NOT NULL REFERENCES purposes(purpose_id) ON DELETE RESTRICT,
  version_num           integer NOT NULL CHECK (version_num > 0),
  -- Deliberate, per-purpose risk-scoring input (Phase 1D). NULL means
  -- "no risk configuration for this purpose" — never defaulted, never
  -- inherited from another purpose. See risk_rule_versions for the
  -- separate legacy-named-field fallback the 4 legacy purposes still use.
  risk_weight           numeric,
  effective_from        date NOT NULL,
  effective_to          date,
  envelope_status       text NOT NULL DEFAULT 'ACTIVE' CHECK (envelope_status IN ('ACTIVE', 'INACTIVE')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES users(user_id),
  reason                text,
  CONSTRAINT chk_purpose_effective_range CHECK (svmi_check_effective_range(effective_from, effective_to)),
  UNIQUE (purpose_id, version_num),
  UNIQUE (purpose_id, effective_from)
);
CREATE INDEX idx_purpose_versions_purpose_id ON purpose_versions (purpose_id);
