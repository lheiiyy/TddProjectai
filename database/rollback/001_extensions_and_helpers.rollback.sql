DROP FUNCTION IF EXISTS svmi_check_effective_range(date, date);
-- pgcrypto is left installed intentionally (other extensions/tools in a
-- shared DEV database may depend on it); dropping an extension is a
-- cluster-wide concern, not something an app-schema rollback should do.
