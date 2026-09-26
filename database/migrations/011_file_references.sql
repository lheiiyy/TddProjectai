-- 011_file_references.sql
-- Provider-independent file/attachment reference table. The CURRENT
-- spreadsheet-backed system has NO file/attachment handling anywhere
-- (confirmed by repository inspection: no DriveApp/getBlob/upload code
-- exists in any Apps Script file) — there is nothing to migrate into
-- this table. It is included because the target architecture explicitly
-- requires a storage-provider-independent design ready for when file
-- attachments (e.g. a photo on a store visit) are actually built —
-- never hardcoding the schema around Google Drive specifically, even
-- though Drive is the first deployment target for the actual bytes.

CREATE TABLE file_references (
  file_id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type            text NOT NULL, -- e.g. 'STORE_VISIT' — whatever entity a file is eventually attached to
  entity_id              text NOT NULL,
  storage_provider        text NOT NULL, -- 'google_drive' today; the column, not the schema shape, carries the provider
  storage_key             text NOT NULL, -- provider-specific handle (e.g. a Drive file ID) — opaque to this schema
  original_filename        text NOT NULL,
  content_type             text,
  size_bytes               bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  checksum                 text, -- e.g. sha256, for integrity verification independent of the storage provider
  uploaded_by              uuid REFERENCES users(user_id),
  uploaded_at              timestamptz NOT NULL DEFAULT now(),
  status                   text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DELETED')),
  UNIQUE (storage_provider, storage_key)
);
COMMENT ON TABLE file_references IS 'Provider-independent — no column here assumes Google Drive specifically beyond the storage_provider VALUE. Moving to a different provider later changes rows, never this schema. Zero rows exist to migrate from the spreadsheet system today; this table has no corresponding entry in docs/03-migration-mapping.md for that reason.';

CREATE INDEX idx_file_references_entity ON file_references (entity_type, entity_id);
CREATE INDEX idx_file_references_uploaded_by ON file_references (uploaded_by);
