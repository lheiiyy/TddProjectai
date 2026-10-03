---
name: web-app-project-planning
description: Plan any new web app or internal tool from idea to build-ready spec - users, modules, data model, architecture, phases, risks, GitHub setup - for Google Sheets/Apps Script or full-stack.
---

# Web App Project Planning

Use this when Leo wants to plan a new web app, internal tool, portal or system (not just one TDMS module - for that use `tdms-module-planning`). Works for a Google Sheets + Apps Script build, a full-stack build, or a "Sheets now, migrate later" build.

Reply in Taglish. Write the plan itself in plain, formal English with no AI-sounding phrasing, because it may be shown to management.

## Step 1 - Gather context first (before asking anything)

1. Check memory for an existing project with the same subject; if one exists, extend it instead of starting over.
2. Look for existing material: Google Drive sheets and forms, GitHub repos (`lheiiyy/*`), earlier plan docs. Read the real column headers and a few sample rows of every sheet the new app would replace.
3. Write down what the current tools get wrong: names used as keys, several values in one cell, mixed date formats, monthly or status tabs, duplicate copies of the same list, manual summaries.

## Step 2 - Ask only what changes the design (max 4 questions)

Use AskUserQuestion. Good questions decide scope or data, for example:
- Who uses it, and who approves what?
- Which existing sheet or process does it replace first?
- Budget and hosting: Sheets/Apps Script only, or is a paid host possible?
- What one report or screen does management want most?

Skip anything already answered by memory, the files or the request.

## Step 3 - Write the plan (one Docs artifact)

Create the doc skeleton first, then fill one section per call. Sections:

1. **Project description** - one-paragraph summary, background, problem (bullets, from Step 1), objectives (numbered, measurable), scope table (in v1 / out of v1), users.
2. **Current tools and lessons** - table: file, what it tracks, main issue, what to keep. Then the lessons to apply.
3. **Roles and access** - table: role x (main use, create/edit, approve, view scope). Include an Admin role and say which area is restricted.
4. **Modules and workflows** - module table (id, name, replaces, key records, output). A numbered status flow for each module that has an approval or lifecycle.
5. **Architecture** - layer table (screens, API client, services, data access): now vs after migration, and what must stay the same. Design rules for the database. Platform limits.
6. **Data model** - tables grouped by module: name, ID prefix, key columns, links to.
7. **Roadmap** - drawn as a diagram: phases, rough weeks, the gate that ends each phase. Build the core data first, then the module people use most.
8. **Source control** - repo and folder, branches, deploy path, where secrets live.
9. **Migration plan** - numbered steps to move to a full-stack app.
10. **Risks, decisions needed, next steps** - risk table with mitigation, a checklist of open decisions, the next three actions.

## Default architecture rules (use unless Leo says otherwise)

- Four layers: UI -> `api.js` client -> services (business rules) -> repository (data access). Only the repository touches `SpreadsheetApp` or the database. Migration then means rewriting the repository and the transport in `api.js`, nothing else.
- Data spreadsheet and code project are separate. Data tabs hold no formulas, merged cells, colours or summary blocks.
- One tab = one table, snake_case headers, primary key column `id` with a code-generated prefixed ID (e.g. `EMP-000123`).
- Links use IDs, never names. One value per cell; lists go to a child table.
- Dates `yyyy-mm-dd`, timestamps ISO 8601 UTC, percentages as numbers.
- Fixed choices come from a `lookups` table and appear as dropdowns.
- Audit columns on every table: `created_at`, `created_by`, `updated_at`, `updated_by`, `is_active`, `row_version`. Soft delete only. Every change is written to `audit_log`.
- Role checks happen on the server for every call; hiding a button is not security.
- Writes use LockService and one batch write. Reads are paged (about 50 rows); lookups are cached; dashboards read a summary table refreshed by a trigger.
- Large logs are archived yearly before they pass about 50,000 rows.
- Full-stack target when budget comes: PostgreSQL, a Node.js REST API with the same function names, React or Svelte front end, file storage for uploads.

## GitHub setup (default)

- Code lives in GitHub; the repo is the master copy, pushed to Apps Script with clasp.
- `main` = live, work happens on a feature branch, changes merge through pull requests.
- Never commit `.clasprc.json`, passwords, tokens or private sheet IDs; use Script Properties.
- Put a `README.md` (what it is, how to deploy) and a `CLAUDE.md` (rules for Claude Code) in the project folder. Specs go in `specs/`.
- Keep a dated live backup before each risky deploy.

## Step 4 - Self-check before handing over

- [ ] Every section answers Leo's actual request; no filler sections.
- [ ] Facts about current tools come from files actually read, with links.
- [ ] Data model follows the rules above; no names used as keys.
- [ ] Roadmap phases each end with a clear gate (usually: old sheet set to read-only).
- [ ] Open decisions are listed as questions, not assumed.
- [ ] Estimates are labelled as estimates.

## Step 5 - After approval

Offer to (a) write the first module spec, (b) scaffold the project folder in GitHub on a branch and open a PR, or (c) produce a build prompt for Claude Code. Do not build or deploy before Leo approves the plan.
