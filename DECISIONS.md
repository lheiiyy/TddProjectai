# SVMI — Decisions

Durable architectural/business decisions. A future AI session must not
reverse a `Status: Settled` decision without an explicit new instruction
from the project owner acknowledging the reversal. This is a record of
*what was decided*, not a transcript of how — see `IMPLEMENTATION_LOG.md`
and `SVMI_Project/DEPLOY.md` for the reasoning in full.

---

### D-001 — Store identity = Location + Brand
**Status:** Settled
**Decision:** A store's canonical identity is the pair (physical Location,
Brand), not Location alone and not Brand alone. `canonical key =
NORMALIZED_LOCATION|NORMALIZED_BRAND`.
**Rationale:** Confirmed against real production data during the Phase 2A
migration dry run — the same physical location legitimately hosts more
than one brand (e.g. one town with both a FIGARO and an ANGEL'S PIZZA
location).
**Impact:** Two brands at one location are always two separate Stores,
each with its own Store ID. Never merge them on physical co-location
alone, and never fuzzy/similarity-match location names to decide identity.

### D-002 — No separate `location_id` (for now)
**Status:** Settled (scope boundary, not a rejection)
**Decision:** Store ID stays attached directly to the (Location, Brand)
operational identity. A future schema MAY introduce a separate
`location_id` to represent "this physical site" independent of which
brand operates there, but that is explicitly out of scope for the current
phase.
**Rationale:** Avoids inventing a second identity table before there's a
concrete need for it.
**Impact:** Do not add a `location_id`-style concept without a new,
explicit decision to do so.

### D-003 — Visitor and Purpose identity = normalized name (interim)
**Status:** Settled, interim
**Decision:** Unlike Store (which has an immutable `STR-<uuid>` Store ID),
Visitor and Purpose entities are keyed by their own normalized (trimmed,
uppercased) name. There is no immutable ID scheme for either yet.
**Rationale:** Matches the pre-existing SETTINGS-era identity model for
these two; inventing a new ID scheme was explicitly deferred rather than
done speculatively.
**Impact:** A Visitor or Purpose cannot be "renamed" — a different name is
a different entity. A future immutable-ID migration for these two is a
distinct, not-yet-scheduled decision.

### D-004 — CAPAR (and any purpose like it): historically preserved, operationally inactive
**Status:** Settled
**Decision:** A purpose with real historical `MASTER_LOG` usage but no
deliberate KPI/Risk configuration record is `INACTIVE_NOT_SELECTABLE` —
its historical rows and workbook presence are never invalidated by that
status, and its absence from the legacy `APPROVED_PURPOSES` list is never
treated as evidence the historical records themselves are wrong.
**Rationale:** Keeps "did this happen" (historical fact) and "is this
ready for the reporting pipeline" (operational readiness) as two separate
questions, never collapsed into one.
**Impact:** Never auto-activate a purpose from historical usage alone;
never treat a purpose's historical rows as invalid because it isn't
currently configured.

### D-005 — Admin → Configuration is the sole authoritative path for Stores/Visitors/Purposes
**Status:** Settled (Phase 1G)
**Decision:** The "Store & Roster Manager" System Tools card — the
previous direct-to-`SETTINGS` editor for Stores/Visitors/Purposes — has
been removed entirely. Admin → Configuration (backed by
`CONFIG_STORES`/`CONFIG_VISITORS`/`CONFIG_PURPOSES`) is the only place any
of the three is created, renamed, activated, or deactivated.
**Rationale:** Two competing editors for the same data invite drift and
undermine the versioning/audit guarantees Configuration provides.
**Impact:** Do not add a second editing surface for Stores/Visitors/Purposes.
The four legacy write functions in `INPUT_PORTAL.gs` still exist, but only
as internal plumbing called by the Configuration sync hooks — never
reachable from any client-side path.

### D-006 — SETTINGS is a generated compatibility mirror, never authoritative again (for Stores/Visitors/Purposes)
**Status:** Settled (Phase 1G)
**Decision:** `SETTINGS` columns A–E/F/H are regenerated automatically from
`CONFIG_STORES`/`CONFIG_VISITORS`/`CONFIG_PURPOSES` on every mutation; no
new feature may write to them as an independent source of truth.
**Rationale:** Several existing report builders (Store Health, Executive
Summary, KPI 2026) read `SETTINGS` directly, including via live cell-
reference formulas — rewriting all of them to read `CONFIG_*` directly was
judged higher-risk than keeping a correctly-synced mirror.
**Impact:** `SETTINGS` columns G (admin emails) and I (guest password) are
**not** covered by this decision — they remain independently authoritative
(see D-007). Do not assume "the whole SETTINGS sheet is now a disposable
mirror."

### D-007 — Guest password and admin email list stay in SETTINGS, out of CONFIG_SYSTEM
**Status:** Settled for now — flagged as a gap, not closed
**Decision:** `SETTINGS!I2` (guest password) and `SETTINGS!G2:G` (admin
emails) were deliberately NOT moved into `CONFIG_SYSTEM` during Phase 1G.
**Rationale:** Out of scope for the Stores/Visitors/Purposes migration;
moving authentication-adjacent values needed its own deliberate review,
not a side effect of an unrelated migration.
**Impact:** No Admin Configuration screen exists for admin access today —
identified as the highest-priority System Peripherals gap (see
`PROJECT_STATUS.md`). `CONFIG_SYSTEM`'s schema exists and is ready to hold
this once a decision is made to move it.

### D-008 — Reporting year is data-derived, no manual annual rollover
**Status:** Settled (Phase 1C)
**Decision:** The "current" reporting year for any calculation is the
latest calendar year actually present in `MASTER_LOG`'s Date Visited
column (`getDefaultReportingYear()`), re-derived on every call — never a
static constant someone has to remember to bump each January.
**Rationale:** The old `DATA_YEAR` literal required a manual code change
every year and was a recurring source of stale-year bugs.
**Impact:** `DATA_YEAR` is a legacy compatibility constant only — do not
wire new code to it. Cosmetic labels ("KPI 2026") are fine to leave as
display text; the functions behind them are year-neutral regardless.

### D-009 — Report snapshots are immutable once finalized; correction = supersede
**Status:** Settled (Phase 1E)
**Decision:** Finalizing a report for a year freezes it permanently.
Correcting it never edits the frozen row — it creates a new snapshot
explicitly linked as superseding the old one.
**Rationale:** Same append-only-correction discipline used everywhere else
in the configuration model, applied to reporting.
**Impact:** Never add an "edit snapshot" path. A duplicate finalize for an
already-finalized year must be rejected, not silently overwritten.

### D-010 — No cross-purpose or cross-entity inheritance of configuration, ever
**Status:** Settled
**Decision:** A purpose's KPI/Risk configuration is looked up by its own
exact key only. A purpose with no configuration has none — it is never
defaulted from another purpose's values, from legacy behavior, or from
its own historical usage.
**Rationale:** Explicit business rule, restated and re-verified across
every phase (Risk, KPI, and the Phase 2 dry-run reconciliation tooling all
independently enforce and test it).
**Impact:** Any future "smart default" or "inherit from similar purpose"
feature would reverse this decision — do not add one without an explicit
new decision overriding D-010.

### D-011 — PostgreSQL migration: DEV/PROD strictly isolated; no production data touched without an explicit real export
**Status:** Settled
**Decision:** DEV and PROD Postgres environments use entirely separate
credentials and roles, never shared. Real SVMI data is only ever obtained
via a direct export/CSV from the project owner — never by pushing a
temporary export function to the live production Apps Script project.
**Rationale:** The latter would be a real (even if reverted) change to a
production system; the former has zero production risk.
**Impact:** No AI session should attempt to extract real data from the
live script to unblock Phase 2 — wait for the owner to provide it.

### D-012 — Administrative confirmation is always kept separate from automatic evidence
**Status:** Settled
**Decision:** Across Store, Visitor, and Purpose identity reconciliation,
an automatically-detected match (e.g. `EXACT_MATCH`) is never conflated
with an explicitly-declared administrative decision (e.g. "treat this as
the same Store"). Both are recorded, but under different, non-overlapping
fields/labels.
**Rationale:** So the evidence trail never claims a match was "discovered"
when it was actually declared by a human, and vice versa.
**Impact:** Any reconciliation logic must accept administrative
confirmation only as an explicit, separate input — never infer it from
data alone.

### D-013 — Approved Brands/Regions/Categories remain hardcoded (current state, not a final answer)
**Status:** Open / acknowledged gap
**Decision:** `APPROVED_BRANDS`/`APPROVED_REGIONS`/`APPROVED_CATEGORIES`
(`SVMKPI_CORE.gs`) remain JavaScript constants, not Admin Configuration
data, as of Phase 1G.
**Rationale:** Brand in particular is structurally embedded in Executive
Summary's fixed per-brand row layout — making it configurable is a larger,
riskier change than the Stores/Visitors/Purposes migration and was
deliberately not attempted opportunistically.
**Impact:** Adding a new brand/region/category today requires a code
change and redeploy. Flagged in the System Peripherals audit
(`reviews/`) as a candidate for a future phase, in dependency order after
the admin-access gap (D-007).

### D-014 — One authoritative document per category; no duplicate authorities
**Status:** Settled (governance)
**Decision:** Each documentation category (context, status, requirements,
architecture, data model, decisions, implementation history, testing
history, reviews, AI operating rules, and the two deployment-procedure
authorities) has exactly one authoritative document. When an older
supporting document disagrees with its category's authority, the older
document is corrected or explicitly marked historical — never left to
stand as a second, conflicting source.
**Rationale:** A future AI session must be able to determine project
state from the repository alone; two documents claiming the same
authority (or one silently going stale while another is updated) breaks
that guarantee.
**Impact:** The full authority table lives in `PROJECT_MEMORY.md` — not
repeated here. Do not create a new root document that duplicates an
existing category's role; update the existing authority instead. See
`CLAUDE.md` for the operating rules this decision implies (read
`PROJECT_STATUS.md` first, consult only the relevant document, record
meaningful changes where they belong).
