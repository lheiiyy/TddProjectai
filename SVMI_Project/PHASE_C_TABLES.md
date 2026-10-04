# Phase C — Visit tables inside the spreadsheet

Status: built on branch `svmi/phase-c-visit-tables`, **not deployed**.
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

## How rows get in

| Path | When | Notes |
|---|---|---|
| **Rebuild Visit Tables** (System Tools) | Once to start, then any time to repair | Rewrites both tables from MASTER_LOG in one pass. Holds the submission lock, so run it off-hours on a big log. |
| **Dual-write** (Input Portal) | Every new submission | Right after the MASTER_LOG append, inside the same lock. If it fails, the visit is still saved in MASTER_LOG, the error shows in Apps Script → Executions (and the ERROR_LOG sheet, if you have one), and the check tool will show it as missing. Does nothing until the tables exist. |
| **Check Visit Tables** (System Tools) | Any time, read-only | Compares MASTER_LOG with the tables: missing, extra, outdated rows, unmapped stores, unknown visitors/purposes, bad dates. |

Both tables are marked "warning on edit" — they are generated; fix data in MASTER_LOG and rebuild.

## Not in this phase

- Reports still read MASTER_LOG (Phase D switches them to these tables, one report at a time).
- MASTER_LOG is still the source of truth while both run side by side.
