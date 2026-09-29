-- 013_cross_training.sql
-- Cross-training / station-validation records, mirroring the
-- "CROSS TRAINED STAFFS MONITORING" spreadsheet (one block per brand, one
-- row per staff member validated on a second station). This is the data
-- behind the KPI Monitoring Hub's "Staff Proficiency / Cross-Training" KRA.
--
-- Source values are free text (e.g. "ISTV SVC-92/RDR-95/CAS-93", blank
-- grades, "FAILED" in a trailing column), so raw text is kept verbatim and
-- numeric grades are parsed into separate nullable columns. Nothing is
-- guessed: an unparseable grade is NULL and the raw text is still there.

CREATE TABLE cross_training_validations (
  validation_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand               text NOT NULL,
  validated_on        date NOT NULL,
  store_name          text NOT NULL,  -- as written in the sheet; not FK'd to stores (sheet names are informal)
  staff_name          text NOT NULL,
  mother_station      text NOT NULL,
  station_validated   text NOT NULL,  -- the second station the staff member was cross-trained on
  tech_val_grade_raw  text,
  tech_val_grade      numeric(5,2) CHECK (tech_val_grade IS NULL OR tech_val_grade BETWEEN 0 AND 100),
  exam_grade_raw      text,
  exam_grade          numeric(5,2) CHECK (exam_grade IS NULL OR exam_grade BETWEEN 0 AND 100),
  training_dept       text,           -- facilitator who ran the validation
  remarks             text,
  passed              boolean,        -- NULL = not determinable from source; set explicitly, never inferred from blanks
  source_sheet_id     text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand, validated_on, store_name, staff_name, station_validated)
);
COMMENT ON TABLE cross_training_validations IS 'One row per cross-training station validation. Raw grade text is preserved in *_raw; parsed numeric grades are NULL when the source is blank or a compound value.';
CREATE INDEX idx_ctv_validated_on ON cross_training_validations (validated_on);
CREATE INDEX idx_ctv_brand ON cross_training_validations (brand);

-- Read model for KPI-MONITORING-HUB: aggregates only, no staff names.
CREATE VIEW v_cross_training_monthly AS
SELECT
  date_trunc('month', validated_on)::date AS month,
  brand,
  count(*)                                AS validations,
  count(*) FILTER (WHERE passed IS TRUE)  AS passed,
  count(*) FILTER (WHERE passed IS FALSE) AS failed,
  round(avg(tech_val_grade), 2)           AS avg_tech_val_grade,
  round(avg(exam_grade), 2)               AS avg_exam_grade
FROM cross_training_validations
GROUP BY 1, 2;
COMMENT ON VIEW v_cross_training_monthly IS 'Names-free monthly rollup consumed by KPI-MONITORING-HUB (export via database/scripts/export_cross_training.sh).';
