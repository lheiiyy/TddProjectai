# Attendance & Training Scheduling (migration 014)

Status: **schema proven on a scratch PostgreSQL 16; not deployed anywhere.** Backs the KPI Monitoring Hub
([`lheiiyy/KPI-MONITORING-HUB`](https://github.com/lheiiyy/KPI-MONITORING-HUB)). The hub currently runs on Google Sheets
through an Apps Script adapter; this schema is the target it can move to without changing the UI.

## Scope

- **In:** the training schedule (`SESSION_LOG`) and the daily attendance of facilitators / trainers / Training & Development team members.
- **Out:** trainee (participant) attendance. The "Training Attendance Monitoring 2026" sheet is not modelled.
- **No data is migrated.** The pilot sheets are an empty data-entry template; the migration creates structure and reference data only.
  `validation/attendance_schema_test.sql` asserts that no people, sessions or attendance rows are inserted.

## Layers

```
reference / master   ref_brands, ref_training_types, ref_session_statuses (+ _transitions),
                     ref_facilitator_attendance_statuses, ref_work_locations, ref_leave_types,
                     people, person_aliases
schedule             training_sessions  ──<  training_session_facilitators  >──  people
raw attendance       facilitator_daily_attendance  >──  people      (one row per person per day)
calculated           v_facilitator_attendance_monthly, v_facilitator_sessions_monthly   (views only)
audit                attendance_audit_log (append-only)
```

Attendance and the schedule are separate tables that meet only through `people`.

## Sheet → table mapping

| Sheet column | Column |
|---|---|
| SESSION_LOG: Session ID, Date, Program / Module | `training_sessions.session_id` (`TPD-0001`, natural key), `session_date`, `program_module` |
| Training Type, Brand, Store / Venue | `training_type`, `brand` (FK to ref tables), `venue` (free text) |
| Facilitator(s) (comma-separated text) | `training_session_facilitators` rows |
| Target / Actual Pax, Duration, Status, Post-Test Avg, Remarks | `target_pax`, `actual_pax`, `duration_hrs`, `status`, `post_test_avg`, `remarks` |
| ATTENDANCE_LOG: Date, Team Member, Position | `attendance_date`, `person_id` → `people` |
| Status, Time In / Out, Work Location, Leave Type, Remarks | `status`, `time_in`, `time_out`, `work_location`, `leave_type`, `remarks` |

The sheet's ~150 blank pre-numbered `SESSION_LOG` rows are template slots, not sessions, and are not stored.

## Rules enforced in the database

- Session status workflow is data (`ref_session_status_transitions`): Planned → Conducted / Postponed / Cancelled; Postponed → Planned / Cancelled; Conducted and Cancelled are final. The table records the rules; **the trigger that enforces a transition on UPDATE is not part of this migration**, so today the service/API layer enforces it (the hub's `service.js` and `Code.gs` both do).
- A Conducted session must have a date. A session must have a programme.
- One attendance row per person per day. Leave Type only when Status is On Leave. Time Out not before Time In.
- Optimistic concurrency: every mutable table has `row_version`, bumped by trigger. (The Sheets adapter uses a content hash instead.)
- Identity is `person_id`, never a name string; `person_aliases` (normalised, globally unique) resolves spellings such as "Ricelle Lim" vs "Ricelle (Rice) Lim" and "Jeliver" vs "Ver" Guerrero.

## Attendance KRA view

`v_facilitator_attendance_monthly`: `(days present − lates − absences) / working days`, floored at 0, **NULL (not 0) when a month has no working days.**

The treatment of each status lives in `ref_facilitator_attendance_statuses`, not in the view. **These flags are defaults pending HRAD confirmation:**

| Status | Working day | Present credit | Late | Absence |
|---|---|---|---|---|
| Present, Official Business, Work From Home | yes | 1 | | |
| Late | yes | 1 | yes | |
| Half Day | yes | 0.5 | | |
| Absent | yes | 0 | | yes |
| On Leave, Rest Day, Holiday | **no** | 0 | | |

The questions HRAD should settle: is approved leave excluded from working days (assumed yes), does a Half Day also count as a late or absence (assumed no), and is Leave Without Pay treated differently from other leave (currently the same). Change the rows, not the view.

## Not done here

- No API/service in front of the schema yet (the hub's `js/att/adapters/` contract is what it would implement).
- No role grants for the new tables in `scripts/harden_grants.sql`; `attendance_audit_log` needs the same no-UPDATE/DELETE grant as `audit_logs`.
- `training_sessions.venue` is text; linking to `stores` is deferred until store names in the sheet are cleaned up.

## Verify

```
psql -v ON_ERROR_STOP=1 -d <scratch db> -f database/validation/attendance_schema_test.sql   # rolls back; prints ALL PASSED
```
