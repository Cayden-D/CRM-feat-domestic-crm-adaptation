BEGIN;
CREATE UNIQUE INDEX idx_1688_listing_product_unique ON integration_1688_listings(connection_id,product_id) WHERE product_id IS NOT NULL;
CREATE UNIQUE INDEX idx_1688_draft_product_unique ON integration_1688_publish_drafts(connection_id,product_id);
COMMIT;
