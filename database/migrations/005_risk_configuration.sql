-- 005_risk_configuration.sql
-- Mirrors CONFIG_RISK (SVMKPI_RISK_CONFIG.gs) — a GLOBAL singleton rule
-- set (the existing canonical _computeStoreRisk() algorithm has no
-- per-store dimension for thresholds/weights), versioned/effective-dated
-- exactly like every other configuration area. Do NOT add a store_id
-- column here — that would misrepresent behavior the algorithm doesn't
-- have (see SVMKPI_RISK_CONFIG.gs's own header comment).

CREATE TABLE risk_rule_sets (
  risk_rule_set_id      smallint PRIMARY KEY DEFAULT 1,
  CONSTRAINT chk_risk_rule_sets_singleton CHECK (risk_rule_set_id = 1)
);
COMMENT ON TABLE risk_rule_sets IS 'Deliberately a singleton (one row, id=1) — mirrors CFG_SINGLETON_ENTITY (SVMKPI_CONFIG.gs). The existing risk-scoring algorithm has exactly one global rule set, never a per-store one.';
INSERT INTO risk_rule_sets (risk_rule_set_id) VALUES (1);

CREATE TABLE risk_rule_versions (
  version_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  risk_rule_set_id      smallint NOT NULL REFERENCES risk_rule_sets(risk_rule_set_id) ON DELETE RESTRICT,
  version_num           integer NOT NULL CHECK (version_num > 0),
  low_threshold         numeric NOT NULL,
  medium_threshold      numeric NOT NULL,
  high_threshold        numeric NOT NULL,
  -- Legacy named per-purpose weights (pre-Phase-1D shape, still the
  -- fallback step 2 in risk_resolvePurposeWeight()'s 3-step chain —
  -- see docs/01-architecture.md). Nullable: a version may only change
  -- thresholds without touching weights.
  weight_failed_qa_ms   numeric,
  weight_store_visit    numeric,
  weight_curing_support numeric,
  weight_tltc           numeric,
  effective_from        date NOT NULL,
  effective_to          date,
  envelope_status       text NOT NULL DEFAULT 'ACTIVE' CHECK (envelope_status IN ('ACTIVE', 'INACTIVE')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES users(user_id),
  reason                text,
  CONSTRAINT chk_risk_effective_range CHECK (svmi_check_effective_range(effective_from, effective_to)),
  CONSTRAINT chk_risk_threshold_order CHECK (low_threshold <= medium_threshold AND medium_threshold <= high_threshold),
  UNIQUE (risk_rule_set_id, version_num),
  UNIQUE (risk_rule_set_id, effective_from)
);
COMMENT ON TABLE risk_rule_versions IS 'Feeds the UNCHANGED canonical _computeStoreRisk() algorithm with configuration-driven numbers. Never a second scoring algorithm. Historical resolution: "as of date D" picks the version with the latest effective_from <= D — a later version must never affect an earlier date''s calculation.';
CREATE INDEX idx_risk_rule_versions_effective_from ON risk_rule_versions (risk_rule_set_id, effective_from);
