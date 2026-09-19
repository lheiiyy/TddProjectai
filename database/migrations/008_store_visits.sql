-- 008_store_visits.sql
-- Mirrors MASTER_LOG — the permanent event source (Phase 1D/1E's own
-- repeated principle: "MASTER_LOG remains the event source" is preserved
-- here as "store_visits remains the event source").
--
-- Normalization applied per this phase's own explicit instruction
-- ("duplicate/repeated information that should become relational
-- references instead of duplicated columns"):
--   - MASTER_LOG!F ("Visited By") is a pipe-delimited multi-visitor
--     STRING column (e.g. "LEO | GIO") — becomes a proper many-to-many
--     junction table (store_visit_visitors) instead of a delimited
--     string, so each visitor on a visit is a real foreign-key row, not
--     text that has to be re-split by every consumer.
--   - Store/Brand/Region are NOT duplicated onto every visit row here —
--     they are resolved historically via store_id -> store_versions (the
--     spreadsheet duplicates Brand/Region onto every MASTER_LOG row
--     directly; that redundancy is intentionally NOT reproduced here,
--     since it can drift from the authoritative store_versions value —
--     see docs/03-migration-mapping.md for the exact transformation).
--   - Purpose is a foreign key to purposes(purpose_id), never a bare
--     repeated string.
-- The "candidate" inspection_findings/finding_categories tables from
-- this phase's own suggested list were evaluated and NOT created — see
-- docs/01-architecture.md's "Implementation Notes": no such child entity
-- exists in the real source data (a Purpose value like 'FAILED QA/MS' is
-- already a complete, single-row fact about one visit, not a parent
-- record with its own list of child findings). Inventing one would
-- violate this project's own repeated "no business-rule invention" rule.

CREATE TABLE store_visits (
  store_visit_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id              text NOT NULL REFERENCES stores(store_id) ON DELETE RESTRICT,
  visited_at            date NOT NULL, -- MASTER_LOG!B "Date Visited"
  purpose_id            text NOT NULL REFERENCES purposes(purpose_id) ON DELETE RESTRICT,
  remarks               text,
  recorded_at           timestamptz NOT NULL, -- MASTER_LOG!A "Timestamp" (when the row was submitted)
  created_by            uuid REFERENCES users(user_id),
  source_row_ref        text -- optional provenance: original spreadsheet row reference during migration only (see import/), never used as identity
);
COMMENT ON TABLE store_visits IS 'One row per MASTER_LOG event. Immutable once written except by the same submission-lock rules the spreadsheet already enforces (partial-accept duplicate handling — see docs/03-migration-mapping.md). This is the permanent event source that report_snapshots freeze a calculation OF, never a table report_snapshots writes back into.';

CREATE INDEX idx_store_visits_store_id ON store_visits (store_id);
CREATE INDEX idx_store_visits_visited_at ON store_visits (visited_at);
CREATE INDEX idx_store_visits_purpose_id ON store_visits (purpose_id);
-- Supports getAvailableReportingYears()'s equivalent (reporting_periods
-- view, 012_reporting_periods_view.sql) without a full table scan.
CREATE INDEX idx_store_visits_visited_at_year ON store_visits ((EXTRACT(YEAR FROM visited_at)));

CREATE TABLE store_visit_visitors (
  store_visit_id        uuid NOT NULL REFERENCES store_visits(store_visit_id) ON DELETE CASCADE,
  visitor_id            text NOT NULL REFERENCES visitors(visitor_id) ON DELETE RESTRICT,
  PRIMARY KEY (store_visit_id, visitor_id)
);
COMMENT ON TABLE store_visit_visitors IS 'Replaces MASTER_LOG!F''s pipe-delimited "LEO | GIO" string with real rows — the exact normalization this phase''s own instructions asked for.';
CREATE INDEX idx_store_visit_visitors_visitor_id ON store_visit_visitors (visitor_id);

-- Phase 0.5's exact-duplicate rule (same Store + same Visitor + same
-- calendar date is a duplicate submission, warned/skipped rather than
-- re-recorded) needs store_id/visited_at (store_visits) AND visitor_id
-- (store_visit_visitors) together — a single cross-table SQL constraint
-- would need either a denormalized column or a trigger. See
-- docs/01-architecture.md's "Implementation Notes": this phase enforces
-- it at the application layer (import/validation tooling), matching
-- where the spreadsheet system enforces it today (inside
-- processSubmissionAsync()'s LockService section, not a spreadsheet-
-- native constraint either) — a trigger-based enforcement is flagged as
-- a follow-up, not implemented here to avoid inventing new production
-- behavior beyond what was asked.
