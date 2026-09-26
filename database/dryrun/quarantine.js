// database/dryrun/quarantine.js
//
// Shared quarantine collector for Database Phase 2 (Real-Data Migration
// Dry Run). Any record the pipeline cannot safely migrate is recorded
// here — NEVER silently dropped and NEVER given an invented replacement
// value just to make the import pass (the phase's own explicit rule).
//
// Every entry captures exactly what the phase's completion report needs:
// source sheet, source row/reference, problem type, original value,
// explanation, and a proposed resolution CATEGORY (never a proposed
// invented value).

const RESOLUTION_CATEGORY = Object.freeze({
  NEEDS_HUMAN_RECONCILIATION: 'NEEDS_HUMAN_RECONCILIATION', // e.g. unmapped Store ID
  NEEDS_SOURCE_CORRECTION: 'NEEDS_SOURCE_CORRECTION',       // e.g. malformed date in the sheet itself
  NEEDS_CONFIGURATION: 'NEEDS_CONFIGURATION',               // e.g. a Purpose with no CONFIG_PURPOSES entry, deliberately not auto-created
  NEEDS_SCHEMA_DECISION: 'NEEDS_SCHEMA_DECISION',           // e.g. an envelope_status value the schema doesn't accept
  ACCEPTABLE_AS_LEGACY_GAP: 'ACCEPTABLE_AS_LEGACY_GAP',     // e.g. a pre-Store-ID-migration row — expected, not a defect
});

class QuarantineCollector {
  constructor() {
    this.entries = [];
  }

  add({ sourceSheet, sourceRowRef, problemType, originalValue, explanation, proposedResolutionCategory }) {
    if (!Object.values(RESOLUTION_CATEGORY).includes(proposedResolutionCategory)) {
      throw new Error(`Invalid proposedResolutionCategory: ${proposedResolutionCategory}`);
    }
    this.entries.push({
      sourceSheet,
      sourceRowRef,
      problemType,
      originalValue,
      explanation,
      proposedResolutionCategory,
    });
  }

  byProblemType() {
    const counts = {};
    for (const e of this.entries) {
      counts[e.problemType] = (counts[e.problemType] || 0) + 1;
    }
    return counts;
  }

  toArtifact(runId) {
    return {
      runId,
      generatedAt: new Date().toISOString(),
      totalQuarantined: this.entries.length,
      byProblemType: this.byProblemType(),
      entries: this.entries,
    };
  }
}

module.exports = { QuarantineCollector, RESOLUTION_CATEGORY };
