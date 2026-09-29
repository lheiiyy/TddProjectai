# System, Data Source & URL Audit — Figaro TDD Training Systems

**Scope:** Everything discovered to be part of, or feeding, the Training & Development
Division's systems: `lheiiyy/TddProjectai` (SVMI_Project, TLM_Project, `database/`),
`lheiiyy/kpi-monitoring-hub`, the underlying Google Sheets/Drive/Apps Script assets,
and the Netlify deployment.

**Method:** Compiled from direct inspection of repository files, live Google Drive/Sheets
metadata and content, GitHub branch/commit state, and Netlify project state — via the tools
available in this session — plus one prior in-repo investigation (`SVMI_Project/reviews/REVIEW-002.md`)
whose findings are cited, not re-derived. Anything not directly confirmed is marked
`NOT VERIFIED` rather than guessed. Facilitator/trainer names appear in places where the
system's own design makes them structural identifiers (rosters); individual trainee/staff
names in raw evaluation data are described by schema/example rather than reproduced in full.

**Audited:** 2026-09-29. **Author:** Claude (Sonnet 5), this session.

---

## 1. Application / System Inventory

| System | Purpose | Business function | Used by | Consumes it | Status | Tech | Owner (account) | Source of truth? |
|---|---|---|---|---|---|---|---|---|
| **SVMI (Store Visit Monitoring Initiative)** | Store-visit logging, KPI tracking, risk scoring for Angel's Pizza / APEX / Figaro / Tien Ma's / Koobideh stores | Compliance & operations oversight | Field visitors, HRAD admins | Web App users (Google sign-in), TDD leadership via Reports tab | **Production** (live, actively used — 1,136+ real visit rows) | Google Apps Script (V8), bound to a Google Sheet | `hrad.tnd@gmail.com` (deployer) | **Yes** — `MASTER_LOG` is authoritative for visit records |
| **SVMI test-copy (`Copy of sys.STORE VISIT 2026`)** | Pre-production testbed for SVMI code, confirmed via live `clasp pull` (19 deployed versions) | Same as SVMI, but for validating changes before they reach production | Developers/QA (per `REVIEW-002.md`) | — | **Testing** | Same stack as SVMI | Same Drive space | No — mirror/testbed, not authoritative |
| **TLM (Team Leader Monitoring / "TL Tracker")** | Tracks trainee Team Leader onboarding: New Entry, Certify, Uniform, Stock | HR/training certification workflow | Field users via a phone-friendly Web App link | Whoever holds the 4+ char access PIN | **Planned/Not deployed** — repo has only `.clasp.json.example`; no committed real Script ID | Google Apps Script (V8), bound to `[cowork] Team Leader Monitoring` Sheet | `NOT VERIFIED` (no live deployment confirmed in this audit) | Yes, for its own `MASTER_LOG`/`UNIFORM_LOG`/`UNIFORM_INVENTORY` tabs, once deployed |
| **`database/` (PostgreSQL migration target)** | Designed schema to eventually replace SVMI's Sheets backend | Future data-layer modernization | Nobody yet — no runtime consumer | — | **Dev-only / not deployed** — proven only against a local ephemeral Postgres instance with synthetic/fixture data | PostgreSQL 13+ (portable — Supabase/Neon/Railway/RDS/local Docker all cited as targets) | N/A (no live host) | No — zero live connection to SVMI or TLM today |
| **Store Visit Evaluation Survey (Google Form)** | Collects post-visit participant feedback (15 criteria, 5-pt scale) | Facilitator performance / Coaching & Feedback KRA | Store staff who attended a training activity | Facilitator KPI Scorecard (client-side CSV parse) | **Production** — 170 real responses (8 Jul–28 Sep 2026) | Google Forms → Sheet responses | `lheii.fcsitraining@gmail.com` | Yes, for Coaching & Feedback KRA |
| **CROSS TRAINED STAFFS MONITORING.xlsx** | Logs station cross-training/certification events (date, store, trainee, mother station, tech/exam grade, new station, facilitator) | Staff Proficiency / Cross-Training KRA | Whoever logs certifications (facilitators) | Staff Proficiency KRA (not yet wired) | **Production, actively updated** (modified as recently as 2026-09-28) | Native Excel file (`.xlsx`) stored in Drive, not a Google Sheet | `allianakristine.fcsitraining@gmail.com` | Yes, for Staff Proficiency KRA — but not yet read by any code in this system |
| **Training Program & Delivery Monitoring 2026** (Sheet) | Session log: ID, date, program, training type, brand, store, facilitator(s), pax, duration, status, post-test avg | Training Program Delivery KRA | Whoever logs sessions | Training Program Delivery KRA page (linked, not parsed) | **Provisioned, empty** — headers/dropdowns only, `TPD-0001…0300` pre-filled IDs, zero real rows | Google Sheets | `lheii.fcsitraining@gmail.com` | Would be, once populated |
| **TDD Team Attendance Monitoring 2026** (Sheet) | Per-facilitator daily attendance/status/leave log | Attendance / Punctuality / Behavior KRA | Whoever logs attendance | Attendance KRA page (linked, not parsed) | **Provisioned, empty** | Google Sheets | `lheii.fcsitraining@gmail.com` | Would be, once populated |
| **KPI Monitoring Hub** | Static landing page + 5 KRA pages presenting the above | Facilitator KRA scorecard, pilot rollout | HRAD / TDD leadership (pilot testers) | The 5 data sources above (partially) | **Pilot — live** | Static HTML/JS, no backend | GitHub: `lheiiyy` | No — presentation layer only |
| **Netlify (`tnddkpi` project)** | Hosts KPI Monitoring Hub + a Basic-Auth edge function gate | Pilot access control & hosting | Pilot testers via browser | GitHub (`lheiiyy/kpi-monitoring-hub`, auto-deploy on push) | **Production (pilot)** | Netlify (Edge Functions, Deno runtime) | Netlify team `6abb57be952e64dc5d1d0f5a` | No — hosting/delivery only |
| **GitHub (`lheiiyy/TddProjectai`)** | Source repo for SVMI, TLM, database schema | Version control / source of truth for code | Developers, AI assistants, `clasp` (deploy pipeline) | Apps Script deploy (`clasp push`), local dev | **Active** | Git / GitHub | `lheiiyy` | Yes, for source code — **not** for the two live-deployed scripts' actual manifests (see §5, D-025 finding) |
| **GitHub (`lheiiyy/kpi-monitoring-hub`)** | Source repo for the KPI pilot site | Version control for pilot frontend | Netlify (auto-deploy), developers | — | **Active, public** (made public to enable the free tier for Pages/Netlify visibility) | Git / GitHub | `lheiiyy` | Yes, for pilot frontend code |
| **`SVMI_Command_Center_Demo.html`** | Standalone, no-backend preview of `SVMI_PORTAL.html` with ~90 sample records | Design/demo review without touching real data | Anyone opening the file locally | Nothing — self-contained | **Demo only** — explicitly not part of the Apps Script project | Static HTML | In-repo | No — sample data only |

---

## 2. URL / Location Inventory

| Component | Location | Environment | Purpose | Authoritative? | Verified? |
|---|---|---|---|---|---|
| SVMI production Apps Script | Script ID `1QHHyLl8GDZcm7s_Q97ZmcC_rn6-g5hW9CAVLcnnc2Ab8ASdLgh0Feax4` | Production | Live Web App backend | Yes, for code currently running live | Yes — confirmed via `REVIEW-002.md`'s direct `clasp pull` |
| SVMI test-copy Apps Script | Script ID `1UU582VPImQRpvQCtNHLOjmp6_0MBN5v0XA9Z1OJPnxpjDEz8NswYTVLb` (19 deployed versions) | Testing | Pre-prod validation | No | Yes — same source |
| SVMI production Web App URL | `NOT VERIFIED` — the `/exec` deployment URL itself was not retrieved in this audit (only the Script ID) | Production | End-user entry point | — | No |
| SVMI Google Sheet (`[sys] STORE VISIT 2026`) | `https://docs.google.com/spreadsheets/d/1arr0GxjsS78Xvjkf4jANvo0SqYnoXYo8Y_wIvAvbV8M/edit` | Production | `MASTER_LOG` + reporting tabs | **Yes** — for visit data | Yes — read directly this session |
| Store Visit Evaluation Survey responses | `https://docs.google.com/spreadsheets/d/1fyzDps5drwUupwI4tzUNxVMxh_oeTL_3QUlA5NSRlx8/edit` | Production | Raw survey responses | Yes | Yes |
| CROSS TRAINED STAFFS MONITORING.xlsx | `https://drive.google.com/file/d/1uamvET98UKWB51e-sB8KRNDJIfNcQgXz/view` | Production | Staff Proficiency source data | Yes | Yes — read directly this session |
| Training Program & Delivery Monitoring 2026 | `https://docs.google.com/spreadsheets/d/1mp4-6KHcX5iDB5Oto1Smjfyq-xW4KAZCC8CA09hhpB4/edit` | Pilot/provisioned | Training Program Delivery source | Yes, once populated | Yes |
| TDD Team Attendance Monitoring 2026 | `https://docs.google.com/spreadsheets/d/1mRlptbGDu-KeCt2PdaxPfMjlidmRaw2TFr-J0pqjsGc/edit` | Pilot/provisioned | Attendance source | Yes, once populated | Yes |
| "KPI Data sheet (Pilot)" Drive folder | `https://drive.google.com/drive/folders/1YBnR_TIvEhNh4uDXyqyTy0RKejOFQbSq` | Pilot | Holds the 3 sheets above + 3 shortcuts | — | Yes |
| "TDD Core Room" Drive folder | `https://drive.google.com/drive/folders/1NIbXvY2q5KujWthDCYQVzpqeESZPpvxW` (owner `daniel@figaro.ph`) | Production | Parent of "KPI Data sheet (Pilot)" and the cross-training file — the actual company-owned shared workspace | — | Yes |
| "STORE VISIT FILES" Drive folder | `https://drive.google.com/drive/folders/1nYgZ6c6Fr9WkyPPed6oq1yfFt23tAdwf` (owner `hrad.tnd@gmail.com`) | Production | Parent of the Survey Form's "FEEDBACK FORM" folder | — | Yes |
| GitHub repo — TddProjectai | `https://github.com/lheiiyy/TddProjectai` | Development | Source code (SVMI, TLM, database schema) | Yes, for code | Yes |
| GitHub repo — kpi-monitoring-hub | `https://github.com/lheiiyy/kpi-monitoring-hub` | Production (pilot) | Source code for pilot frontend | Yes, for code | Yes |
| Branch `main` | `TddProjectai@main` | Development | Has Phase 2A identity-reconciliation work the other branch lacks | Partial — see §5 | Yes |
| Branch `claude/svmi-reports-source-of-truth` | `TddProjectai` commit `c078be5` | Development (undeployed) | Most complete **documented** governance record (`PROJECT_STATUS.md`, `DECISIONS.md`, `reviews/001-013`, etc.), 47 commits main never received | Disputed — see §5 | Yes (branch exists, confirmed via `list_branches`) |
| 8 other `claude/*` branches | `android-parental-monitor-g7f44m`, `file-review-kvc56h`, `hub-project-update`, `kind-feynman-5dd5ev`, `session-cse-…`, `svmi-migration-performance-fix`, `tlm-ai-8p9tbw`, `tlm-update` | Unknown | **Not audited in this pass** | — | Existence confirmed, content `NOT VERIFIED`. `android-parental-monitor-g7f44m` in particular looks unrelated to this project by name — worth a sanity check. |
| Branch `kpi-monitoring-initiative` | `TddProjectai@kpi-monitoring-initiative` | **Legacy/orphaned** | Still physically contains the old `KPI_Monitoring_Initiative/` folder; PR #10 was closed (not merged) once the content moved to `kpi-monitoring-hub` | No — superseded | Yes |
| Netlify site `tnddkpi` | `https://tnddkpi.netlify.app` (admin: `https://app.netlify.com/projects/tnddkpi`) | Production (pilot) | Hosts the KPI Monitoring Hub, gated by Basic Auth edge function | — | Yes |
| Netlify env vars | `PILOT_USER`, `PILOT_PASSWORD` on the `tnddkpi` site | Production (pilot) | Basic Auth credentials for the edge function | — | Yes — confirmed non-secret scope covers `runtime`/`functions` |
| Local dev DB connection | `.env.dev.example` template only — no real host | Development | Would-be Postgres connection | — | `NOT VERIFIED` — no live host exists |
| Session-start deploy credential | Env var `CLASPRC_JSON_B64`, restored to `~/.clasprc.json` by `.claude/hooks/session-start.sh`, only in Claude Code web/remote sessions | Development tooling | Lets a Claude Code session run `clasp push`/`clasp deploy` | — | Yes (mechanism confirmed by reading the hook script) |

---

## 3. Data Source Inventory

| Source | Location | Owner | Contains | Read by | Written by | Authoritative? | Duplicate of another source? | Generated? | Safe to delete/rebuild? | Historical? | Config? | Operational? |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `MASTER_LOG` (SVMI Sheet) | `[sys] STORE VISIT 2026` | `hrad.tnd@gmail.com` | 1,136 real visit rows: timestamp, visit date, store, brand, region, visitor, purpose, remarks, # of visit | SVMI Web App, Reports tab, `SVMKPI_*` scripts | `INPUT_PORTAL.gs` (`processSubmissionAsync()`) | **Yes** | No | No — primary log | No | Yes (Jan–Sep 2026 so far) | No | Yes |
| `EXECUTIVE SUMMARY` / `KPI 2026` / `STORE MASTER INSIGHT` / `STORE HEALTH` / `RISK ENGINE` / `Q1-Q4_REPORT` (SVMI Sheet tabs) | Same Sheet | Same | Computed rollups (visitor leaderboard, store risk, per-store insight, quarterly reports) | HRAD, `SVMKPI_REPORTS.gs` | `SVMKPI_LAYOUT.gs`, `SVMKPI_KPI_REBUILD.gs`, `SVMKPI_RISK.gs`, `SVMKPI_STORE_MASTER.gs`, `SVMKPI_REPORT_SNAPSHOT.gs` | No — derived | No | **Yes** — rebuilt from `MASTER_LOG` | Yes, rebuildable from `MASTER_LOG` | Report snapshots are historical by design | No | Yes |
| `SETTINGS` (SVMI Sheet tab) | Same Sheet | Same | Stores list, brand, region, category, visited-by roster, admin emails, guest password, visit-type list | `SVMKPI_ACCESS.gs`, `SVMKPI_STORE_CONFIG.gs`, Input Portal | HRAD admins, `portal_*` functions | Yes, for config | No | No | No — hand-maintained config | Partially | **Yes** | Partially |
| `CONFIG_*` sheets (7 areas: KPI, Compliance, Risk, Purpose, Store identity, unmapped stores, audit) | Same Sheet | Same | Versioned configuration objects (Phase 1D/1A work) | `SVMKPI_CONFIG.gs` and area-specific `*_CONFIG.gs` files | Same | Yes, for config | No | No | No | Yes — versioned with effective-dating | **Yes** | No |
| Store Visit Evaluation Survey responses ("Form responses 1") | `1fyzDps5...` Sheet | `lheii.fcsitraining@gmail.com` | 170 rows: timestamp, position, brand, date, store, activity, facilitator/trainer free text, 15 rated criteria, 3 free-text fields | Facilitator KPI Scorecard (`pages/coaching-feedback.html`, client-side JS) | Google Form submissions | **Yes** | No | No | No | Yes (Jul–Sep 2026) | No | Yes |
| `CROSS TRAINED STAFFS MONITORING.xlsx` | `1uamvET9...` (Drive, "TDD Core Room") | `allianakristine.fcsitraining@gmail.com` | Cross-training/certification events: date, store, trainee name, mother station, tech val grade, exam grade, new station, certifying facilitator, brand section (FIGARO / ANGEL'S PIZZA / …) | Nobody yet (not wired into any code) | Manually, by facilitators/admin | **Yes** | No | No | No | Yes | No | Yes |
| Training Program & Delivery Monitoring 2026 | `1mp4-6KHc...` Sheet | `lheii.fcsitraining@gmail.com` | `SESSION_LOG`: Session ID, date, program/module, training type, brand, store/venue, facilitator(s), target/actual pax, duration, status, post-test avg, remarks + a `LISTS` tab of dropdown values | Nobody yet — page links out, doesn't parse | Would be manual entry | Would be, once populated | No | No | Yes | N/A yet | No | Would be |
| TDD Team Attendance Monitoring 2026 | `1mRlptbGD...` Sheet | `lheii.fcsitraining@gmail.com` | `ATTENDANCE_LOG`: date, team member, position, status, time in/out, work location, leave type, remarks + `LISTS` tab | Nobody yet | Would be manual entry | Would be, once populated | No | No | Yes | N/A yet | No | Would be |
| `database/migrations/*.sql` (13 files) | `TddProjectai` repo | Repo | PostgreSQL schema DDL designed to mirror SVMI's Sheets model | `run_migrations.sh` (dev only) | Developers | No — not deployed anywhere live | Conceptual duplicate of SVMI's Sheets schema (intentional — future migration target) | No | Yes — reversible via matching `rollback/*.sql` | No | **Yes** | No |
| `database/seed/dev_seed.sql` | Same | Repo | Synthetic dev fixture data | Local dev Postgres only | Developers | No | No | Yes | Yes | No | No | No |
| `database/dryrun/*` (21 JS modules) | Same | Repo | Reconciliation/classification logic for real-data migration prep, unit-tested only against synthetic fixtures | Nobody live | Developers | No | No | No (logic) | Yes | No | No | Partially (prep tooling) |
| `SVMI_Project/reviews/REVIEW-001.md`, `REVIEW-002.md` | Same | Repo | Fix backlog + governance baseline, incl. the `main` vs. `claude/svmi-reports-source-of-truth` branch-reconciliation decision | Developers, AI assistants | A prior Claude session, Product-Owner-confirmed | Yes, as a governance record | No | No | No — decision record | Yes | No | No |
| `live-backup-20260916/`, `live-backup-20260929/` | `SVMI_Project/` | Repo | Point-in-time snapshots of the live Apps Script project's actual code+manifest | Nobody automated | Manual `clasp pull` snapshots | No — snapshot, not live | Yes, of the live script (by design — that's the point) | No | Yes (they're already backups) | Yes | Partially (manifest) | No |
| Netlify env vars (`PILOT_USER`, `PILOT_PASSWORD`) | Netlify `tnddkpi` project config | Netlify team | Pilot Basic Auth credentials | `netlify/edge-functions/basic-auth.js` | Set via this session's Netlify MCP tool access | Yes, for pilot access | No | No | No — would break login if deleted without updating the edge function | No | **Yes** | No |
| `kpi-monitoring-hub` static pages | Repo `lheiiyy/kpi-monitoring-hub` | Repo | Hardcoded illustrative KPI numbers (Attendance, Store Visit Compliance, Staff Proficiency, Training Program Delivery) + one real computed dataset (Coaching & Feedback) | Pilot testers (browser) | Developers (hand-written HTML) | **No, for 4 of 5 KRAs** — explicitly placeholder/example numbers, not live-computed | Partial — mirrors the KRA formula template image, not a real source | Partially (Coaching & Feedback is computed from real CSV at page-load) | Yes | No | No | Mixed |

---

## 4. What each store actually contains (entity breakdown)

**SVMI `MASTER_LOG`:** Timestamp · Visit Date · Store · Brand · Region · Visited By (facilitator) · Purpose (Store Visit / TLTC / Failed QA-MS / Curing-Support / CAPAR) · Remarks · Name · # of Visit.

**SVMI `STORE MASTER INSIGHT`:** Store #/Name · Brand · Region (As Managed By) · Category (As Region) · Total Visits YTD · Store Visits · TLTC · Failed QA/MS · Curing/Support · Last Visit Date · Days Since Visit · Last Purpose · Risk Tier · Visit Status (e.g. "✅ COMPLIANT" / "⚠️ NOT YET VISITED" / "— NEVER VISITED").

**SVMI `EXECUTIVE SUMMARY`:** KPI totals (visits, TLTC, failed QA/MS, curing/support, NCR/provincial split) · monthly visit counts by brand · visits by region · visit-purpose breakdown · top-10 most-visited stores · **visitor leaderboard (YTD)** — real per-facilitator visit counts (e.g. Leo 204, Charlie 198, Ann 176, Ver 154, James 136, Alex 96, Yana 86, Sky 60, Gio 50, Rice 40, Josh 23, Daniel 17) · brand performance summary.

**Store Visit Evaluation Survey responses:** Timestamp · respondent Position · Brand · Date · Store · Activity Conducted · Facilitator/Trainer (free text) · 15 rated criteria (objectives clarity, content relevance, facilitator expertise, organization, practical examples, question handling, knowledge gain, operational improvement, participation encouragement, overall satisfaction, + 6 learning-impact statements) · 3 free-text fields (most valuable aspect, areas to improve, requested future topics) · store-code columns per brand (APX/FG/TM/KK Store).

**CROSS TRAINED STAFFS MONITORING.xlsx:** Date of Validation · Store · trainee Name · Mother Station · Tech Val Grade (%) · Exam Grade (%) · Station Validation (the new station certified) · certifying facilitator (Training Dept. column) · pass/fail annotation (e.g. "FAILED") — organized in per-brand blocks (FIGARO, ANGEL'S PIZZA) within one sheet.

**Training Program & Delivery Monitoring 2026 (once populated):** Session ID (`TPD-####`) · Date · Program/Module · Training Type · Brand · Store/Venue · Facilitator(s) · Target Pax · Actual Pax · Duration (hrs) · Status · Post-Test Avg (%) · Remarks.

**TDD Team Attendance Monitoring 2026 (once populated):** Date · Team Member · Position · Status (Present/Late/Half Day/Absent/On Leave/Official Business/WFH/Rest Day/Holiday) · Time In · Time Out · Work Location/Assignment · Leave Type · Remarks.

**`database/` schema:** Mirrors the above SVMI entities column-for-column in normalized Postgres tables — see `database/docs/02-data-inventory.md` for the authoritative column-level mapping (already produced, not re-derived here).

---

## 5. Schema Audit

| Data store | Has a documented/enforced schema? | Evidence |
|---|---|---|
| SVMI Google Sheet tabs | **Implicit, not enforced** — column order/position is the de facto schema, read by fixed logic in the `.gs` files (e.g. `SVMKPI_CORE.gs`'s `MASTER_LOG` reader). No formal schema file exists for the Sheets themselves. | `database/docs/02-data-inventory.md` independently reverse-engineered this into a documented column inventory "by inspecting `SVMI_Project/Apps Script/*.gs` directly" — i.e. a schema doc exists, but as a *separate* artifact from the Sheet, not enforced by the Sheet itself. |
| `database/migrations/*.sql` | **Yes — proper, versioned schema.** 13 migration files (`000_schema_migrations.sql` … `012_reporting_periods_view.sql`), each with a matching rollback file (`001`–`012`; none for `000`), `JSONB` columns, partial unique indexes, extension setup. | Confirmed by direct file inspection; PostgreSQL-specific, portable across PG 13+. |
| CROSS TRAINED STAFFS MONITORING.xlsx | **No enforced schema** — free-form, two side-by-side per-brand blocks in one sheet, inconsistent capitalization/spacing in names (e.g. "NICA " with trailing space, "ANN" vs "ANN BARREDO"), no header-name consistency guarantee. | Would need the same kind of name-normalization pass the Coaching & Feedback scorecard already does for its own facilitator roster, before this can be reliably parsed. |
| Training Program & Delivery / TDD Team Attendance sheets | **Yes, but unpopulated.** Headers and `LISTS` dropdown-source tabs are properly defined; no data yet to validate against them. | Confirmed via direct read of both sheets' header rows and `LISTS` tabs. |
| TLM `MASTER_LOG` | **Deliberately positional, not named** — `Code.gs`'s own header comment states this is intentional, "to match how the real, live production script… has always worked," because the real sheet's headers are inconsistent. `UNIFORM_LOG`/`UNIFORM_INVENTORY` (tabs TLM fully owns) use header-name lookup instead. | Direct quote from `TLM_Project/Apps Script/Code.gs`. |
| Live-deployed Apps Script manifests (`appsscript.json`) | **Confirmed drift, unresolved cause (D-025).** Every commit to `appsscript.json` on both `main` and `claude/svmi-reports-source-of-truth` sets `executeAs:"USER_ACCESSING"` / `access:"ANYONE"`. Both actually-deployed scripts (production `1QHHyLl8…` and test-copy `1UU582…`) run `executeAs:"USER_DEPLOYING"` / `access:"ANYONE_ANONYMOUS"` instead — confirmed via direct `clasp pull` against both, per `REVIEW-002.md`. **This means the live production Web App may be reachable by anyone with the link, with no Google sign-in required, despite the committed source implying sign-in is mandatory.** No commit or decision record explains how or why this happened. | `SVMI_Project/reviews/REVIEW-002.md`, point 4 ("D-025"). This is the single highest-priority finding in this audit — it's a live access-control gap, not a documentation nit. |
| Branch state | **Two divergent, non-overlapping development lines exist** (`main` and `claude/svmi-reports-source-of-truth`), each holding real work the other lacks, with no reconciliation decision made yet ("Decision A" in `REVIEW-002.md`, explicitly blocking further SVMI planning). | `REVIEW-002.md` in full; branch existence independently confirmed via `list_branches`. |

---

## Summary — highest-priority open items

1. **Security:** confirm and fix the live Apps Script manifest drift (`ANYONE_ANONYMOUS`/`USER_DEPLOYING` in production vs. `ANYONE`/`USER_ACCESSING` in every commit) — this is a live, unexplained access-control gap on production data.
2. **Governance:** "Decision A" — reconcile `main` vs. `claude/svmi-reports-source-of-truth` before further SVMI work proceeds (per `REVIEW-002.md`).
3. **KPI Monitoring Hub data wiring:** Staff Proficiency now has a confirmed real source (`CROSS TRAINED STAFFS MONITORING.xlsx`) but needs name-normalization work before it can be parsed reliably; Store Visit Compliance has real source data (SVMI `MASTER_LOG`/`EXECUTIVE SUMMARY`) not yet connected; Training Program Delivery and Attendance sheets are correctly provisioned but empty — no code work needed until they're filled in.
4. **Unaudited branches:** 8 `claude/*` branches beyond the two above were not reviewed in this pass; `android-parental-monitor-g7f44m` in particular looks unrelated to this project by name and is worth a sanity check.
5. **TLM_Project:** no live deployment confirmed — only a `.clasp.json.example` exists in the repo; its actual production status is `NOT VERIFIED`.
