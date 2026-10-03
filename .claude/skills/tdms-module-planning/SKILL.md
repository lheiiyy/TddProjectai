---
name: tdms-module-planning
description: Plan a TDMS (Training and Development Management System) module or feature: scope, workflow, tables, screens, migration notes and build prompt.
---

# TDMS Module Planning

Use this when Leo asks to plan, spec, redesign or scope any part of TDMS for the Training Department of Figaro Culinary Group: M0 core master data, M1 orientation, M2 training sessions, M3 Team Leader program, M4 proficiency/cross-training, M5 store visits, M6 CAPAR, M7 dashboards, M8 resource library (SOPs, manuals, memorandums, FAQs, forms, exams), M9 KPI monitoring, the restricted Supervisor/Admin area, or a new module. For a brand-new app that is not part of TDMS, use `web-app-project-planning` instead.

Master plan (source of truth for architecture and table names): https://claude.ai/code/artifact/f89076cb-9986-4a8a-abe2-f0eb70d83dab
Code and specs: GitHub `lheiiyy/TddProjectai`, folder `TDMS_Project/` (specs go in `TDMS_Project/specs/`).

Reply to Leo in Taglish. Write the spec itself in plain, formal English with no AI-sounding phrasing (it may go to management).

## Step 1 - Gather context (silently, before asking anything)

1. Read the master plan above: Sections 3 (roles and restricted area), 5 (design rules) and 6 (data model).
2. Read `TDMS_Project/CLAUDE.md` in the repo, and check `database/migrations/` for tables that already exist in the SVMI PostgreSQL schema; reuse their names where they overlap.
3. Find the legacy source this module replaces. Google Drive (TDD Core Room folder, or search by title): TOIS PMS DATABASE, [sys] Team leader Monitoring, [sys] STORE VISIT 2026, CAPAR RECTIFICATION MONITORING, Training Program & Delivery Monitoring 2026, CROSS TRAINED STAFFS MONITORING. GitHub: `SVMI_Project/` for store visits, `TLM_Project/` for Team Leader monitoring, `lheiiyy/KPI-MONITORING-HUB` for KPI/KRA rules and the session/attendance pages. Read the real columns and sample rows.
4. List what the legacy data gets wrong: names used as keys, several values in one cell, mixed date formats, monthly or status tabs, free-typed enums.

## Step 2 - Ask only what changes the design (max 4 questions, use AskUserQuestion)

Typical: who enters the data (officer / supervisor / store), who approves, which statuses exist, what is restricted, what report management actually asks for. Skip anything already answered in the master plan or memory.

## Step 3 - Write the module spec (one Docs artifact per module)

Sections, in this order:

1. Purpose - one paragraph: what problem it solves, which legacy sheet or app it replaces.
2. Users and permissions - table: role x (create, edit, approve, view scope). Roles: Training Officer, Training Supervisor, Training Manager, Senior Training Manager, System Admin. Say plainly if any part sits in the restricted area (Supervisors, Managers and Admin only) and confirm the server checks the role on every call.
3. Workflow - numbered status flow (e.g. Open -> Scheduled -> Verified -> Endorsed -> Closed), who moves each step, what is required at each step. Draw a diagram if it branches.
4. Tables - for each table: name (snake_case), ID prefix, every column with type (text, number, date yyyy-mm-dd, timestamp, boolean, FK -> table), required yes/no, allowed values. Always include audit columns: created_at, created_by, updated_at, updated_by, is_active, row_version.
5. Validation rules - per field and cross-field (e.g. verified_on >= audit_failed_on).
6. Screens - list each screen: purpose, fields, filters, actions. Mobile-first for field officers.
7. Reports and dashboard cards - each metric with its exact formula and source tables. For M9, start from the five KPI Hub KRAs (store visit compliance 25%, staff proficiency 25%, training delivery 20%, coaching and feedback 20%, attendance 10%) and mark which are auto-computed from TDMS.
8. API functions - name, input JSON, output JSON (e.g. capar.list({status, brand_id, page}) -> {rows, total}). These names must not change at migration.
9. Files (if any) - for M8 or any module with attachments: Drive folder, allowed types, versioning, restricted flag, which roles can view, download, upload.
10. Legacy import - column mapping from old sheet to new tables, cleanup rules, how unmatched stores/employees are handled.
11. Migration notes - anything that maps differently to SQL (child tables, indexes needed), and overlap with `database/migrations/`.
12. Acceptance checklist - testable items; module is done when the old sheet is set read-only.
13. Open questions.

## Step 4 - Self-check before handing over

- [ ] No table links by name; every link is an *_id.
- [ ] One value per cell; lists moved to child tables.
- [ ] No monthly tabs, no status tabs, no formulas in data tabs.
- [ ] All dates yyyy-mm-dd; percentages stored as numbers.
- [ ] Enums come from the lookups table.
- [ ] Only the repository layer touches SpreadsheetApp; screens call api.js only.
- [ ] Restricted data is checked on the server, not only hidden in the menu.
- [ ] Screens page results (about 50 rows); dashboards read summary tables.
- [ ] Table and column names match Section 6 of the master plan and `database/migrations/`, or the plan is updated too.
- [ ] Scoring or structural changes are flagged for Leo's approval before build.

## Step 5 - Approval gate and build handoff

Stop after the spec and ask Leo to approve. After approval:
1. Save the spec summary as `TDMS_Project/specs/<module-id>-<name>.md` on a feature branch and open a pull request (Leo is still learning Git, so handle branch, commit and PR for him).
2. Produce a build prompt for Claude Code that lists: files to create (repository, service, api, screen per module), the exact tables and columns, the acceptance checklist, and the instruction to deploy only after Leo reviews.
3. Keep live backups; never write into the legacy sheet.

## Conventions

- Brands: AP (Angel's Pizza), APX (Angel's Pizza Express), FG (Figaro Coffee), TM (Tien Ma's), KK (Koobideh Kebab).
- ID format: PREFIX-000000 (e.g. EMP-000123, STR-0042, CAP-2026-0015), generated by code.
- Prefer simple, supportable designs over enterprise patterns. Build working screens first; keep docs short.
