-- 007_kpi_and_system_configuration.sql
-- KPI: mirrors CONFIG_KPI (SVMKPI_KPI_CONFIG.gs) — infrastructure ONLY.
-- DOCUMENTED GAP, preserved verbatim from the spreadsheet system: no KPI
-- scoring algorithm exists anywhere in SVMI to consume a weight/target
-- (buildKPI2026()/getKPI2026Report() are a pure visit-count tracker).
-- This schema stores the configuration values; it does NOT invent what
-- they mean or wire them into any calculation. Do not add a "score"
-- column or a computed KPI result here — that would be inventing the
-- exact business rule this project has repeatedly, deliberately declined
-- to guess.
CREATE TABLE kpi_configurations (
  kpi_id                text PRIMARY KEY, -- normalized KPI name (interim identity, matches CONFIG_KPI)
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kpi_configuration_versions (
  version_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kpi_id                text NOT NULL REFERENCES kpi_configurations(kpi_id) ON DELETE RESTRICT,
  version_num           integer NOT NULL CHECK (version_num > 0),
  target_value          numeric,
  target_type           text CHECK (target_type IS NULL OR target_type IN ('NUMERIC', 'PERCENTAGE', 'COUNT')),
  weight                numeric,
  purpose_id            text REFERENCES purposes(purpose_id), -- optional link to a Purpose; no cross-purpose inheritance implied
  effective_from        date NOT NULL,
  effective_to          date,
  envelope_status       text NOT NULL DEFAULT 'ACTIVE' CHECK (envelope_status IN ('ACTIVE', 'INACTIVE')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES users(user_id),
  reason                text,
  CONSTRAINT chk_kpi_effective_range CHECK (svmi_check_effective_range(effective_from, effective_to)),
  CONSTRAINT chk_kpi_target_percentage_range CHECK (
    target_type IS DISTINCT FROM 'PERCENTAGE' OR (target_value >= 0 AND target_value <= 100)
  ),
  UNIQUE (kpi_id, version_num),
  UNIQUE (kpi_id, effective_from)
);
CREATE INDEX idx_kpi_configuration_versions_kpi_id ON kpi_configuration_versions (kpi_id);

-- System: mirrors CONFIG_SYSTEM (SVMKPI_CONFIG.gs) — deliberately empty
-- of any populated business setting as of this phase (see that file's
-- own schema comment: almost every "system setting" candidate is either
-- developer-controlled code or already lives in SETTINGS, and moving
-- those now would be an unrequested, out-of-scope migration). This
-- table exists so a genuinely new, code-known business setting has
-- somewhere principled to go later — settingKey is NOT a free-form
-- admin-typed string, matching the source system's own discipline.
CREATE TABLE system_configurations (
  setting_key           text PRIMARY KEY,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE system_configuration_versions (
  version_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key           text NOT NULL REFERENCES system_configurations(setting_key) ON DELETE RESTRICT,
  version_num           integer NOT NULL CHECK (version_num > 0),
  setting_value         text NOT NULL,
  setting_label         text,
  effective_from        date NOT NULL,
  effective_to          date,
  envelope_status       text NOT NULL DEFAULT 'ACTIVE' CHECK (envelope_status IN ('ACTIVE', 'INACTIVE')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES users(user_id),
  reason                text,
  CONSTRAINT chk_system_effective_range CHECK (svmi_check_effective_range(effective_from, effective_to)),
  UNIQUE (setting_key, version_num),
  UNIQUE (setting_key, effective_from)
);
COMMENT ON TABLE system_configurations IS 'Intentionally empty as of this migration — no rows are seeded. See docs/01-architecture.md''s "Implementation Notes".';
