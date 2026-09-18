// ============================================================
// SVMKPI_CONFIG.gs
// Store Visit Monitoring KPI — Configuration Data Model + Versioning +
// Audit Foundation (Phase 1A)
// ------------------------------------------------------------
// Contains:
//   1. Schema definitions (CFG_AREA, CFG_ENV_COL, CFG_AREA_SCHEMAS)
//   2. Sheet access helpers (read-only vs. create-if-missing)
//   3. Version read/resolve helpers (the "as of a date" engine)
//   4. Validation
//   5. Mutating service functions (create/activate/deactivate/rollback)
//   6. Audit log
// ------------------------------------------------------------
// PHASE 1A SCOPE — this file is purely additive new infrastructure.
// Nothing in INPUT_PORTAL.gs or the existing SVMKPI_*.gs business logic
// (risk engine, KPI rebuild, reports, Store & Roster Manager, etc.) reads
// from or writes to any CONFIG_* sheet yet — that wiring is later Phase 1
// sub-phases' job. This file's only consumers so far are its own tests.
//
// VERSIONING MODEL (why it's shaped this way):
// Every business-configuration record is a row in one of the CONFIG_*
// sheets below. A "change" is NEVER an in-place edit — it's always a new
// row (a new "version") for the same entity. No row is ever updated after
// creation except its Status column (ACTIVE/INACTIVE, via activate/
// deactivate) — even that preserves every other field untouched and is
// itself audited. This is what makes rollback and historical
// reproducibility possible without a second "history" table: the CONFIG_*
// sheet already IS its own history.
//
// Resolving "what was effective for entity E on date D" (design, chosen
// deliberately over the alternative of having each new version edit the
// PREVIOUS version's Effective To when created — which would itself be an
// in-place destructive edit to a "closed" historical row, exactly what
// this model is trying to avoid): among all ACTIVE versions for E where
// EffectiveFrom <= D and (EffectiveTo is blank OR D <= EffectiveTo), pick
// the one with the latest EffectiveFrom (ties broken by highest version
// number). An open-ended version (no EffectiveTo) answers for every date
// from its EffectiveFrom onward UNTIL a later version's EffectiveFrom
// makes IT the new answer for those later dates — nothing is ever written
// back to the earlier row to make that happen; it falls out of the
// resolution rule itself. EffectiveTo only needs to be set explicitly for
// a version that's deliberately meant to stop applying before anything
// else replaces it (a genuinely time-boxed rule).
//
// NOT A JSON-BLOB CONFIG TABLE: each CONFIG_* sheet has its own typed,
// named columns for its domain fields (Store Name/Brand/Region/Category
// for CONFIG_STORES, thresholds/weights for CONFIG_RISK, etc.) — never a
// single generic "key/value" or "data blob" column. This keeps the model
// portable to a future relational (e.g. PostgreSQL) schema: each sheet
// maps to one table, each column to one typed column. The one place a
// compact serialized snapshot is used is CONFIG_AUDIT's Previous/New
// Value columns — those exist purely for human-readable audit display,
// not as the source of truth for any configuration, which is exactly the
// pattern real relational audit-log tables use (a diff snapshot in the
// log, typed columns in the live table).
//
// IDENTITY: as of Phase 1B, CONFIG_STORES' Entity ID is the immutable
// Store ID (minted and enforced by SVMKPI_STORE_CONFIG.gs) — no longer
// name-based. CONFIG_VISITORS/CONFIG_PURPOSES still key their Entity ID
// by normalized NAME (interim — immutable Visitor/Purpose IDs are a
// later migration, out of scope here), the same interim-identity
// decision already made and disclosed for Phase 0.5's duplicate-visit
// check (see DEPLOY.md) — nothing regresses there, identity is already
// name-based everywhere else those still touch.
// ============================================================


// ═══════════════════════════════════════════════════════════════
// SECTION 1: SCHEMA DEFINITIONS
// ═══════════════════════════════════════════════════════════════

// Shared versioning envelope — identical column positions (A–I) across
// every CONFIG_* sheet. Domain-specific fields for an area start at
// column J (index CFG_ENV_WIDTH + 1).
const CFG_ENV_COL = {
  VERSION_ID:      1, // A — e.g. "STORES-ALPHA-v3"
  ENTITY_ID:       2, // B — normalized name (interim identity) or a fixed
                      //     singleton key like 'DEFAULT' for global areas
  VERSION_NUM:     3, // C — 1-based, per entity
  EFFECTIVE_FROM:  4, // D
  EFFECTIVE_TO:    5, // E — blank = open-ended
  STATUS:          6, // F — ACTIVE | INACTIVE
  CREATED_AT:      7, // G
  CREATED_BY:      8, // H
  REASON:          9, // I
};
const CFG_ENV_WIDTH = 9;

const CFG_STATUS = { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE' };

const CFG_ACTION = {
  CREATE:     'CREATE',
  ACTIVATE:   'ACTIVATE',
  DEACTIVATE: 'DEACTIVATE',
  ROLLBACK:   'ROLLBACK',
};

const CFG_AREA = {
  STORES:     'STORES',
  VISITORS:   'VISITORS',
  PURPOSES:   'PURPOSES',
  RISK:       'RISK',
  COMPLIANCE: 'COMPLIANCE',
  KPI:        'KPI',
  SYSTEM:     'SYSTEM',
};

// A fixed Entity ID for areas that (today) hold ONE global rule set
// rather than one row per business object — matches the current app's
// actual architecture (e.g. SVMKPI_RISK.gs's thresholds/weights are one
// global constant set, not per-store).
const CFG_SINGLETON_ENTITY = 'DEFAULT';

// Per-area sheet name + domain-specific field list (each field appears as
// its own typed column, in this order, right after the shared envelope).
// `required` lists the field keys cfg_validateConfiguration() treats as
// mandatory for that area.
const CFG_AREA_SCHEMAS = {
  STORES: {
    sheetName: 'CONFIG_STORES',
    // Phase 1B: Entity ID is now the immutable Store ID (SVMKPI_STORE_CONFIG.gs
    // mints and enforces it) — no longer the interim normalized-name
    // placeholder Phase 1A used. Store Name is a plain attribute below,
    // free to change without affecting identity.
    //
    // `status` here is a DOMAIN field — the store's own operational
    // ACTIVE/INACTIVE state, effective-dated like Category — and is a
    // completely different thing from this row's ENVELOPE Status column
    // (CFG_ENV_COL.STATUS, whether this *version* counts during
    // resolution at all). A store can have an envelope Status of ACTIVE
    // (this version is real and in force) while its domain `status` field
    // says INACTIVE (the store itself is operationally closed as of this
    // version). Not required — defaults to ACTIVE via
    // SVMKPI_STORE_CONFIG.gs's store_create()/store_update() when omitted,
    // so this stays backward-compatible with Phase 1A's existing tests
    // and fixtures, which never set it.
    fields: [
      { key: 'storeName', header: 'Store Name' },
      { key: 'brand',     header: 'Brand' },
      { key: 'region',    header: 'Region' },
      { key: 'category',  header: 'Category' }, // effective-dated — a
        // Category change is a normal new version, same as any other field
      { key: 'status',    header: 'Store Status' }, // operational ACTIVE|INACTIVE — see note above
    ],
    required: ['storeName', 'brand', 'region', 'category'],
  },

  VISITORS: {
    sheetName: 'CONFIG_VISITORS',
    // Entity ID = normalized Visitor Name (interim — a real Visitor ID
    // isn't assumed to be the name; this is just today's stand-in).
    fields: [
      { key: 'visitorName', header: 'Visitor Name' },
    ],
    required: ['visitorName'],
  },

  PURPOSES: {
    sheetName: 'CONFIG_PURPOSES',
    // Entity ID = normalized Purpose Name (interim, unchanged from Phase 1A).
    //
    // Phase 1D: `riskWeight` is the deliberate, per-purpose risk-scoring
    // input SVMKPI_RISK_CONFIG.gs's risk_resolvePurposeWeight() consumes.
    // Optional and NOT required — a purpose can exist with no riskWeight
    // at all (see purpose_getConfigurationStatus(), SVMKPI_PURPOSE_CONFIG.gs:
    // "hasRiskConfig" is false in that case). Deliberately NOT
    // auto-populated for a new purpose — no automatic inheritance from
    // any other purpose's weight, per the Phase 1D business decision.
    // The 4 pre-existing purposes (STORE VISIT/FAILED QA/MS/CURING-
    // SUPPORT/TLTC) don't need a CONFIG_PURPOSES row with this field set
    // at all: their weights keep resolving from CONFIG_RISK's existing
    // named fields (backward-compatible legacy fallback — see
    // risk_resolvePurposeWeight()), so no migration was required.
    fields: [
      { key: 'purposeName', header: 'Purpose Name' },
      { key: 'riskWeight',  header: 'Risk Weight (deliberate, no inheritance)' },
    ],
    required: ['purposeName'],
  },

  RISK: {
    sheetName: 'CONFIG_RISK',
    // Singleton area (Entity ID = CFG_SINGLETON_ENTITY) — mirrors
    // SVMKPI_RISK.gs's current global constants (_sl_riskTier()'s 10/5
    // cutoffs, RISK_PURPOSE_SCORE's weights) as a starting schema. Phase
    // 1D is what actually makes the risk engine READ this; Phase 1A only
    // proves the versioning envelope can hold these values correctly.
    fields: [
      { key: 'lowThreshold',        header: 'Low Threshold' },
      { key: 'mediumThreshold',     header: 'Medium Threshold' },
      { key: 'highThreshold',       header: 'High Threshold' },
      { key: 'weightFailedQaMs',    header: 'Purpose Weight: Failed QA/MS' },
      { key: 'weightStoreVisit',    header: 'Purpose Weight: Store Visit' },
      { key: 'weightCuringSupport', header: 'Purpose Weight: Curing/Support' },
      { key: 'weightTltc',          header: 'Purpose Weight: TLTC' },
    ],
    required: ['lowThreshold', 'mediumThreshold', 'highThreshold'],
  },

  COMPLIANCE: {
    sheetName: 'CONFIG_COMPLIANCE',
    // Entity ID = normalized Category (e.g. 'NCR', 'FAR PROVINCIAL') —
    // compliance cadence is genuinely per-category in the current app
    // (SVMKPI_RISK.gs's RISK_CADENCE / _sl_getCadenceDays()), unlike RISK
    // above which is one global rule set. `periodDefinition` is a
    // deliberate placeholder: the master plan flagged "does a calendar
    // period mean current-period-to-date, previous-period, or something
    // else" as a genuine business ambiguity requiring a STOP-and-report
    // rather than an invented answer — Phase 1A defines the COLUMN so
    // Phase 1D has somewhere to put the decision once it's made; it does
    // not populate or interpret it.
    fields: [
      { key: 'cadenceType',      header: 'Cadence Type' },       // MONTHLY | QUARTERLY | SEMI_ANNUAL
      { key: 'cadenceDays',      header: 'Cadence Days' },       // numeric — the ROLLING-day threshold
        // SVMKPI_RISK.gs's canonical risk score still uses (its own
        // existing algorithm, unchanged — see SVMKPI_RISK_CONFIG.gs)
      // Phase 1D: no longer an unused placeholder — populated by
      // SVMKPI_COMPLIANCE_CONFIG.gs's cmp_create()/cmp_update() from
      // cadenceType via _cal_familyFromCadenceType() (SVMKPI_CALENDAR.gs),
      // so it's always derived/consistent with cadenceType rather than an
      // independently-editable field that could drift out of sync. This
      // is the CALENDAR-period family (MONTH|QUARTER|SEMI_ANNUAL) the new
      // period-to-date compliance evaluator (sl_getComplianceGaps()) uses
      // via resolveCalendarPeriod() — a genuinely different model from
      // cadenceDays' rolling-day threshold above.
      { key: 'periodDefinition', header: 'Period Definition (calendar-period family)' },
      { key: 'requiredCount',    header: 'Required Visits Per Period' }, // Phase 1D — e.g.
        // "1 visit per period" vs "2 visits per period" (see DEPLOY.md's
        // historical-example test). Optional; defaults to 1 (the
        // existing "at least one visit" behavior) when blank, so
        // pre-Phase-1D fixtures/rows that never set this are unaffected.
      { key: 'graceDays',        header: 'Grace Period Days' },
    ],
    required: ['cadenceType', 'cadenceDays'],
  },

  KPI: {
    sheetName: 'CONFIG_KPI',
    // DOCUMENTED GAP (Phase 1D, per its own "no business-rule invention"
    // constraint): no KPI target/weight business rule exists anywhere in
    // the current app — buildKPI2026()/getKPI2026Report() (SVMKPI_KPI_
    // REBUILD.gs/SVMKPI_REPORTS.gs) are a pure visit-count tracker with
    // NO weighting, scoring, or target-comparison logic to plug a
    // "weight" or "target" value into (reconfirmed here; the same gap
    // Phase 1A's own comment already flagged). Phase 1D therefore builds
    // ONLY the configuration STORAGE/validation/effective-dated-
    // resolution layer (SVMKPI_KPI_CONFIG.gs) as infrastructure for a
    // future KPI-scoring feature — it does NOT invent what a "KPI
    // weight" or "KPI target" means, and does NOT wire either value into
    // any live calculation. See DEPLOY.md's Phase 1D section and the
    // completion report's "unresolved business-rule gaps" item.
    //
    // `targetType` lets a target be represented with its own type instead
    // of an arbitrary string — a minimal closed set covering plausible
    // future needs (NUMERIC a plain count/number, PERCENTAGE a 0-100
    // rate, COUNT an integer tally), not a fabricated business meaning
    // for any specific KPI, since none exist yet to observe a real type
    // from. Optional; when blank, `targetValue` is stored as an
    // untyped/opaque value (unchanged from Phase 1A).
    fields: [
      { key: 'kpiName',     header: 'KPI Name' },
      { key: 'targetValue', header: 'Target Value' },
      { key: 'targetType',  header: 'Target Type (NUMERIC | PERCENTAGE | COUNT)' },
      { key: 'weight',      header: 'Weight' },
      { key: 'purposeRef',  header: 'Purpose Reference' },
    ],
    required: ['kpiName'],
  },

  SYSTEM: {
    sheetName: 'CONFIG_SYSTEM',
    // Deliberately left with no populated rows in Phase 1A. Per the
    // business/technical split already documented (DEPLOY.md, Phase 0
    // verification report): almost everything that looked like a "system
    // setting" candidate either isn't genuinely business-configurable
    // (MASTER_LOG_MAX_ROW, lock timeouts — developer-controlled, stay as
    // code constants) or already lives in SETTINGS (admin emails, guest
    // password) and moving those now would be an unrequested, out-of-
    // scope migration. This schema exists so a genuinely new business
    // system setting has somewhere principled to go later, without
    // becoming a generic arbitrary key/value editor: `settingKey` is a
    // fixed, code-known identifier (not free-form admin text), same
    // discipline as every other area's typed fields.
    fields: [
      { key: 'settingKey',   header: 'Setting Key' },
      { key: 'settingValue', header: 'Setting Value' },
      { key: 'settingLabel', header: 'Setting Label (business-readable)' },
    ],
    required: ['settingKey', 'settingValue'],
  },
};

const CFG_AUDIT_SHEET = 'CONFIG_AUDIT';
const CFG_AUDIT_COL = {
  AUDIT_ID:        1, // A
  TIMESTAMP:       2, // B
  ACTOR:           3, // C
  AREA:            4, // D
  ENTITY_ID:       5, // E
  ACTION:          6, // F
  PREVIOUS_VALUE:  7, // G
  NEW_VALUE:       8, // H
  EFFECTIVE_FROM:  9, // I
  EFFECTIVE_TO:   10, // J
  REASON:         11, // K
  VERSION:        12, // L
};


// ═══════════════════════════════════════════════════════════════
// SECTION 2: SHEET ACCESS
// Reads never create a sheet as a side effect (missing sheet = no
// configuration exists yet, not an error). Only mutations create one.
// ═══════════════════════════════════════════════════════════════

function _cfg_getSheetIfExists(area) {
  const schema = CFG_AREA_SCHEMAS[area];
  if (!schema) return null;
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(schema.sheetName);
}

function _cfg_ensureSheet(area) {
  const schema = CFG_AREA_SCHEMAS[area];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(schema.sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(schema.sheetName);
    const headers = ['Version ID', 'Entity ID', 'Version #', 'Effective From', 'Effective To', 'Status', 'Created At', 'Created By', 'Reason']
      .concat(schema.fields.map(f => f.header));
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  }
  return sheet;
}

function _cfg_ensureAuditSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CFG_AUDIT_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(CFG_AUDIT_SHEET);
    const headers = ['Audit ID', 'Timestamp', 'Actor', 'Area', 'Entity ID', 'Action', 'Previous Value', 'New Value', 'Effective From', 'Effective To', 'Reason', 'Version'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  }
  return sheet;
}

function _cfg_today() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}


// ═══════════════════════════════════════════════════════════════
// SECTION 3: VERSION READ / RESOLVE
// ═══════════════════════════════════════════════════════════════

/**
 * _cfg_readVersions(sheet, schema, entityId)
 * @param {string|null} entityId - normalized; null/undefined reads every
 *   entity in the area (used for admin listing screens later)
 * @returns {object[]} parsed version records, unsorted
 */
function _cfg_readVersions(sheet, schema, entityId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const width = CFG_ENV_WIDTH + schema.fields.length;
  const raw = sheet.getRange(2, 1, lastRow - 1, width).getValues();
  const out = [];
  raw.forEach(row => {
    const rEntity = String(row[CFG_ENV_COL.ENTITY_ID - 1] || '').trim().toUpperCase();
    if (!rEntity) return;
    if (entityId != null && rEntity !== entityId) return;

    const fields = {};
    schema.fields.forEach((f, i) => { fields[f.key] = row[CFG_ENV_WIDTH + i]; });

    out.push({
      versionId:     String(row[CFG_ENV_COL.VERSION_ID - 1] || ''),
      entityId:      rEntity,
      versionNum:    Number(row[CFG_ENV_COL.VERSION_NUM - 1]) || 0,
      effectiveFrom: _parseDateCell(row[CFG_ENV_COL.EFFECTIVE_FROM - 1]),
      effectiveTo:   _parseDateCell(row[CFG_ENV_COL.EFFECTIVE_TO - 1]), // null if blank/unparseable
      status:        String(row[CFG_ENV_COL.STATUS - 1] || '').trim().toUpperCase(),
      createdAt:     row[CFG_ENV_COL.CREATED_AT - 1],
      createdBy:     String(row[CFG_ENV_COL.CREATED_BY - 1] || ''),
      reason:        String(row[CFG_ENV_COL.REASON - 1] || ''),
      fields,
    });
  });
  return out;
}

function _cfg_nextVersionNumber(existingVersions) {
  let max = 0;
  existingVersions.forEach(v => { if (v.versionNum > max) max = v.versionNum; });
  return max + 1;
}

function _cfg_latestVersion(existingVersions) {
  if (!existingVersions.length) return null;
  return existingVersions.slice().sort((a, b) => b.versionNum - a.versionNum)[0];
}

/**
 * _cfg_resolveAsOf(versions, asOfDate)
 * The historical-resolution engine — see file header for the design
 * rationale. Only considers ACTIVE versions; an INACTIVE one is treated
 * as if it doesn't exist for resolution purposes (deactivate ≠ delete —
 * it's still visible via cfg_getConfiguration()'s full history, just not
 * eligible to be "the" answer for any date).
 * @returns {object|null}
 */
function _cfg_resolveAsOf(versions, asOfDate) {
  const candidates = versions.filter(v => {
    if (v.status !== CFG_STATUS.ACTIVE) return false;
    if (!v.effectiveFrom || v.effectiveFrom.getTime() > asOfDate.getTime()) return false;
    if (v.effectiveTo && v.effectiveTo.getTime() < asOfDate.getTime()) return false;
    return true;
  });
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const diff = b.effectiveFrom.getTime() - a.effectiveFrom.getTime();
    return diff !== 0 ? diff : b.versionNum - a.versionNum;
  });
  return candidates[0];
}

/**
 * cfg_resolveConfigurationAsOf(area, entityId, dateStr)
 * Public, read-only. Returns the single configuration version that was
 * (or is, or will be) effective for the given entity on the given date,
 * or null if none exists. Centralizes what would otherwise be duplicated
 * date/version resolution logic across every future consumer.
 * @returns {{versionId, entityId, versionNum, effectiveFrom, effectiveTo, status, fields}|null}
 */
function cfg_resolveConfigurationAsOf(area, entityId, dateStr) {
  const schema = CFG_AREA_SCHEMAS[area];
  if (!schema) return null;
  const asOf = dateStr ? _parseDateCell(dateStr) : _cfg_today();
  if (!asOf) return null;

  const entity = String(entityId || '').trim().toUpperCase();
  const sheet = _cfg_getSheetIfExists(area);
  if (!sheet) return null;

  const versions = _cfg_readVersions(sheet, schema, entity);
  const resolved = _cfg_resolveAsOf(versions, asOf);
  if (!resolved) return null;

  return {
    versionId: resolved.versionId, entityId: resolved.entityId, versionNum: resolved.versionNum,
    effectiveFrom: resolved.effectiveFrom, effectiveTo: resolved.effectiveTo,
    status: resolved.status, fields: resolved.fields,
  };
}

/**
 * cfg_getConfiguration(area, entityId)
 * Public, read-only. Returns EVERY version for an entity (or every
 * entity in the area if entityId is omitted) — the full history, not
 * just what's currently effective. For admin listing/audit-review UIs
 * (built in a later phase); cfg_resolveConfigurationAsOf() is what
 * business logic should call to get "the" answer for a date.
 * @returns {object[]}
 */
function cfg_getConfiguration(area, entityId) {
  const schema = CFG_AREA_SCHEMAS[area];
  if (!schema) return [];
  const sheet = _cfg_getSheetIfExists(area);
  if (!sheet) return [];
  const entity = entityId != null ? String(entityId).trim().toUpperCase() : null;
  return _cfg_readVersions(sheet, schema, entity);
}


// ═══════════════════════════════════════════════════════════════
// SECTION 4: VALIDATION
// ═══════════════════════════════════════════════════════════════

/**
 * cfg_validateConfiguration(area, entityId, fields, effectiveFrom, effectiveTo, existingVersions)
 * Pure validation — no sheet access, no side effects. Reusable by both
 * cfg_createConfiguration() and (indirectly, via its own checks)
 * cfg_rollbackConfiguration().
 * @param {Date|null} effectiveFrom - already parsed
 * @param {Date|null} effectiveTo - already parsed, or null
 * @param {object[]} existingVersions - this entity's current versions,
 *   from _cfg_readVersions(), for overlap/duplicate checks
 * @returns {{valid: boolean, errors: string[]}}
 */
function cfg_validateConfiguration(area, entityId, fields, effectiveFrom, effectiveTo, existingVersions) {
  const errors = [];
  const schema = CFG_AREA_SCHEMAS[area];
  if (!schema) return { valid: false, errors: ['Unknown configuration area: ' + area] };

  if (!entityId) errors.push('Entity ID cannot be blank.');
  if (!effectiveFrom) errors.push('Effective From is required and must be a valid date.');
  if (effectiveFrom && effectiveTo && effectiveTo.getTime() < effectiveFrom.getTime()) {
    errors.push('Effective To cannot be before Effective From.');
  }

  (schema.required || []).forEach(key => {
    const v = fields ? fields[key] : undefined;
    if (v == null || String(v).trim() === '') {
      const field = schema.fields.filter(f => f.key === key)[0];
      errors.push('Missing required field: ' + (field ? field.header : key));
    }
  });

  (existingVersions || []).forEach(v => {
    if (!effectiveFrom || !v.effectiveFrom) return;
    if (v.effectiveFrom.getTime() === effectiveFrom.getTime()) {
      errors.push('A version with this exact Effective From date already exists for this entity (version ' + v.versionNum + ').');
    }
    // Only two EXPLICITLY-bounded windows can truly "overlap" in a way
    // that's ambiguous — an open-ended new version is always safe: it
    // simply becomes the new answer from its Effective From onward (see
    // _cfg_resolveAsOf), never conflicting with an earlier version.
    if (effectiveTo && v.effectiveTo) {
      const overlaps = effectiveFrom.getTime() <= v.effectiveTo.getTime() && effectiveTo.getTime() >= v.effectiveFrom.getTime();
      if (overlaps) errors.push('Effective period overlaps an existing version (version ' + v.versionNum + ') for this entity.');
    }
  });

  if (area === CFG_AREA.RISK) {
    const low = Number(fields && fields.lowThreshold), med = Number(fields && fields.mediumThreshold), high = Number(fields && fields.highThreshold);
    if (!isNaN(low) && !isNaN(med) && !(low < med)) errors.push('Low Threshold must be less than Medium Threshold.');
    if (!isNaN(med) && !isNaN(high) && !(med < high)) errors.push('Medium Threshold must be less than High Threshold.');
    ['lowThreshold', 'mediumThreshold', 'highThreshold', 'weightFailedQaMs', 'weightStoreVisit', 'weightCuringSupport', 'weightTltc'].forEach(k => {
      const v = fields && fields[k];
      if (v != null && v !== '' && Number(v) < 0 && (k === 'lowThreshold' || k === 'mediumThreshold' || k === 'highThreshold')) {
        errors.push('Risk thresholds cannot be negative.');
      }
    });
  }

  if (area === CFG_AREA.COMPLIANCE) {
    const validCadenceTypes = ['MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL'];
    const cadenceType = fields && String(fields.cadenceType || '').trim().toUpperCase();
    if (cadenceType && validCadenceTypes.indexOf(cadenceType) === -1) {
      errors.push('Cadence Type must be one of: ' + validCadenceTypes.join(', ') + '.');
    }
    const days = Number(fields && fields.cadenceDays);
    if (fields && fields.cadenceDays != null && fields.cadenceDays !== '' && (isNaN(days) || days <= 0)) {
      errors.push('Cadence Days must be a positive number.');
    }
    // Phase 1D
    if (fields && fields.requiredCount != null && fields.requiredCount !== '') {
      const rc = Number(fields.requiredCount);
      if (isNaN(rc) || rc <= 0 || Math.floor(rc) !== rc) {
        errors.push('Required Visits Per Period must be a positive whole number.');
      }
    }
    if (fields && fields.periodDefinition) {
      const fam = String(fields.periodDefinition).trim().toUpperCase();
      if (CAL_PERIOD_FAMILIES.indexOf(fam) === -1) {
        errors.push('Period Definition must be one of: ' + CAL_PERIOD_FAMILIES.join(', ') + '.');
      }
    }
  }

  // Phase 1D
  if (area === CFG_AREA.PURPOSES) {
    if (fields && fields.riskWeight != null && fields.riskWeight !== '' && isNaN(Number(fields.riskWeight))) {
      errors.push('Risk Weight must be numeric.');
    }
  }

  if (area === CFG_AREA.KPI) {
    if (fields && fields.weight != null && fields.weight !== '' && isNaN(Number(fields.weight))) {
      errors.push('Weight must be numeric.');
    }
    if (fields && fields.targetType) {
      const validTargetTypes = ['NUMERIC', 'PERCENTAGE', 'COUNT'];
      const tt = String(fields.targetType).trim().toUpperCase();
      if (validTargetTypes.indexOf(tt) === -1) {
        errors.push('Target Type must be one of: ' + validTargetTypes.join(', ') + '.');
      }
      if ((tt === 'NUMERIC' || tt === 'PERCENTAGE' || tt === 'COUNT') &&
          fields.targetValue != null && fields.targetValue !== '' && isNaN(Number(fields.targetValue))) {
        errors.push('Target Value must be numeric for Target Type ' + tt + '.');
      }
      if (tt === 'PERCENTAGE' && fields.targetValue != null && fields.targetValue !== '') {
        const pv = Number(fields.targetValue);
        if (!isNaN(pv) && (pv < 0 || pv > 100)) {
          errors.push('Target Value must be between 0 and 100 for Target Type PERCENTAGE.');
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}


// ═══════════════════════════════════════════════════════════════
// SECTION 5: MUTATIONS — every one admin-gated server-side, first line
// ═══════════════════════════════════════════════════════════════

function _cfg_buildRow(schema, envelope, fields) {
  const row = [
    envelope.versionId,
    envelope.entityId,
    envelope.versionNum,
    envelope.effectiveFrom,
    envelope.effectiveTo || '',
    envelope.status,
    envelope.createdAt,
    envelope.createdBy,
    envelope.reason || '',
  ];
  schema.fields.forEach(f => {
    row.push(fields && fields[f.key] != null ? fields[f.key] : '');
  });
  return row;
}

function _cfg_summarize(schema, versionOrFieldsWrapper) {
  const fields = (versionOrFieldsWrapper && versionOrFieldsWrapper.fields) || {};
  return schema.fields.map(f => {
    const v = fields[f.key];
    return f.key + '=' + (v == null || v === '' ? '—' : v);
  }).join('; ');
}

/**
 * cfg_createConfiguration(area, entityId, fields, effectiveFromStr, effectiveToStr, reason, options)
 * Creates a new VERSION for an entity. Never edits or removes a prior
 * version. Admin-gated.
 *
 * Backdating: if effectiveFromStr resolves to a date before today, the
 * caller must pass options.backdateConfirmed === true AND a non-empty
 * reason, or the mutation is rejected with requiresBackdateConfirmation:
 * true — this is what "never silently backdate" means in practice: the
 * system will never apply a past-dated version to history unless a human
 * explicitly acknowledged that's what they're doing and said why.
 *
 * @param {string} area - CFG_AREA value
 * @param {string} entityId - business entity (or CFG_SINGLETON_ENTITY)
 * @param {object} fields - domain field values, keyed per the area's schema
 * @param {string} effectiveFromStr - 'YYYY-MM-DD'
 * @param {string} [effectiveToStr] - 'YYYY-MM-DD', omit for open-ended
 * @param {string} [reason]
 * @param {{backdateConfirmed?: boolean}} [options]
 * @returns {{success:boolean, message?:string, versionId?:string, version?:number, requiresBackdateConfirmation?:boolean}}
 */
function cfg_createConfiguration(area, entityId, fields, effectiveFromStr, effectiveToStr, reason, options) {
  try {
    if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };

    const schema = CFG_AREA_SCHEMAS[area];
    if (!schema) return { success: false, message: 'Unknown configuration area: ' + area };

    const entity = String(entityId || '').trim().toUpperCase();
    const effectiveFrom = effectiveFromStr ? _parseDateCell(effectiveFromStr) : null;
    const effectiveTo = effectiveToStr ? _parseDateCell(effectiveToStr) : null;
    if (effectiveToStr && !effectiveTo) return { success: false, message: 'Invalid Effective To date.' };

    const sheet = _cfg_ensureSheet(area);
    const existingVersions = _cfg_readVersions(sheet, schema, entity);

    const validation = cfg_validateConfiguration(area, entity, fields, effectiveFrom, effectiveTo, existingVersions);
    if (!validation.valid) {
      return { success: false, message: validation.errors.join(' ') };
    }

    const today = _cfg_today();
    const isBackdated = effectiveFrom.getTime() < today.getTime();
    if (isBackdated) {
      if (!options || !options.backdateConfirmed) {
        return {
          success: false,
          requiresBackdateConfirmation: true,
          message: 'Effective From (' + effectiveFromStr + ') is in the past. Backdated changes require explicit confirmation and a reason.',
        };
      }
      if (!reason || !String(reason).trim()) {
        return { success: false, message: 'A reason is required for a backdated configuration change.' };
      }
    }

    const versionNum = _cfg_nextVersionNumber(existingVersions);
    const versionId = area + '-' + entity + '-v' + versionNum;
    const now = new Date();
    const actor = sl_getCurrentUser();

    const previousActive = _cfg_resolveAsOf(existingVersions, today) || _cfg_latestVersion(existingVersions);

    const row = _cfg_buildRow(schema, {
      versionId, entityId: entity, versionNum,
      effectiveFrom, effectiveTo, status: CFG_STATUS.ACTIVE,
      createdAt: now, createdBy: actor, reason: reason || '',
    }, fields);

    sheet.appendRow(row);
    SpreadsheetApp.flush();

    _cfg_writeAudit(area, entity, CFG_ACTION.CREATE,
      previousActive ? _cfg_summarize(schema, previousActive) : '(none)',
      _cfg_summarize(schema, { fields }),
      effectiveFrom, effectiveTo, reason || '', versionNum, actor);

    return { success: true, versionId, version: versionNum };
  } catch (e) {
    logError('cfg_createConfiguration', e);
    return { success: false, message: e.message };
  }
}

function _cfg_setStatus(area, versionId, newStatus, reason) {
  try {
    if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
    const schema = CFG_AREA_SCHEMAS[area];
    if (!schema) return { success: false, message: 'Unknown configuration area: ' + area };
    if (newStatus !== CFG_STATUS.ACTIVE && newStatus !== CFG_STATUS.INACTIVE) {
      return { success: false, message: 'Invalid status: ' + newStatus };
    }

    const sheet = _cfg_ensureSheet(area);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, message: 'Version not found: ' + versionId };

    const width = CFG_ENV_WIDTH + schema.fields.length;
    const raw = sheet.getRange(2, 1, lastRow - 1, width).getValues();
    for (let i = 0; i < raw.length; i++) {
      if (String(raw[i][CFG_ENV_COL.VERSION_ID - 1]) === versionId) {
        const rowNum = i + 2;
        const prevStatus = String(raw[i][CFG_ENV_COL.STATUS - 1] || '');
        sheet.getRange(rowNum, CFG_ENV_COL.STATUS).setValue(newStatus);
        SpreadsheetApp.flush();

        const entity = String(raw[i][CFG_ENV_COL.ENTITY_ID - 1] || '');
        const versionNum = Number(raw[i][CFG_ENV_COL.VERSION_NUM - 1]) || 0;
        const effFrom = _parseDateCell(raw[i][CFG_ENV_COL.EFFECTIVE_FROM - 1]);
        const effTo = _parseDateCell(raw[i][CFG_ENV_COL.EFFECTIVE_TO - 1]);
        const action = newStatus === CFG_STATUS.ACTIVE ? CFG_ACTION.ACTIVATE : CFG_ACTION.DEACTIVATE;
        _cfg_writeAudit(area, entity, action, 'status=' + prevStatus, 'status=' + newStatus, effFrom, effTo, reason || '', versionNum, sl_getCurrentUser());

        return { success: true, versionId, status: newStatus };
      }
    }
    return { success: false, message: 'Version not found: ' + versionId };
  } catch (e) {
    logError('_cfg_setStatus', e);
    return { success: false, message: e.message };
  }
}

/** cfg_activateConfiguration(area, versionId, reason) — admin-gated. */
function cfg_activateConfiguration(area, versionId, reason) {
  return _cfg_setStatus(area, versionId, CFG_STATUS.ACTIVE, reason);
}

/** cfg_deactivateConfiguration(area, versionId, reason) — admin-gated. */
function cfg_deactivateConfiguration(area, versionId, reason) {
  return _cfg_setStatus(area, versionId, CFG_STATUS.INACTIVE, reason);
}

/**
 * cfg_rollbackConfiguration(area, entityId, targetVersionId, reason, effectiveFromStr, options)
 * Rollback is itself a new version, never a deletion or an edit to any
 * prior row. "Roll back to version 1" with a current version 3 creates
 * version 4, copying version 1's field values — versions 1–3 remain
 * exactly as they were, fully queryable. Admin-gated; reason is always
 * required (unlike cfg_createConfiguration(), where it's only mandatory
 * when backdated) since a rollback's "why" is inherently worth recording
 * every time. Subject to the same backdate-confirmation rule as create.
 * @returns {{success:boolean, message?:string, versionId?:string, version?:number, restoredFrom?:string, requiresBackdateConfirmation?:boolean}}
 */
function cfg_rollbackConfiguration(area, entityId, targetVersionId, reason, effectiveFromStr, options) {
  try {
    if (!sl_isAdmin()) return { success: false, message: 'Admin access required.' };
    const schema = CFG_AREA_SCHEMAS[area];
    if (!schema) return { success: false, message: 'Unknown configuration area: ' + area };

    if (!reason || !String(reason).trim()) {
      return { success: false, message: 'A reason is required for a rollback.' };
    }

    const entity = String(entityId || '').trim().toUpperCase();
    const sheet = _cfg_ensureSheet(area);
    const existingVersions = _cfg_readVersions(sheet, schema, entity);
    const target = existingVersions.filter(v => v.versionId === targetVersionId)[0];
    if (!target) return { success: false, message: 'Target version not found: ' + targetVersionId };

    const effectiveFrom = effectiveFromStr ? _parseDateCell(effectiveFromStr) : _cfg_today();
    if (!effectiveFrom) return { success: false, message: 'Invalid Effective From date.' };

    const today = _cfg_today();
    const isBackdated = effectiveFrom.getTime() < today.getTime();
    if (isBackdated && (!options || !options.backdateConfirmed)) {
      return {
        success: false,
        requiresBackdateConfirmation: true,
        message: 'This rollback would be backdated to ' + effectiveFromStr + '. Backdated changes require explicit confirmation.',
      };
    }

    const versionNum = _cfg_nextVersionNumber(existingVersions);
    const versionId = area + '-' + entity + '-v' + versionNum;
    const now = new Date();
    const actor = sl_getCurrentUser();
    const previousActive = _cfg_resolveAsOf(existingVersions, today) || _cfg_latestVersion(existingVersions);
    // Recorded on BOTH the new version row's own Reason column and the
    // audit entry, so an auditor reading CONFIG_AUDIT alone (without
    // cross-referencing the version row) can still see which version was
    // restored, not just the original human-supplied reason text.
    const fullReason = 'Rollback to ' + targetVersionId + ': ' + reason;

    const row = _cfg_buildRow(schema, {
      versionId, entityId: entity, versionNum,
      effectiveFrom, effectiveTo: null, status: CFG_STATUS.ACTIVE,
      createdAt: now, createdBy: actor,
      reason: fullReason,
    }, target.fields);

    sheet.appendRow(row);
    SpreadsheetApp.flush();

    _cfg_writeAudit(area, entity, CFG_ACTION.ROLLBACK,
      previousActive ? _cfg_summarize(schema, previousActive) : '(none)',
      _cfg_summarize(schema, target),
      effectiveFrom, null, fullReason, versionNum, actor);

    return { success: true, versionId, version: versionNum, restoredFrom: targetVersionId };
  } catch (e) {
    logError('cfg_rollbackConfiguration', e);
    return { success: false, message: e.message };
  }
}


// ═══════════════════════════════════════════════════════════════
// SECTION 6: AUDIT LOG — append-only; only ever called after a mutation
// has fully succeeded (never on a validation failure or rejected change)
// ═══════════════════════════════════════════════════════════════

function _cfg_writeAudit(area, entityId, action, previousValue, newValue, effectiveFrom, effectiveTo, reason, version, actor) {
  const sheet = _cfg_ensureAuditSheet();
  const auditId = area + '-' + entityId + '-' + action + '-' + new Date().getTime();
  sheet.appendRow([
    auditId,
    new Date(),
    actor,
    area,
    entityId,
    action,
    previousValue,
    newValue,
    effectiveFrom || '',
    effectiveTo || '',
    reason || '',
    version,
  ]);
  SpreadsheetApp.flush();
}

/**
 * cfg_getAuditLog(area, entityId)
 * Public, read-only. Returns every audit entry, optionally filtered to
 * one area and/or entity. For a future audit-viewer UI.
 * @returns {object[]}
 */
function cfg_getAuditLog(area, entityId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CFG_AUDIT_SHEET);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const raw = sheet.getRange(2, 1, lastRow - 1, 12).getValues();
  const entity = entityId != null ? String(entityId).trim().toUpperCase() : null;
  const out = [];
  raw.forEach(row => {
    const rArea = String(row[CFG_AUDIT_COL.AREA - 1] || '');
    const rEntity = String(row[CFG_AUDIT_COL.ENTITY_ID - 1] || '').toUpperCase();
    if (area && rArea !== area) return;
    if (entity != null && rEntity !== entity) return;
    out.push({
      auditId: row[CFG_AUDIT_COL.AUDIT_ID - 1],
      timestamp: row[CFG_AUDIT_COL.TIMESTAMP - 1],
      actor: row[CFG_AUDIT_COL.ACTOR - 1],
      area: rArea,
      entityId: rEntity,
      action: row[CFG_AUDIT_COL.ACTION - 1],
      previousValue: row[CFG_AUDIT_COL.PREVIOUS_VALUE - 1],
      newValue: row[CFG_AUDIT_COL.NEW_VALUE - 1],
      effectiveFrom: row[CFG_AUDIT_COL.EFFECTIVE_FROM - 1],
      effectiveTo: row[CFG_AUDIT_COL.EFFECTIVE_TO - 1],
      reason: row[CFG_AUDIT_COL.REASON - 1],
      version: row[CFG_AUDIT_COL.VERSION - 1],
    });
  });
  return out;
}
