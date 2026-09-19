-- 003_stores.sql
-- Mirrors Phase 1B's Store identity model exactly: Store ID is the
-- immutable identity (spreadsheet format: 'STR-' || Utilities.getUuid());
-- Store Name/Brand/Region/Category/operational Status are effective-dated
-- ATTRIBUTES, versioned in a child table, never the identity itself.
-- See SVMKPI_STORE_CONFIG.gs (store_create/store_update/resolveStoreAsOf)
-- and CFG_AREA_SCHEMAS.STORES (SVMKPI_CONFIG.gs).

CREATE TABLE stores (
  store_id              text PRIMARY KEY, -- natural key: 'STR-<uuid>', minted once, NEVER reassigned
  created_at            timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE stores IS 'The immutable Store ID anchor only. Every attribute (including Store Name) is effective-dated in store_versions — Store Name is a display label, never the key.';

CREATE TABLE store_versions (
  version_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id              text NOT NULL REFERENCES stores(store_id) ON DELETE RESTRICT,
  version_num           integer NOT NULL CHECK (version_num > 0),
  store_name            text NOT NULL,
  brand                 text NOT NULL,
  region                text NOT NULL,
  category              text NOT NULL,
  -- Domain operational status (Phase 1B) — distinct from envelope_status
  -- below. A store can be envelope_status='ACTIVE' (this version is the
  -- one in force) while status='INACTIVE' (the store itself is closed).
  status                text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  effective_from        date NOT NULL,
  effective_to          date,
  envelope_status       text NOT NULL DEFAULT 'ACTIVE' CHECK (envelope_status IN ('ACTIVE', 'INACTIVE')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES users(user_id),
  reason                text,
  CONSTRAINT chk_store_effective_range CHECK (svmi_check_effective_range(effective_from, effective_to)),
  UNIQUE (store_id, version_num),
  UNIQUE (store_id, effective_from) -- mirrors cfg_createConfiguration()'s "no two versions share an Effective From" rule
);
COMMENT ON TABLE store_versions IS 'Effective-dated Store attributes. Never edited or deleted after creation — a correction always appends a new version_num. Historical immutability: resolving a past date must always return the row that was true then, unchanged forever.';

CREATE INDEX idx_store_versions_store_id ON store_versions (store_id);
CREATE INDEX idx_store_versions_effective_from ON store_versions (store_id, effective_from);

-- Mirrors CONFIG_UNMAPPED_STORES (SVMKPI_STORE_CONFIG.gs) — a historical
-- MASTER_LOG store-name reference that could not be exact-matched to a
-- Store ID during migration. Never guessed/discarded; reconciled
-- explicitly and auditably, never rewriting the original historical
-- reference.
CREATE TABLE unmapped_store_references (
  unmapped_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_store_name   text NOT NULL,
  occurrence_count      integer NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  first_seen            date,
  last_seen             date,
  status                text NOT NULL DEFAULT 'UNMAPPED' CHECK (status IN ('UNMAPPED', 'RECONCILED')),
  resolved_store_id     text REFERENCES stores(store_id),
  detected_at           timestamptz NOT NULL DEFAULT now(),
  reconciled_at         timestamptz,
  reconciled_by         uuid REFERENCES users(user_id),
  notes                 text,
  CONSTRAINT chk_unmapped_resolution CHECK (
    (status = 'UNMAPPED' AND resolved_store_id IS NULL)
    OR (status = 'RECONCILED' AND resolved_store_id IS NOT NULL)
  )
);
COMMENT ON TABLE unmapped_store_references IS 'Historical store-name references from source data that could not be exact-matched to a Store ID. Reconciliation records who/what/why without rewriting any historical store_visits row.';
