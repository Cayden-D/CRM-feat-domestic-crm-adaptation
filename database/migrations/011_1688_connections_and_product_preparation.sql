BEGIN;

CREATE TABLE integration_1688_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  app_key text NOT NULL,
  ali_id text NOT NULL,
  member_id text,
  login_id text,
  display_name text NOT NULL,
  token_ciphertext text NOT NULL,
  access_expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz,
  status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','reauthorize','disabled')),
  member_capability text NOT NULL DEFAULT 'unknown' CHECK (member_capability IN ('unknown','available','unavailable')),
  last_tested_at timestamptz,
  last_refreshed_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_key,ali_id)
);

CREATE TABLE integration_1688_oauth_states (
  state_hash text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_key text NOT NULL,
  redirect_uri text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE integration_1688_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES integration_1688_connections(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  api_name text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('success','failed')),
  error_code text,
  duration_ms integer NOT NULL DEFAULT 0,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_1688_connections_tenant ON integration_1688_connections(tenant_id,created_at DESC);
CREATE INDEX idx_1688_operations_tenant ON integration_1688_operations(tenant_id,created_at DESC);
CREATE INDEX idx_1688_states_expiry ON integration_1688_oauth_states(expires_at);

ALTER TABLE products ADD COLUMN images jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN detail_images jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN video_url text;

CREATE TABLE product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  source_variant_id uuid REFERENCES collected_product_variants(id) ON DELETE SET NULL,
  position integer NOT NULL CHECK (position >= 0),
  label text NOT NULL,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  image_url text,
  unit_price numeric(18,4) NOT NULL CHECK (unit_price >= 0),
  stock numeric(18,4) CHECK (stock >= 0),
  UNIQUE (product_id,position)
);
CREATE INDEX idx_product_variants_product ON product_variants(tenant_id,product_id);

UPDATE roles SET permissions=permissions||'["integration:read","integration:manage"]'::jsonb
WHERE code='sales_manager' AND NOT permissions ? 'integration:manage';
UPDATE roles SET permissions=permissions||'["integration:read"]'::jsonb
WHERE code IN ('executive','order_specialist') AND NOT permissions ? 'integration:read';

COMMENT ON COLUMN integration_1688_connections.token_ciphertext IS 'AES-256-GCM encrypted OAuth tokens; never returned through API';
COMMENT ON TABLE product_variants IS 'Reviewed CRM product variants; independent from mutable collection snapshots';

COMMIT;
