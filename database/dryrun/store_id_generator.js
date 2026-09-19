// database/dryrun/store_id_generator.js
//
// Phase 2A rule #7 — deterministic Store ID proposal.
//
// PROPOSED ONLY — NOT WRITTEN TO PRODUCTION. This module never touches
// the live spreadsheet or any database; it only computes what a Store ID
// WOULD be, deterministically, from a canonical identity key, so the same
// (Store Name, Brand) identity always proposes the same ID no matter how
// many times this is run, in this dry run or a future one.
//
// Mechanism: RFC 4122 UUID v5 (name-based, SHA-1), keyed off a single
// fixed namespace UUID that must never change once adopted. This
// deliberately avoids Math.random()/crypto.randomUUID() (rule: "Do NOT
// generate a fresh random UUID on every dry run") — v5 is a pure
// function of (namespace, name): identical input always produces the
// identical UUID, and different input is collision-resistant.
//
// Format matches the existing application convention: `STR-<uuid>`.

const crypto = require('crypto');

// Fixed forever once adopted for real Store ID proposals. Changing this
// constant would silently reassign every previously-proposed Store ID —
// treat it exactly like a production secret/constant, never rotate it.
const SVMI_STORE_NAMESPACE_UUID = '9b1f2b0a-6b39-5b7e-8a2b-2f6a0d6e2c11';

function parseUuidToBytes(uuid) {
  const hex = uuid.replace(/-/g, '');
  const bytes = Buffer.alloc(16);
  for (let i = 0; i < 16; i += 1) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function bytesToUuid(bytes) {
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
    hex.slice(16, 20), hex.slice(20, 32),
  ].join('-');
}

/**
 * Pure RFC 4122 v5 UUID derivation. No randomness — same (namespaceUuid,
 * name) always yields the same UUID.
 */
function uuidV5(name, namespaceUuid) {
  const namespaceBytes = parseUuidToBytes(namespaceUuid);
  const nameBytes = Buffer.from(String(name), 'utf8');
  const hash = crypto.createHash('sha1').update(Buffer.concat([namespaceBytes, nameBytes])).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  return bytesToUuid(bytes);
}

/**
 * Derives the proposed Store ID for a canonical identity key (as produced
 * by store_canonical_identity.js's compositeKey — normalized "NAME|BRAND").
 * Deterministic: calling this twice with the same key, in the same
 * process or a fresh one, always returns the same STR-<uuid>.
 */
function deriveProposedStoreId(canonicalKey) {
  return `STR-${uuidV5(canonicalKey, SVMI_STORE_NAMESPACE_UUID)}`;
}

/**
 * Builds a canonicalKey -> proposedStoreId map for a whole identity list,
 * and asserts (defensively) that no two distinct keys collided onto the
 * same proposed ID and that no key produced more than one ID across the
 * pass — both would indicate a generator bug, never a real ambiguity to
 * paper over.
 */
function buildProposedStoreIdMap(canonicalKeys) {
  const map = new Map();
  const seenIds = new Map();
  for (const key of canonicalKeys) {
    const id = deriveProposedStoreId(key);
    if (map.has(key) && map.get(key) !== id) {
      throw new Error(`Non-deterministic Store ID generation for key "${key}"`);
    }
    if (seenIds.has(id) && seenIds.get(id) !== key) {
      throw new Error(`Store ID collision between "${seenIds.get(id)}" and "${key}"`);
    }
    map.set(key, id);
    seenIds.set(id, key);
  }
  return map;
}

module.exports = {
  SVMI_STORE_NAMESPACE_UUID,
  uuidV5,
  deriveProposedStoreId,
  buildProposedStoreIdMap,
};
