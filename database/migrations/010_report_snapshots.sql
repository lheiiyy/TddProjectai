-- 010_report_snapshots.sql
-- Mirrors REPORT_SNAPSHOTS (SVMKPI_REPORT_SNAPSHOT.gs, Phase 1E) — the
-- CANONICAL historical report artifact. REPORT_<year> presentation
-- sheets are NOT reproduced as tables here at all: they are a rendering
-- of report_snapshots, exactly as the spreadsheet's own REPORT_<year>
-- sheet is only ever regenerated FROM a finalized snapshot, never a
-- second source of truth (see docs/01-architecture.md's "Snapshot
-- architecture").
--
-- Normalization beyond the spreadsheet's single Result-JSON-blob column:
-- the frozen result's store-level rows and compliance gaps are ALSO
-- stored as real relational child rows (report_snapshot_store_results,
-- report_snapshot_compliance_gaps) so they can be queried/joined
-- directly — while result_json keeps the COMPLETE, byte-for-byte frozen
-- result as the ultimate source of truth for reproduction, exactly
-- mirroring the source system's own precedent (CONFIG_AUDIT's Previous/
-- New Value columns already use a compact serialized representation for
-- exactly this kind of computed, read-only artifact — Phase 1E's own
-- header comment documents this precedent explicitly). Both
-- representations are written together, from the SAME calculation, at
-- the SAME moment (finalizeReport()/supersedeReportSnapshot()'s
-- equivalent import path) — the children are a queryable projection of
-- result_json, never an independent recalculation.

CREATE TABLE report_snapshots (
  snapshot_id                  text PRIMARY KEY, -- 'REPORT-<year>-v<n>', matches the spreadsheet's own convention exactly
  reporting_year                integer NOT NULL,
  snapshot_version               integer NOT NULL CHECK (snapshot_version > 0),
  status                         text NOT NULL CHECK (status IN ('DRAFT', 'FINALIZED', 'SUPERSEDED')),
  created_at                     timestamptz NOT NULL DEFAULT now(),
  created_by                     uuid REFERENCES users(user_id),
  finalized_at                   timestamptz,
  finalized_by                   uuid REFERENCES users(user_id),
  evaluation_date                date NOT NULL,
  reason                         text NOT NULL,
  supersedes_snapshot_id         text REFERENCES report_snapshots(snapshot_id),
  calculation_timestamp          timestamptz NOT NULL,
  -- Configuration provenance — typed where the source architecture
  -- genuinely resolves to ONE answer (Risk, a global singleton);
  -- explanatory notes where it does not (KPI has no consuming algorithm;
  -- Purpose/Store have independent per-entity histories, never one
  -- report-wide version) — see report_snapshot_compliance_provenance for
  -- the narrow per-category list Compliance genuinely needs.
  risk_config_version_id         uuid REFERENCES risk_rule_versions(version_id),
  risk_config_source             text,
  kpi_config_note                text,
  purpose_store_config_note      text,
  -- The complete, byte-for-byte frozen calculation — see this file's
  -- header comment for why this coexists with the normalized children
  -- below rather than replacing them.
  result_json                    jsonb NOT NULL,
  UNIQUE (reporting_year, snapshot_version)
);
COMMENT ON TABLE report_snapshots IS 'FINALIZED/SUPERSEDED rows are immutable except for the status column itself flipping FINALIZED->SUPERSEDED during a supersession (see docs/01-architecture.md''s "Historical immutability model") — result_json and every other column are NEVER updated after insert. No production code path writes status=DRAFT here (a draft is always a dynamic, unpersisted calculation) — DRAFT remains a valid CHECK value only for schema completeness/future extensibility, exactly mirroring REPORT_SNAPSHOT_STATUS''s own documented rationale in SVMKPI_REPORT_SNAPSHOT.gs.';

CREATE INDEX idx_report_snapshots_year ON report_snapshots (reporting_year);
CREATE INDEX idx_report_snapshots_year_status ON report_snapshots (reporting_year, status);
-- Enforces "at most one FINALIZED snapshot per reporting year at a time"
-- at the database level, not just in application logic — a genuine
-- strengthening PostgreSQL's partial unique index makes possible that
-- the spreadsheet engine could only enforce by re-reading under a lock.
CREATE UNIQUE INDEX uq_report_snapshots_one_finalized_per_year
  ON report_snapshots (reporting_year)
  WHERE status = 'FINALIZED';

CREATE TABLE report_snapshot_store_results (
  id                     bigserial PRIMARY KEY,
  snapshot_id            text NOT NULL REFERENCES report_snapshots(snapshot_id) ON DELETE CASCADE,
  store_id               text NOT NULL REFERENCES stores(store_id),
  brand                  text,
  region                 text,
  category               text,
  last_visit_date        date,
  last_purpose           text,
  days_since             integer,
  total_ytd              integer NOT NULL DEFAULT 0,
  store_ytd              integer NOT NULL DEFAULT 0,
  failed_count           integer NOT NULL DEFAULT 0,
  curing_count           integer NOT NULL DEFAULT 0,
  risk_score             numeric NOT NULL DEFAULT 0,
  risk_tier              text CHECK (risk_tier IN ('LOW', 'MEDIUM', 'HIGH')),
  action                 text,
  attention_reason       text,
  UNIQUE (snapshot_id, store_id)
);
COMMENT ON TABLE report_snapshot_store_results IS 'A queryable projection of report_snapshots.result_json->''storeRisk'' for this snapshot — frozen at insert time, never recalculated or updated.';
CREATE INDEX idx_snapshot_store_results_snapshot ON report_snapshot_store_results (snapshot_id);
CREATE INDEX idx_snapshot_store_results_store ON report_snapshot_store_results (store_id);

CREATE TABLE report_snapshot_compliance_gaps (
  id                     bigserial PRIMARY KEY,
  snapshot_id            text NOT NULL REFERENCES report_snapshots(snapshot_id) ON DELETE CASCADE,
  store_id               text NOT NULL REFERENCES stores(store_id),
  category               text,
  window_label           text,
  ytd_visits             integer NOT NULL DEFAULT 0,
  required_count         integer NOT NULL,
  actual_count           integer NOT NULL,
  UNIQUE (snapshot_id, store_id)
);
COMMENT ON TABLE report_snapshot_compliance_gaps IS 'A queryable projection of report_snapshots.result_json->''complianceGaps'' for this snapshot — frozen at insert time.';
CREATE INDEX idx_snapshot_compliance_gaps_snapshot ON report_snapshot_compliance_gaps (snapshot_id);

CREATE TABLE report_snapshot_compliance_provenance (
  id                     bigserial PRIMARY KEY,
  snapshot_id            text NOT NULL REFERENCES report_snapshots(snapshot_id) ON DELETE CASCADE,
  category               text NOT NULL,
  compliance_config_version_id uuid REFERENCES compliance_rule_versions(version_id),
  source                 text NOT NULL, -- 'CONFIG_COMPLIANCE' | 'HARDCODED_DEFAULT' | 'NONE'
  UNIQUE (snapshot_id, category)
);
COMMENT ON TABLE report_snapshot_compliance_provenance IS 'The narrow, per-category provenance list Phase 1E deliberately used instead of pretending Compliance resolves to one global version — a queryable projection of report_snapshots.result_json (provenance section), frozen at insert time.';
