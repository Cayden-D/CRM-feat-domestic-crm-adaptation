BEGIN;
ALTER TABLE integration_1688_listings
  ADD COLUMN binding_revision integer NOT NULL DEFAULT 1 CHECK (binding_revision > 0),
  ADD COLUMN sku_bindings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sku_bindings)='array');
COMMENT ON COLUMN integration_1688_listings.sku_bindings IS 'Manually confirmed platform specId to CRM product_variant UUID mappings; no automatic writeback';
COMMIT;
