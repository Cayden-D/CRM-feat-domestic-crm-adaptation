BEGIN;
ALTER TABLE integration_1688_listings ADD COLUMN deletion_state text NOT NULL DEFAULT 'active' CHECK (deletion_state IN ('active','deleting','deleted','unknown'));
COMMENT ON COLUMN integration_1688_listings.deletion_state IS 'Remote recycle-bin operation state; unknown/deleting require manual reconciliation, never automatic retry';
COMMIT;
