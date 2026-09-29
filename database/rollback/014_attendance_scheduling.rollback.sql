-- Reverses 014_attendance_scheduling.sql. Destroys any attendance, schedule and people rows
-- entered since; take a backup first (scripts/backup.sh). svmi_touch_updated_at() is left in
-- place because other migrations may come to depend on it.
DROP VIEW IF EXISTS v_facilitator_sessions_monthly;
DROP VIEW IF EXISTS v_facilitator_attendance_monthly;
DROP TABLE IF EXISTS attendance_audit_log;
DROP TABLE IF EXISTS facilitator_daily_attendance;
DROP TABLE IF EXISTS training_session_facilitators;
DROP TABLE IF EXISTS training_sessions;
DROP TABLE IF EXISTS person_aliases;
DROP TABLE IF EXISTS people;
DROP TABLE IF EXISTS ref_session_status_transitions;
DROP TABLE IF EXISTS ref_session_statuses;
DROP TABLE IF EXISTS ref_facilitator_attendance_statuses;
DROP TABLE IF EXISTS ref_leave_types;
DROP TABLE IF EXISTS ref_work_locations;
DROP TABLE IF EXISTS ref_training_types;
DROP TABLE IF EXISTS ref_brands;
