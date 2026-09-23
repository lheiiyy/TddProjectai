# CLAUDE.md — Operating Rules for This Repository

This repository (not this conversation) is the project's source of truth.
Read `PROJECT_STATUS.md` first, every session, before doing anything else.

## Orientation

- Three project trees exist here: `SVMI_Project/` (live Apps Script app)
  and `database/` (DEV-only PostgreSQL migration path) are **SVMI**.
  `TLM_Project/` is a **different, unrelated** Apps Script project — do
  not read it for SVMI context, and do not touch it under an SVMI task.
- `PROJECT_MEMORY.md` has the full documentation-authority table and repo
  map. Consult only the document that owns the question you're asking —
  see that table rather than re-deriving facts from `DEPLOY.md`, git log,
  or code from scratch every time.

## Rules

1. **Read `PROJECT_STATUS.md` first.** It states current state, what's
   deferred, and the immediate next task. Do not assume a previous
   conversation's understanding of project state still holds.
2. **Respect `DECISIONS.md`.** Entries marked `Status: Settled` are not
   open questions. Do not reverse one without an explicit new instruction
   from the project owner that acknowledges the reversal.
3. **Do not rely on chat history.** If something isn't in the repository
   (this file's docs, code, tests, or git history), treat it as unknown —
   ask, or investigate the repo, rather than assuming a prior
   conversation's context still applies.
4. **Consult only the relevant document(s)** for the task at hand — the
   authority table in `PROJECT_MEMORY.md` tells you which one. Don't read
   all eight root docs cover-to-cover for a narrow question.
5. **Record meaningful changes.** A completed implementation phase gets an
   `IMPLEMENTATION_LOG.md` entry; a test run whose result should persist
   gets a `TESTING_LOG.md` entry; a durable architectural/business call
   gets a `DECISIONS.md` entry. Don't let new durable facts exist only in
   a chat transcript.
6. **Avoid unrelated modifications.** A documentation task does not touch
   `.gs`/`.html`/schema/production data. An application-code task does not
   rewrite unrelated documentation. Match the change to what was asked.
7. **Follow the project's phase/review workflow.** Implementation work
   proceeds in named phases (see `IMPLEMENTATION_LOG.md` for the pattern);
   a documentation/architecture audit is a review, recorded under
   `reviews/`, not a code change. Don't start a new implementation phase
   as a side effect of a review or documentation task.
8. **Never assume a file is obsolete without checking its actual current
   content** — an older document may still be the authority for its own
   narrow purpose (e.g. `SVMI_Project/DEPLOY.md` for deploy steps) even
   after other parts of it are superseded.

## Full workflow reference

The complete *AI Web App Development Workflow, Version 2.0* this file is
a compact operating guide for is not duplicated here — consult the
project owner's copy of it for anything beyond the rules above.
