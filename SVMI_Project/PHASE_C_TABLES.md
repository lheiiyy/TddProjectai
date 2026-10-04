# Phase C — Visit tables inside the spreadsheet

Status: **live since v14 (2026-10-03)**. C.1 Store Name Matching (below) is on
branch `svmi/store-name-matching`, ready for v15.
Decision (2026-10-03, Leo): keep everything in Google Sheets, but give visits
proper tables. MASTER_LOG stays as the **audit trail**.

## Why

MASTER_LOG is one wide row per submission: store as a name, brand/region
copied onto every row, and several visitors packed into one cell
(`LEO | ANN`). Every report has to re-split and re-match that text. The new
tables store each fact once, by ID, the same shape as the PostgreSQL design
in `database/migrations/008_store_visits.sql` — so moving to a real database
later (full-stack app) is a straight table copy, not another redesign.

## Tables

### `STORE_VISITS` — one row per visit (one per MASTER_LOG row)

| Col | Header | Meaning | Postgres (`store_visits`) |
|---|---|---|---|
| A | Visit ID | Stable ID, derived from the MASTER_LOG row content (see below) | `store_visit_id` |
| B | Date Visited | Date only | `visited_at` |
| C | Store ID | `STR-…` from CONFIG_STORES; blank if the name can't be mapped | `store_id` |
| D | Purpose ID | Normalized purpose (`STORE VISIT`, `TLTC`, …) | `purpose_id` |
| E | Remarks | As entered | `remarks` |
| F | Recorded At | MASTER_LOG timestamp | `recorded_at` |
| G | Store Name (as recorded) | The name typed at the time — needed for unmapped rows | used only to resolve unmapped stores |
| H | Source Row | MASTER_LOG row number when last written — for humans to find the row | `source_row_ref` |

Brand and region are **not** copied here. They come from CONFIG_STORES for
the visit date (Store ID → store version), which is the design's rule: one
place for each fact.

### `STORE_VISIT_VISITORS` — one row per visitor per visit

| Col | Header | Postgres (`store_visit_visitors`) |
|---|---|---|
| A | Visit ID | `store_visit_id` |
| B | Visitor ID | `visitor_id` (visitor IDs are the uppercase names, same as CONFIG_VISITORS) |

`LEO | ANN` becomes two rows. A name repeated in one cell (`ANN|ANN`) counts once.

## Visit ID

`V-` + first 20 hex characters of SHA-256 over the row's content
(timestamp | date | store | visitors | purpose). Same row → same ID, every
time, so the tables can be rebuilt from MASTER_LOG at any moment without
IDs changing. Two byte-identical MASTER_LOG rows get `-2`, `-3`, … in order.
No column is added to MASTER_LOG (its columns I/J already have other uses).

## Store ID resolution (same rules as the rest of the app)

1. MASTER_LOG column I (Store ID) when present.
2. Exact name match against any version of any store in CONFIG_STORES
   (only if the name belongs to exactly one Store ID).
3. A RECONCILED entry in CONFIG_UNMAPPED_STORES.
4. Otherwise blank — counted as "unmapped" by the check tool. Never guessed.

Whichever step finds it, a Store ID that was merged into another one
(CONFIG_STORE_MERGES, written by Store Name Matching) is followed to the store
it was merged into. So step 2 also accepts a name shared only by a store and
its merged duplicate.

## How rows get in

| Path | When | Notes |
|---|---|---|
| **Rebuild Visit Tables** (System Tools) | Once to start, then any time to repair | Rewrites both tables from MASTER_LOG in one pass. Holds the submission lock, so run it off-hours on a big log. |
| **Dual-write** (Input Portal) | Every new submission | Right after the MASTER_LOG append, inside the same lock. If it fails, the visit is still saved in MASTER_LOG, the error shows in Apps Script → Executions (and the ERROR_LOG sheet, if you have one), and the check tool will show it as missing. Does nothing until the tables exist. |
| **Check Visit Tables** (System Tools) | Any time, read-only | Compares MASTER_LOG with the tables: missing, extra, outdated rows, unmapped stores, unknown visitors/purposes, bad dates. |

Both tables are marked "warning on edit" — they are generated; fix data in MASTER_LOG and rebuild.

## C.1 — Store Name Matching (Admin → Tools)

Phase D takes brand/region from CONFIG_STORES by Store ID, so every visit
needs one first. The tool (`SVMKPI_STORE_MATCH.gs`) lists three kinds of
problem and fixes only what an admin picks, after a preview:

| Problem | Choices | What it writes |
|---|---|---|
| A MASTER_LOG name that matches no store | **New store — closed** (open from the first visit, inactive from a date after the last visit), **New store — still open**, **Same store as…** an existing store, Skip | CONFIG_STORES (+ CONFIG_AUDIT); the name's CONFIG_UNMAPPED_STORES entry → RECONCILED |
| Two stores of the **same brand** that are one store (e.g. Figaro SANTA MARIA + STA MARIA) | **Merge** into the store marked Keep, with one name for all visits | The duplicate's versions are voided (it resolves on no date, so no report treats it as a store that needed visits); CONFIG_STORE_MERGES row "duplicate → kept"; the kept store gets a new name version from today |
| One store whose visits carry different spellings | **One name** for all its visits | Optional new name version |
| A store whose name differs from the same town's store of another brand only by spelling or a tag (Figaro "STA. MARIA (F)" vs Angel's Pizza "STA. MARIA") | **Section 4: use the other brand's spelling** (pre-ticked for tag/punctuation-only differences) | The store gets a new name version from today; its MASTER_LOG rows get the name (Store ID and brand unchanged) |
| An unmatched name saved under two or more brands (may be two stores) | **Split by brand** first: the other brands' visits get "NAME (F)" etc. (column C only), then each name is handled on its own | Nothing in Configuration |

Every choice also writes the store's name (column C) and Store ID (column I)
on the affected MASTER_LOG rows — only those two cells, only on those rows —
so today's name-based reports (Unvisited/NAC, Store Insights, Store Health)
see one store with its whole history. Each changed row is logged in
**MASTER_LOG_FIXES** (old name, new name, old ID, new ID, who, when), so the
original spelling is never lost. This is the "separate, deliberate backfill"
`store_reconcileUnmapped()` was documented as leaving for later.

Names: two stores of **different brands may share a name** (Figaro STA. MARIA + Angel's Pizza STA. MARIA) — the Input Portal sends the Store ID, reports and the SETTINGS mirror add the brand to the key only when a name is shared, and the visit-table resolver places a row with no Store ID by its Brand column. Only a name already used by a store of the same brand is refused.

Rules: never merges across brands (an Angel's Pizza and a Figaro in the same
town are two stores — `database/dryrun` has the same rule); a new or final
name can't be one another store already uses; suggestions (★ = same brand,
same name once spelling is ignored) are only suggestions; every choice is
re-validated on the server and applied one per call under the submission
lock; just before MASTER_LOG is written the target rows are re-read and nothing is written if anyone added, deleted or sorted rows meanwhile; MASTER_LOG_FIXES is written before the rows, and a merge is recorded before the duplicate is retired; the portal stops a batch at the first failure; Store Health is refreshed once at the end, then the visit tables are
rebuilt and checked.

Note: a row whose name is corrected gets a new Visit ID on the next rebuild
(the ID is derived from the row's content). Nothing references Visit IDs
yet, so this is harmless today. Once something does (Phase D/E), corrections
should be made in the tables, not in MASTER_LOG.

Undo: File → Version history in the spreadsheet restores everything at once;
MASTER_LOG_FIXES and CONFIG_STORE_MERGES show exactly what changed.

## Phase D — reports read the tables by Store ID

`SVMKPI_VISIT_DATA.gs`. One report at a time; each one keeps its MASTER_LOG version.

| Step | Report | Status |
|---|---|---|
| D.1 | Visited This Month | ✅ built (v19) |
| D.2 | Unvisited / NAC (compliance gaps) | ⏳ |
| D.3 | Store Insights | ⏳ |
| D.4 | Store Health + Store Master Insight | ⏳ |
| D.5 | Executive Summary / KPI | ⏳ |

- **Report Source** (System Tools): *Use visit tables* / *Use MASTER_LOG* — Script Property
  `SVMI_REPORT_SOURCE`. Default MASTER_LOG, so deploying changes nothing until an admin switches.
  Missing tables → MASTER_LOG automatically.
- **Compare Reports** (System Tools, read-only): runs each switched report both ways for every month of the
  year and lists differences. Visits the old report couldn't place (closed stores, old spellings) are counted
  as "placed", not as differences.
- On the tables a visit belongs to its Store ID; name/brand/region come from the store's current
  CONFIG_STORES version (closed stores included). Only visits with no Store ID are "unmapped".
- Known difference (old report wrong): a closed store that shares its name with an open store of another
  brand isn't in SETTINGS, so the MASTER_LOG version counts its visits for the open store
  (e.g. Figaro URDANETA → Angel's Pizza URDANETA). The tables version counts them correctly.
- MASTER_LOG stays the source of truth (the tables are rebuilt from it) until Phase E.
