# TDMS - Training and Development Management System

One web app for the Training Department (Training and Development Division, HRAD) of Figaro Culinary Group, covering Angel's Pizza, Angel's Pizza Express, Tien Ma's, Koobideh Kebab and Figaro Coffee.

**Status:** planning. No code yet. Build starts after the plan is approved.

**Master plan:** https://claude.ai/code/artifact/f89076cb-9986-4a8a-abe2-f0eb70d83dab

## What it replaces

| Module | Replaces |
| --- | --- |
| M0 Core master data | CONFIG tabs in TOIS PMS, SETTINGS tabs |
| M1 Trainee orientation | Manual lists |
| M2 Training programs and sessions | Training Program & Delivery Monitoring 2026 |
| M3 Team Leader program | [sys] Team leader Monitoring (`TLM_Project/`) |
| M4 Proficiency and cross-training | TOIS PMS, Cross Trained Staffs Monitoring |
| M5 Store visits | SVMI (`SVMI_Project/`) |
| M6 CAPAR | CAPAR Rectification Monitoring |
| M7 Dashboards and reports | Summary tabs, manual reports |
| M8 Resource library (SOPs, manuals, memos, FAQs, forms, exams) | Scattered Drive folders and chat files |
| M9 KPI monitoring (restricted) | KPI Monitoring Hub (`lheiiyy/KPI-MONITORING-HUB`) |

## How it is built

Google Sheets is the database for now; the app is an Apps Script web app. It is built in four layers so the move to a full-stack app (PostgreSQL + REST API) only replaces the bottom layer:

```
screens (HTML/JS)  ->  api.js  ->  services (*.gs, business rules)  ->  repository (only file that touches Sheets)
                                                                        later: PostgreSQL, extending database/migrations/
```

Planned layout (created when Phase 0 starts):

```
TDMS_Project/
  README.md        this file
  CLAUDE.md        rules for Claude Code sessions
  specs/           one spec per module (M0-core.md, M5-store-visits.md, ...)
  apps-script/     .gs services, repository, api, appsscript.json, .clasp.json (test copy)
  web/             screens, api.js, styles
  tests/           service and repository tests
  docs/            user guides per module
```

## Planning skills

Two Claude Code skills live in `.claude/skills/` at the repo root:

- `tdms-module-planning` - write the spec for one TDMS module.
- `web-app-project-planning` - plan any new web app from scratch.

## Rules that never change

- Never write to a live legacy sheet. Imports read from copies.
- Never commit `.clasprc.json`, passwords, tokens or private sheet IDs.
- Changes reach `main` through pull requests.
