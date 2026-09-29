-- database/validation/attendance_schema_test.sql
-- Behaviour test for migration 014. Runs in one transaction and ROLLS BACK,
-- so the throwaway rows below never persist. Fails loudly (RAISE EXCEPTION)
-- on the first broken expectation.
--   psql -v ON_ERROR_STOP=1 -d <db> -f database/validation/attendance_schema_test.sql
BEGIN;

CREATE FUNCTION pg_temp.expect_fail(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; EXCEPTION WHEN others THEN RETURN; END;
  RAISE EXCEPTION 'expected failure did not happen: %', label;
END $$;

-- reference data present, structure otherwise empty
DO $$ BEGIN
  IF (SELECT count(*) FROM ref_facilitator_attendance_statuses) <> 9 THEN RAISE EXCEPTION 'expected 9 facilitator statuses'; END IF;
  IF (SELECT count(*) FROM ref_session_statuses) <> 4 THEN RAISE EXCEPTION 'expected 4 session statuses'; END IF;
  IF (SELECT count(*) FROM people) + (SELECT count(*) FROM training_sessions)
   + (SELECT count(*) FROM facilitator_daily_attendance) <> 0
  THEN RAISE EXCEPTION 'migration must not insert people/sessions/attendance'; END IF;
END $$;

INSERT INTO people (person_id, full_name, is_facilitator) VALUES
  ('00000000-0000-0000-0000-000000000001','T Facilitator',true),
  ('00000000-0000-0000-0000-000000000002','T Other Member',false);

-- facilitator daily attendance rules
SELECT pg_temp.expect_fail('duplicate person/day', $q$
  INSERT INTO facilitator_daily_attendance (person_id, attendance_date, status) VALUES
   ('00000000-0000-0000-0000-000000000001','2026-09-01','PRESENT'),
   ('00000000-0000-0000-0000-000000000001','2026-09-01','LATE')$q$);
SELECT pg_temp.expect_fail('leave type on non-leave day', $q$
  INSERT INTO facilitator_daily_attendance (person_id, attendance_date, status, leave_type)
  VALUES ('00000000-0000-0000-0000-000000000001','2026-09-02','PRESENT','SICK')$q$);
SELECT pg_temp.expect_fail('time out before time in', $q$
  INSERT INTO facilitator_daily_attendance (person_id, attendance_date, status, time_in, time_out)
  VALUES ('00000000-0000-0000-0000-000000000001','2026-09-02','PRESENT','17:00','08:00')$q$);
SELECT pg_temp.expect_fail('unknown status', $q$
  INSERT INTO facilitator_daily_attendance (person_id, attendance_date, status)
  VALUES ('00000000-0000-0000-0000-000000000001','2026-09-02','SKIVING')$q$);

-- KRA view: 10 working days = 6 present, 1 late, 1 half day, 1 absent, 1 wfh; + rest day + holiday + leave (excluded)
INSERT INTO facilitator_daily_attendance (person_id, attendance_date, status)
SELECT '00000000-0000-0000-0000-000000000001', d, s FROM (VALUES
 ('2026-08-03'::date,'PRESENT'),('2026-08-04','PRESENT'),('2026-08-05','PRESENT'),('2026-08-06','PRESENT'),
 ('2026-08-07','PRESENT'),('2026-08-10','PRESENT'),('2026-08-11','LATE'),('2026-08-12','HALF_DAY'),
 ('2026-08-13','ABSENT'),('2026-08-14','WORK_FROM_HOME'),('2026-08-15','REST_DAY'),('2026-08-21','HOLIDAY'),
 ('2026-08-24','ON_LEAVE')) v(d,s);
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM v_facilitator_attendance_monthly WHERE month = '2026-08-01';
  -- present credit: 6 + late 1 + half 0.5 + wfh 1 = 8.5 ; lates 1 ; absences 1 ; working days 10
  IF r.working_days <> 10 OR r.days_present <> 8.5 OR r.lates <> 1 OR r.absences <> 1 OR r.leave_days <> 1
  THEN RAISE EXCEPTION 'KRA counts wrong: %', r; END IF;
  IF r.kra_rating_pct <> 65.00 THEN RAISE EXCEPTION 'KRA rating expected 65.00 got %', r.kra_rating_pct; END IF;
END $$;
-- a month with only rest days/leave has no working days -> NULL rating, never 0
INSERT INTO facilitator_daily_attendance (person_id, attendance_date, status) VALUES
 ('00000000-0000-0000-0000-000000000001','2026-07-04','REST_DAY');
DO $$ BEGIN
  IF (SELECT kra_rating_pct FROM v_facilitator_attendance_monthly WHERE month='2026-07-01') IS NOT NULL
  THEN RAISE EXCEPTION 'no working days must give NULL rating'; END IF;
END $$;

-- sessions
SELECT pg_temp.expect_fail('bad session id', $q$
  INSERT INTO training_sessions (session_id, program_module) VALUES ('X-1','p')$q$);
SELECT pg_temp.expect_fail('blank programme', $q$
  INSERT INTO training_sessions (session_id, program_module) VALUES ('TPD-0001','  ')$q$);
SELECT pg_temp.expect_fail('conducted without date', $q$
  INSERT INTO training_sessions (session_id, program_module, status) VALUES ('TPD-0001','p','CONDUCTED')$q$);
SELECT pg_temp.expect_fail('post-test over 100', $q$
  INSERT INTO training_sessions (session_id, program_module, post_test_avg) VALUES ('TPD-0001','p',101)$q$);
INSERT INTO training_sessions (session_id, session_date, program_module, training_type, brand, status)
VALUES ('TPD-0001','2026-09-10','Service Steps','SERVICE_STEPS','FIGARO','PLANNED');
INSERT INTO training_session_facilitators VALUES ('TPD-0001','00000000-0000-0000-0000-000000000001');

-- a session cannot list the same facilitator twice, nor an unknown person/session
SELECT pg_temp.expect_fail('duplicate session facilitator', $q$
  INSERT INTO training_session_facilitators VALUES ('TPD-0001','00000000-0000-0000-0000-000000000001')$q$);
SELECT pg_temp.expect_fail('facilitator on unknown session', $q$
  INSERT INTO training_session_facilitators VALUES ('TPD-0999','00000000-0000-0000-0000-000000000001')$q$);

-- optimistic-concurrency counter and updated_at trigger
UPDATE training_sessions SET status='CONDUCTED' WHERE session_id='TPD-0001';
DO $$ BEGIN
  IF (SELECT row_version FROM training_sessions WHERE session_id='TPD-0001') <> 2 THEN RAISE EXCEPTION 'row_version not bumped'; END IF;
  IF (SELECT sessions_conducted FROM v_facilitator_sessions_monthly) <> 1 THEN RAISE EXCEPTION 'delivered count wrong'; END IF;
END $$;

-- transition table: Planned->Conducted allowed; Conducted->Planned not
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM ref_session_status_transitions WHERE from_code='PLANNED' AND to_code='CONDUCTED') THEN RAISE EXCEPTION 'missing PLANNED->CONDUCTED'; END IF;
  IF EXISTS (SELECT 1 FROM ref_session_status_transitions WHERE from_code IN ('CONDUCTED','CANCELLED')) THEN RAISE EXCEPTION 'final states must have no exits'; END IF;
END $$;

-- alias uniqueness / normalisation
INSERT INTO person_aliases (person_id, alias) VALUES ('00000000-0000-0000-0000-000000000001','ricelle lim');
SELECT pg_temp.expect_fail('alias reused by another person', $q$
  INSERT INTO person_aliases (person_id, alias) VALUES ('00000000-0000-0000-0000-000000000002','ricelle lim')$q$);
SELECT pg_temp.expect_fail('un-normalised alias', $q$
  INSERT INTO person_aliases (person_id, alias) VALUES ('00000000-0000-0000-0000-000000000002','Ricelle  Lim')$q$);

ROLLBACK;
\echo 'attendance_schema_test: ALL PASSED (rolled back)'
