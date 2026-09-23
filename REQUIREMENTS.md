# SVMI — Requirements

**No original requirements document exists in this repository.** The
requirements below are reconstructed from the live implementation
(`SVMI_Project/Apps Script/*`), `SVMI_Project/DEPLOY.md`, and
`SVMI_Project/README.txt` — they describe what the system demonstrably
does today, not a separately-authored specification. Treat this file as
a description of established behavior, not as license to add anything
not already implemented.

## 1. Core functional requirements (implemented)

- **Log a store visit** — Store, Date Visited, one or more Visitors,
  Purpose, optional Remarks, submitted through Input Portal.
- **Prevent duplicate visits** — an exact-duplicate submission (same
  store, date, and any overlapping visitor) is rejected server-side.
- **Track visit compliance** — per-store, per-category expected visit
  cadence, with a gaps view ("Unvisited This Month").
- **Score store risk** — "Store Health": a per-store risk score derived
  from visit frequency and QA/MS outcome history, with a decaying penalty
  for failures.
- **Track a weekly KPI tracker** — visit counts by visitor, by
  week/period, for a given reporting year.
- **Executive reporting** — a summary view (brand × month visit counts,
  purpose breakdown) read-only from the Web App.
- **Freeze historical reports** — finalize a year's reports into an
  immutable snapshot; correct via supersede, never edit (D-009).
- **Administer Stores/Visitors/Purposes** — create, rename (Store only),
  activate/deactivate, with an effective date and a recorded reason, and
  full version history (D-005).
- **Administer Risk/Compliance/KPI rules** — versioned thresholds/weights
  and per-category cadence rules.
- **Audit every configuration change** — actor, action, before/after
  values, effective date, reason.
- **Roll back a configuration entity** to a prior version (as a new
  version, never an edit).
- **Gate access** — Google sign-in, a shared guest password, and a
  separate admin email list controlling who sees the Admin tab.
- **Run on mobile** — the Web App URL, since Apps Script menus don't run
  in the Sheets mobile apps.

## 2. Non-functional requirements (implemented, and load-bearing — see `DECISIONS.md`)

- **Historical immutability** — `MASTER_LOG` is append-only; a
  configuration change is always a new version, never an edit to an
  existing row; a report snapshot, once finalized, is never edited.
- **Effective-dating** — every configuration change has an Effective From
  (and optional Effective To); "what applied on date D" is always
  resolvable from history, not just "what applies now."
- **No cross-entity inheritance** — a purpose with no configuration has
  none; it is never defaulted from another purpose (D-010).
- **Year isolation** — a reporting year's calculations never leak into or
  out of another year; the "current" year is derived from data, not a
  manual constant (D-008).
- **Defense-in-depth authorization** — every server-side mutation
  re-checks admin status itself; client-side hiding is convenience only.
- **Single authoritative write path** per entity type — no two ways to
  create/edit the same Store/Visitor/Purpose (D-005).
- **No production-data risk during migration work** — the PostgreSQL
  track never touches real data without an explicit, deliberate export
  (D-011).

## 3. Explicitly out of scope / deferred (see `PROJECT_STATUS.md` for the full current list)

- Admin Configuration screen for admin access (guest password / admin
  email list) — not yet built (D-007).
- Admin Configuration for Approved Brands/Regions/Categories — still
  hardcoded (D-013).
- Any KPI calculation that actually consumes `CONFIG_KPI`'s target/weight
  fields — infrastructure exists, nothing reads it yet.
- A real PostgreSQL production deployment, or any migration of real SVMI
  data into it — DEV-schema-only today.
- A separate `location_id` concept independent of (Location, Brand)
  identity (D-002).
