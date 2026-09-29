-- 014_attendance_scheduling.sql
-- Attendance, training scheduling and monitoring (KPI Monitoring Hub).
--
-- Numbered 014, not 013: the hub README already refers to a
-- 013_cross_training.sql that is not in this folder, so 013 is left free.
--
-- Data contract: the three pilot Google Sheets, unchanged
--   * "Training Program & Delivery Monitoring 2026" / SESSION_LOG -> training_sessions
--   * "TDD Team Attendance Monitoring 2026" / ATTENDANCE_LOG       -> facilitator_daily_attendance
-- Scope: attendance of facilitators / trainers / Training & Development team
-- members ONLY. Trainee (participant) attendance is deliberately out of scope;
-- the "Training Attendance Monitoring 2026" sheet is not used by this module.
-- The sheets are a fresh data-entry template with NO historical rows, so this
-- migration creates structure and reference data (their LISTS tabs) only.
-- It inserts no attendance, session or people rows.
--
-- Layers kept separate on purpose:
--   1. reference / master data : ref_*, people, person_aliases
--   2. schedule                : training_sessions, training_session_facilitators
--   3. raw attendance          : facilitator_daily_attendance   (did this person work today?)
--   4. calculated reports      : v_* views only, never stored tables
-- Attendance (did they work?) and the schedule (what did they deliver?) are
-- separate tables that meet only through people.

-- ---------------------------------------------------------------- helpers
CREATE OR REPLACE FUNCTION svmi_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  NEW.row_version := OLD.row_version + 1;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------ reference data
-- Lookup tables rather than CHECK lists so a new status/brand is a data change,
-- not a schema change. `code` is the stable key; `label` is the exact text used
-- in the sheets' LISTS tabs and is what the pilot adapter reads/writes.
CREATE TABLE ref_brands (
  code        text PRIMARY KEY,
  label       text NOT NULL UNIQUE,
  sort_order  smallint NOT NULL,
  is_active   boolean NOT NULL DEFAULT true
);
INSERT INTO ref_brands (code, label, sort_order) VALUES
  ('ANGELS_PIZZA',         'Angel''s Pizza',         1),
  ('ANGELS_PIZZA_EXPRESS', 'Angel''s Pizza Express', 2),
  ('FIGARO',               'Figaro',                 3),
  ('TIEN_MAS',             'Tien Ma''s',             4),
  ('KOOBIDEH_KEBAB',       'Koobideh Kebab',         5),
  ('MULTI_BRAND',          'Multi-brand',            6);

CREATE TABLE ref_training_types (
  code        text PRIMARY KEY,
  label       text NOT NULL UNIQUE,
  sort_order  smallint NOT NULL,
  is_active   boolean NOT NULL DEFAULT true
);
INSERT INTO ref_training_types (code, label, sort_order) VALUES
  ('ORIENTATION',        'Orientation',                                 1),
  ('REFRESHER',          'Refresher',                                   2),
  ('TLTC',               'TLTC (Team Leader Training & Certification)', 3),
  ('SEMINAR_WORKSHOP',   'Seminar / Workshop',                          4),
  ('TECHNICAL_VALIDATION','Technical Validation',                       5),
  ('BARISTA_COFFEE_BAR', 'Barista / Coffee Bar',                        6),
  ('SERVICE_STEPS',      'Service Steps',                               7),
  ('RIDER_REFRESHER',    'Rider Refresher',                             8),
  ('COACHING_CORRECTIVE','Coaching / Corrective Action',                9),
  ('TRAIN_THE_TRAINER',  'Train-the-Trainer',                           10),
  ('OTHER',              'Other',                                       11);

-- Training session workflow. These four are the business states of SESSION_LOG's
-- Status list; no project-management states are added.
CREATE TABLE ref_session_statuses (
  code        text PRIMARY KEY,
  label       text NOT NULL UNIQUE,
  sort_order  smallint NOT NULL,
  counts_as_delivered boolean NOT NULL DEFAULT false
);
INSERT INTO ref_session_statuses (code, label, sort_order, counts_as_delivered) VALUES
  ('PLANNED',   'Planned',   1, false),
  ('CONDUCTED', 'Conducted', 2, true),
  ('POSTPONED', 'Postponed', 3, false),
  ('CANCELLED', 'Cancelled', 4, false);

-- Allowed status moves, as data. Planned -> Conducted is the main path;
-- Postponed sessions can be re-planned. Conducted and Cancelled are final.
CREATE TABLE ref_session_status_transitions (
  from_code text NOT NULL REFERENCES ref_session_statuses(code),
  to_code   text NOT NULL REFERENCES ref_session_statuses(code),
  PRIMARY KEY (from_code, to_code),
  CHECK (from_code <> to_code)
);
INSERT INTO ref_session_status_transitions (from_code, to_code) VALUES
  ('PLANNED','CONDUCTED'), ('PLANNED','POSTPONED'), ('PLANNED','CANCELLED'),
  ('POSTPONED','PLANNED'), ('POSTPONED','CANCELLED');

-- Facilitator daily statuses. The flags drive the Attendance KRA view so that
-- scoring rules are data, not code:
--   counts_as_working_day : row belongs in the KRA denominator
--   present_credit        : days credited as "present" (Half Day = 0.5)
--   is_late / is_absence  : deducted per the KRA formula
CREATE TABLE ref_facilitator_attendance_statuses (
  code                  text PRIMARY KEY,
  label                 text NOT NULL UNIQUE,
  sort_order            smallint NOT NULL,
  counts_as_working_day boolean NOT NULL,
  present_credit        numeric(3,2) NOT NULL CHECK (present_credit BETWEEN 0 AND 1),
  is_late               boolean NOT NULL DEFAULT false,
  is_absence            boolean NOT NULL DEFAULT false
);
COMMENT ON TABLE ref_facilitator_attendance_statuses IS
  'KRA flags are DEFAULTS pending HRAD confirmation: On Leave is excluded from working days (approved leave is not penalised), Half Day credits 0.5 day, Half Day is not counted as a late or absence. Change the rows, not the view, if HRAD rules differently.';
INSERT INTO ref_facilitator_attendance_statuses
  (code, label, sort_order, counts_as_working_day, present_credit, is_late, is_absence) VALUES
  ('PRESENT',       'Present',                   1, true,  1.00, false, false),
  ('LATE',          'Late',                      2, true,  1.00, true,  false),
  ('HALF_DAY',      'Half Day',                  3, true,  0.50, false, false),
  ('ABSENT',        'Absent',                    4, true,  0.00, false, true),
  ('ON_LEAVE',      'On Leave',                  5, false, 0.00, false, false),
  ('OFFICIAL_BUSINESS','Official Business / Field', 6, true, 1.00, false, false),
  ('WORK_FROM_HOME','Work From Home',            7, true,  1.00, false, false),
  ('REST_DAY',      'Rest Day / Day Off',        8, false, 0.00, false, false),
  ('HOLIDAY',       'Holiday',                   9, false, 0.00, false, false);

CREATE TABLE ref_work_locations (
  code text PRIMARY KEY, label text NOT NULL UNIQUE, sort_order smallint NOT NULL
);
INSERT INTO ref_work_locations (code, label, sort_order) VALUES
  ('HEAD_OFFICE','Head Office',1), ('TRAINING_ROOM','Training Room',2),
  ('STORE_VISIT_FIELD','Store Visit / Field',3), ('COMMISSARY','Commissary',4), ('OTHER','Other',5);

CREATE TABLE ref_leave_types (
  code text PRIMARY KEY, label text NOT NULL UNIQUE, sort_order smallint NOT NULL
);
INSERT INTO ref_leave_types (code, label, sort_order) VALUES
  ('VACATION','Vacation Leave',1), ('SICK','Sick Leave',2), ('EMERGENCY','Emergency Leave',3),
  ('BIRTHDAY','Birthday Leave',4), ('MATERNITY_PATERNITY','Maternity / Paternity Leave',5),
  ('LWOP','Leave Without Pay',6), ('OTHER','Other',7);

-- -------------------------------------------------------- master data
-- One row per Training & Development team member. A person is identified by
-- person_id, never by a name string, because names differ between the sheets
-- ("Ricelle Lim" vs "Ricelle (Rice) Lim", "Jeliver" vs "Ver" Guerrero).
CREATE TABLE people (
  person_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    text UNIQUE,                 -- HR id, when known
  full_name      text NOT NULL,
  display_name   text,
  position       text,
  is_facilitator boolean NOT NULL DEFAULT false, -- can be assigned to training sessions (SESSION_LOG roster)
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  row_version    integer NOT NULL DEFAULT 1
);
CREATE TRIGGER trg_people_touch BEFORE UPDATE ON people
  FOR EACH ROW EXECUTE FUNCTION svmi_touch_updated_at();
COMMENT ON TABLE people IS 'Master data. Empty on creation: populated from the sheets'' LISTS tabs / HR when real records are entered.';

-- Alternate spellings a sheet may use for the same person. Stored normalised
-- (lower-case, single-spaced) so adapters can resolve a typed name to person_id.
CREATE TABLE person_aliases (
  alias_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id  uuid NOT NULL REFERENCES people(person_id) ON DELETE CASCADE,
  alias      text NOT NULL,
  CONSTRAINT person_aliases_normalised CHECK (alias = lower(regexp_replace(btrim(alias), '\s+', ' ', 'g')))
);
-- One alias resolves to one person only; otherwise name matching is ambiguous.
CREATE UNIQUE INDEX uq_person_aliases_alias ON person_aliases (alias);
CREATE INDEX idx_person_aliases_person ON person_aliases (person_id);

-- ------------------------------------------------------------ schedule
-- SESSION_LOG. session_id is the sheet's pre-numbered 'TPD-0001' key and is the
-- natural key everywhere the sheets refer to a session.
CREATE TABLE training_sessions (
  session_id      text PRIMARY KEY CHECK (session_id ~ '^TPD-[0-9]{4,}$'),
  session_date    date,                        -- blank until scheduled
  program_module  text,
  training_type   text REFERENCES ref_training_types(code),
  brand           text REFERENCES ref_brands(code),
  venue           text,                        -- "Store / Venue", free text as in the sheet
  target_pax      integer CHECK (target_pax IS NULL OR target_pax >= 0),
  actual_pax      integer CHECK (actual_pax IS NULL OR actual_pax >= 0),
  duration_hrs    numeric(5,2) CHECK (duration_hrs IS NULL OR duration_hrs >= 0),
  status          text NOT NULL DEFAULT 'PLANNED' REFERENCES ref_session_statuses(code),
  post_test_avg   numeric(5,2) CHECK (post_test_avg IS NULL OR post_test_avg BETWEEN 0 AND 100),
  remarks         text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  row_version     integer NOT NULL DEFAULT 1,
  -- a scheduled session needs a date and a programme; empty pre-numbered
  -- rows are not sessions and are never stored
  CONSTRAINT sessions_have_program CHECK (program_module IS NOT NULL AND btrim(program_module) <> ''),
  CONSTRAINT conducted_has_date CHECK (status <> 'CONDUCTED' OR session_date IS NOT NULL)
);
CREATE TRIGGER trg_training_sessions_touch BEFORE UPDATE ON training_sessions
  FOR EACH ROW EXECUTE FUNCTION svmi_touch_updated_at();
CREATE INDEX idx_training_sessions_date   ON training_sessions (session_date);
CREATE INDEX idx_training_sessions_status ON training_sessions (status);
CREATE INDEX idx_training_sessions_brand  ON training_sessions (brand);
COMMENT ON TABLE training_sessions IS 'The schedule. Backs the Kanban: one card per row, column = status. The sheet''s ~150 blank pre-numbered rows are template slots, not sessions, and are not stored here.';

-- "Facilitator(s)" is a comma-separated text cell in the sheet; here it is a
-- proper many-to-many so "sessions per facilitator" is a join, not string parsing.
CREATE TABLE training_session_facilitators (
  session_id text NOT NULL REFERENCES training_sessions(session_id) ON DELETE CASCADE,
  person_id  uuid NOT NULL REFERENCES people(person_id) ON DELETE RESTRICT,
  PRIMARY KEY (session_id, person_id)
);
CREATE INDEX idx_tsf_person ON training_session_facilitators (person_id);

-- ------------------------------------------------------ raw attendance
-- Facilitator daily attendance: did this team member work this day?
CREATE TABLE facilitator_daily_attendance (
  attendance_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id       uuid NOT NULL REFERENCES people(person_id) ON DELETE RESTRICT,
  attendance_date date NOT NULL,
  status          text NOT NULL REFERENCES ref_facilitator_attendance_statuses(code),
  time_in         time,
  time_out        time,
  work_location   text REFERENCES ref_work_locations(code),
  leave_type      text REFERENCES ref_leave_types(code),
  remarks         text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  row_version     integer NOT NULL DEFAULT 1,
  UNIQUE (person_id, attendance_date),  -- "one row per team member per working day"
  CONSTRAINT fda_leave_only_on_leave CHECK (leave_type IS NULL OR status = 'ON_LEAVE'),
  CONSTRAINT fda_time_order CHECK (time_in IS NULL OR time_out IS NULL OR time_out >= time_in)
);
CREATE TRIGGER trg_fda_touch BEFORE UPDATE ON facilitator_daily_attendance
  FOR EACH ROW EXECUTE FUNCTION svmi_touch_updated_at();
CREATE INDEX idx_fda_date ON facilitator_daily_attendance (attendance_date);
COMMENT ON TABLE facilitator_daily_attendance IS 'Raw daily work attendance for the Attendance / Punctuality / Behavior KRA. Not linked to training sessions.';

-- ------------------------------------------------------------ audit
-- Append-only change log for the tables above. Separate from audit_logs (009),
-- whose action list is limited to configuration-versioning verbs.
CREATE TABLE attendance_audit_log (
  audit_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  actor        text,                                   -- adapter-supplied; pilot has no user table linkage
  entity_type  text NOT NULL CHECK (entity_type IN
                 ('TRAINING_SESSION','FACILITATOR_ATTENDANCE','PERSON')),
  entity_id    text NOT NULL,
  action       text NOT NULL CHECK (action IN ('CREATE','UPDATE','STATUS_CHANGE','DELETE')),
  before_value jsonb,
  after_value  jsonb,
  source       text NOT NULL DEFAULT 'api'
);
CREATE INDEX idx_attendance_audit_entity ON attendance_audit_log (entity_type, entity_id);
CREATE INDEX idx_attendance_audit_time   ON attendance_audit_log (occurred_at);

-- ---------------------------------------------------- calculated reports
-- Views only: they cannot drift from the raw rows.

-- Attendance KRA per facilitator per month:
--   (days present - lates - absences) / total working days, floored at 0.
-- Rating is NULL, not 0, when there are no working days logged (matches the
-- hub's "no data is never zero" rule).
CREATE VIEW v_facilitator_attendance_monthly AS
SELECT
  a.person_id,
  p.full_name,
  date_trunc('month', a.attendance_date)::date AS month,
  count(*) FILTER (WHERE s.counts_as_working_day)                       AS working_days,
  sum(s.present_credit) FILTER (WHERE s.counts_as_working_day)          AS days_present,
  count(*) FILTER (WHERE s.is_late)                                     AS lates,
  count(*) FILTER (WHERE s.is_absence)                                  AS absences,
  count(*) FILTER (WHERE a.status = 'ON_LEAVE')                         AS leave_days,
  CASE WHEN count(*) FILTER (WHERE s.counts_as_working_day) = 0 THEN NULL
       ELSE round(greatest(0,
              (coalesce(sum(s.present_credit) FILTER (WHERE s.counts_as_working_day), 0)
                 - count(*) FILTER (WHERE s.is_late)
                 - count(*) FILTER (WHERE s.is_absence))
              / (count(*) FILTER (WHERE s.counts_as_working_day))::numeric) * 100, 2)
  END AS kra_rating_pct
FROM facilitator_daily_attendance a
JOIN people p ON p.person_id = a.person_id
JOIN ref_facilitator_attendance_statuses s ON s.code = a.status
GROUP BY a.person_id, p.full_name, date_trunc('month', a.attendance_date);

-- Training Program Delivery inputs: sessions delivered per facilitator per month.
CREATE VIEW v_facilitator_sessions_monthly AS
SELECT
  f.person_id,
  date_trunc('month', t.session_date)::date AS month,
  count(*)                                                                AS sessions_total,
  count(*) FILTER (WHERE st.counts_as_delivered)                          AS sessions_conducted
FROM training_session_facilitators f
JOIN training_sessions t ON t.session_id = f.session_id
JOIN ref_session_statuses st ON st.code = t.status
WHERE t.session_date IS NOT NULL
GROUP BY f.person_id, date_trunc('month', t.session_date);
