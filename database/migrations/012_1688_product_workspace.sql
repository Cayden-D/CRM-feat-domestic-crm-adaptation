BEGIN;
CREATE TABLE integration_1688_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES integration_1688_connections(id) ON DELETE CASCADE,
  offer_id text NOT NULL,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  title text NOT NULL,
  status text NOT NULL,
  image_url text,
  snapshot jsonb NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(connection_id,offer_id)
);
CREATE TABLE integration_1688_publish_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES integration_1688_connections(id),
  product_id uuid NOT NULL REFERENCES products(id),
  cat_id text NOT NULL,
  scene text NOT NULL CHECK(scene IN ('cbu','popular','industry','processing')),
  platform_schema jsonb NOT NULL,
  data_body jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitting','published','failed','unknown')),
  offer_id text,
  last_error_code text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_1688_listings_tenant ON integration_1688_listings(tenant_id,connection_id,synced_at DESC);
CREATE INDEX idx_1688_drafts_tenant ON integration_1688_publish_drafts(tenant_id,updated_at DESC);
UPDATE roles SET permissions=permissions||'["integration:publish"]'::jsonb WHERE code='sales_manager' AND NOT permissions ? 'integration:publish';
COMMIT;
