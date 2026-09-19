# Database Phase 2 — Real-Data Migration Dry Run (tooling)

Status as of this commit: **analysis/reconciliation modules built and unit-
tested against synthetic inputs; NOT YET RUN against real spreadsheet
data.** See `database/docs/07-phase2-realdata-dryrun-report.md` (created
once a real run happens) for actual findings.

## Why this phase is paused on input, not logic

Phase 2 requires the ACTUAL SVMI spreadsheet data. This environment has a
live, authenticated `clasp` OAuth credential bound to the real production
Apps Script project, but:

- clasp's OAuth scopes do not grant direct Sheets API read access to cell
  values (its scopes cover script deployment/management, not spreadsheet
  data).
- The only way to pull real data with what's available would be to push a
  temporary export function to the LIVE production script and run it — a
  real (even if reverted) change to a production system.

Given the choice, the decision was: **the real export/CSV comes from the
user directly** — this environment never touches the live script or the
OAuth credential for data extraction. See the chat for the exact request.
Real extracted data and anything derived from it (raw artifacts,
quarantine lists, reconciliation reports with real names) stay **local/
ephemeral only** (this session used `/tmp/svmi_phase2_realdata/`, outside
the git working tree) and are never committed — only this
logic/tooling/docs layer, which contains zero real data, is committed.

## What's built (pure functions, unit-tested — `dryrun.test.js`, 37/37)

| Module | Purpose | Phase 2 rule |
|---|---|---|
| `date_parse.js` | Faithful JS port of `_parseDateCell()` (SVMKPI_CORE.gs) | #10, #5 |
| `quarantine.js` | Shared quarantine-entry collector, typed resolution categories | #4 |
| `masterlog_integrity.js` | The full MASTER_LOG integrity report (counts, malformed dates, duplicate candidates, visitor/purpose problems) | #9 |
| `reconcile_stores.js` | Exact-match-only store identity reconciliation | #6 |
| `reconcile_visitors.js` | Exact-match-only visitor identity reconciliation | #7 |
| `reconcile_purposes.js` | Purpose classification (legacy/configured/unknown/pre-configuration usage) | #8 |
| `reporting_year_check.js` | Reproduces `_ry_extractYearsFromLog()`'s exact algorithm + a source-vs-Postgres comparator | #10 |
| `config_overlap_check.js` | Generic effective-dated overlap/gap/duplicate detector, works across all 7 config areas | #12 |
| `snapshot_validation.js` | REPORT_SNAPSHOTS structural integrity (uniqueness, supersession chain validity, frozen-result presence) | #13 |

Each module is a pure function of its input — no filesystem, no network,
no database — so it was fully testable BEFORE any real data existed, and
needs no changes once real data arrives; only a reader that turns the real
export into the same input shape is still needed (see below).

## Phase 2A / 2A.2 — Store Identity & Historical Data Reconciliation

The real-data dry run (Phase 2) found production has never minted a Store
ID for any store, and confirmed real cross-brand location collisions (the
same physical location used by two different brands).

### Canonical identity rule (confirmed business rule, Phase 2A.2)

```
Store Identity = Location + Brand
canonical key   = NORMALIZED_LOCATION_NAME + '|' + NORMALIZED_BRAND
```

A physical location may host multiple brands. Each (Location, Brand) pair
is a **separate SVMI Store** with its own immutable Store ID — e.g. a town
with both a FIGARO and an ANGEL'S PIZZA location is two Stores, never one.
**Physical co-location does not imply Store identity equivalence.** Never
use Location alone, never Brand alone, and never a fuzzy/similarity match
to decide identity — same location + different brand always yields two
different canonical identities and two different proposed Store IDs.

The real spreadsheet's "Store" column is, in substance, a physical
**location** name (a town/site), not a store-chain-style unique code —
which is exactly why the same value can legitimately repeat under two
different brands. The dry-run model represents, per canonical identity:
physical location name, brand, canonical Store identity, and (once
approved) an immutable Store ID. A future database model MAY introduce a
separate `location_id` to represent "this physical site" independent of
which brand operates there — **that is explicitly out of scope for this
phase**; today the Store ID stays attached directly to the (Location,
Brand) operational identity, with no separate location table.

| Module | Purpose |
|---|---|
| `store_canonical_identity.js` | Derives canonical (Location, Brand) identities directly from raw SETTINGS + MASTER_LOG, before any Store ID exists. Classifies each identity as one of `EXACT_MATCH`, `SETTINGS_ONLY`, `DUPLICATE_SOURCE_ROWS`, `HUMAN_REVIEW`, or `MASTER_LOG_ONLY_UNRESOLVED` (see below). Never fuzzy-matches. |
| `store_id_generator.js` | Deterministic (RFC 4122 UUID v5) Store ID proposal — same canonical key always produces the same `STR-<uuid>`, across repeated runs, process restarts, and regardless of input row order. Proposal only; never writes anywhere. |
| `visitor_identity_classification.js` | Classifies each historical visitor token as an exact roster match, a case-only variant of a roster entry, a likely-new visitor, or unresolved — never silently merges case variants. |

`reconcile_stores.js` was also fixed in Phase 2A: its store-identity
grouping previously used Name alone, which real data proved wrong (see
above) — it now uses the same composite (Location, Brand) key.

### Classification enum (`STATUS`, exported by `store_canonical_identity.js`)

| Status | Meaning |
|---|---|
| `EXACT_MATCH` | Single SETTINGS row for this (Location,Brand) key, plus ≥1 historical MASTER_LOG visit under the same key. Strongest confidence. |
| `SETTINGS_ONLY` | Single SETTINGS row for this key, zero historical visits yet. A configured-but-unvisited store. |
| `DUPLICATE_SOURCE_ROWS` | More than one SETTINGS row shares this exact key AND all identity-relevant fields (Region, Category) agree — the same logical store entered twice. Collapses to **one** canonical identity; source-row provenance is retained, neither original row is touched. |
| `HUMAN_REVIEW` | More than one SETTINGS row shares the key but Region/Category disagree — a genuine conflict, never auto-resolved. |
| `MASTER_LOG_ONLY_UNRESOLVED` | The key appears only in MASTER_LOG history, with no SETTINGS row at all. No Store ID is proposed. |

`READY` is a roll-up label (`readyForStoreIdAssignment: true`), not a
sixth persisted status — it covers `EXACT_MATCH`, `SETTINGS_ONLY`, and
`DUPLICATE_SOURCE_ROWS`. `HUMAN_REVIEW` and `MASTER_LOG_ONLY_UNRESOLVED`
are never ready; a Store ID is never proposed for them.

### Determinism / order-independence

`store_id_generator.js` derives every proposed ID as a pure function of
the canonical key string alone (RFC 4122 UUID v5, SHA-1, fixed namespace)
— no randomness, no timestamp, no row number, and no dependence on the
order SETTINGS/MASTER_LOG rows were supplied in. `dryrun.test.js`'s
"identity stability" tests prove this directly: the same canonical
identities, statuses, and proposed Store IDs result whether SETTINGS rows
are supplied in their original order, a shuffled order, or as an
independently-constructed but data-equivalent row set.

### Phase 2A.3 — final classification of MASTER_LOG-only unresolved identities

For a `MASTER_LOG_ONLY_UNRESOLVED` identity, two more modules determine
whether it should ultimately be treated as `EXISTING`, `NEW`, or
`HUMAN_REVIEW` (see `historical_identity_classification.js`'s `CLASSIFICATION`
enum) — still never minting or writing anything:

| Module | Purpose |
|---|---|
| `location_convention_candidates.js` | Finds same-brand canonical identities whose location word-sequence is an exact prefix/suffix of the historical location's (or vice versa) — a real naming convention some organizations use (e.g. a brand-word folded into the location label itself), evidenced from the canonical dataset, never a similarity/edit-distance score. Never crosses brands. |
| `historical_identity_classification.js` | `EXISTING` only on an exact (Location,Brand) match; `HUMAN_REVIEW` when a same-brand convention candidate exists (real ambiguity, never auto-resolved); `NEW` when neither applies — never mints a Store ID for `NEW`/`HUMAN_REVIEW`. |

Same-location/different-brand candidates are still tracked (from
`findLocationOnlyCandidates`) but never influence this classification —
they exist purely for human context, consistent with the confirmed rule
that brands differing always means a different Store regardless of
physical co-location.

### Phase 2A.4 — operational status and Store-ID finalization

Two more modules keep two more concerns cleanly separate, on top of
everything above:

| Module | Purpose |
|---|---|
| `operational_status.js` | Records a business-DECLARED status (`ACTIVE`/`INACTIVE`/`UNSPECIFIED`) for a canonical identity — never inferred from data. Deliberately writes to an `operationalStatus` field, not `status`, because `store_canonical_identity.js` identities already use `status` for their own EXACT_MATCH/SETTINGS_ONLY/etc. classification — reusing the name would silently clobber it. |
| `store_id_finalization.js` | Decides whether a classified identity gets a proposed Store ID: `EXISTING` always keeps its already-known canonical ID; `HUMAN_REVIEW` NEVER receives one (minting one would silently presuppose "this is a separate Store," which is exactly the open question); `NEW` receives one only when a separate, explicit `identityEstablished` administrative flag says so. |

Operational status and the "established" flag are both external,
declared inputs — never derived from evidence — and neither one is ever
part of a Store ID's derivation (`store_id_generator.js` takes only the
canonical key string), so declaring a historical identity `INACTIVE`
never changes its deterministic Store ID.

### Phase 2A.5 — administratively confirmed merges and distinct-new Stores

Once a business decision explicitly confirms either "this historical
identity IS an existing canonical Store" or "this historical identity IS
a distinct new Store," two things apply that decision without ever
letting it masquerade as something the evidence itself discovered:

| Module/change | Purpose |
|---|---|
| `historical_identity_classification.js`'s `confirmedCanonicalMatch` param | An explicit, external fact (never inferred) that a historical identity is the same Store as a given canonical identity. Reclassifies to `EXISTING`, tagged `matchType: ADMINISTRATIVELY_CONFIRMED_MERGE` — distinct from an automatic `EXACT_MATCH`, so the evidence trail never claims a match was "discovered" when it was actually declared. |
| `administrative_confirmation.js` | Labels the administrative act itself, from signals that already exist elsewhere: `EXISTING_CANONICAL` (a confirmed merge), `CONFIRMED_DISTINCT_STORE` (a `NEW` identity administratively authorized to receive a Store ID), or `NONE` (no administrative act was involved — including a genuine automatic `EXACT_MATCH`, which needs no confirmation at all). |

Two guarantees hold regardless of which path an identity took: a
confirmed merge always reuses the target's existing Store ID (never
mints a second one for the same Store), and administrative confirmation
of distinctness never reclassifies a `NEW` identity as `EXISTING` — it
only ever authorizes `store_id_finalization.js` to mint a deterministic
ID for it.

### Phase 2 — visitor identity reconciliation (mirrors the Store pattern)

`visitor_identity_finalization.js` applies the same discipline used for
Stores — automatic evidence vs. explicit administrative confirmation,
kept strictly separate — to visitor tokens:

| Concept | Store domain | Visitor domain |
|---|---|---|
| Automatic evidence | `store_canonical_identity.js` | `visitor_identity_classification.js` (unchanged) |
| Confirmed merge into an existing identity | `historical_identity_classification.js`'s `confirmedCanonicalMatch` | `finalizeVisitorIdentity()`'s `confirmedMerge` |
| Confirmed distinct new identity | `store_id_finalization.js`'s `identityEstablished` | `finalizeVisitorIdentity()`'s `confirmedDistinct` |
| Administrative-act labels | `administrative_confirmation.js` | `visitor_identity_finalization.js`'s own `ADMINISTRATIVE_CONFIRMATION` (`CONFIRMED_EXISTING_IDENTITY` / `CONFIRMED_DISTINCT_VISITOR_IDENTITY` / `CONFIRMED_VISITOR_IDENTITY`) |
| Canonical identity key | deterministic `STR-<uuid>` (no existing scheme) | the visitor's own normalized name — `SVMKPI_CONFIG.gs`'s `CFG_AREA_SCHEMAS.VISITORS` already documents Entity ID = normalized Visitor Name as the interim scheme, so no new ID generator was invented here |

A confirmed merge (e.g. a nickname-style token identified as an existing
roster member) always reuses that member's identity and is tagged
`matchType: ADMINISTRATIVELY_CONFIRMED_MERGE` — distinct from an
automatic `EXACT_ROSTER_MATCH`, so the record never claims a match was
discovered when it was actually declared. Confirming a token as a
distinct new visitor never reclassifies it as `EXISTING` — it stays
`NEW`, with the administrative act recorded separately. Operational
status (e.g. an inactive visitor) is layered on afterward via the same
`operational_status.js` used for Stores, under its own
`operationalStatus` field — never overloaded onto identity
classification.

## What's still needed once real data is available

1. **A reader** turning whatever file the user provides (CSV per sheet, or
   a single multi-sheet export) into the raw row shapes these modules
   consume — not yet written, since the exact format depends on what's
   provided.
2. **`raw_capture.js`** — writes the immutable raw-extraction artifact
   (rule #4) with run metadata (timestamp, run ID, sheet names/dimensions,
   row counts) to the local ephemeral run directory.
3. **`run_dry_run.js`** — orchestrates: raw capture → build the
   intermediate shape → run every module above → write
   quarantine/reconciliation reports → load into a FRESH isolated DEV
   PostgreSQL database (reusing `database/import/load.js`'s proven
   TRUNCATE/INSERT approach and `create_roles.sql`/`harden_grants.sql`) →
   count/content reconciliation → idempotency re-run → permission
   re-verification.
4. Business-logic parity checks (rule #19) and the final structured
   completion report (rule #25), both of which need real numbers to be
   honest rather than illustrative.
