BEGIN;

CREATE TABLE product_collector_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL DEFAULT '1688 商品采集助手',
  key_prefix varchar(24) NOT NULL,
  key_hash char(64) NOT NULL UNIQUE,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE collected_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source varchar(20) NOT NULL CHECK (source IN ('1688','alibaba')),
  source_product_id varchar(200) NOT NULL,
  source_url varchar(2000) NOT NULL,
  title varchar(500) NOT NULL,
  main_image_url varchar(2000),
  gallery_images jsonb NOT NULL DEFAULT '[]'::jsonb,
  detail_images jsonb NOT NULL DEFAULT '[]'::jsonb,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  collector_mode varchar(100),
  collector_version varchar(30),
  processing_status varchar(30) NOT NULL DEFAULT 'collected'
    CHECK (processing_status IN ('collected','ai_processing','ai_completed','ready','published','failed')),
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  collected_by uuid REFERENCES users(id) ON DELETE SET NULL,
  collected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,source,source_product_id)
);

CREATE TABLE collected_product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  collected_product_id uuid NOT NULL REFERENCES collected_products(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  external_sku_id varchar(200),
  label varchar(500) NOT NULL,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  image_url varchar(2000),
  price_text varchar(200),
  price numeric(18,4) CHECK (price IS NULL OR price >= 0),
  stock_text varchar(200),
  stock numeric(18,4) CHECK (stock IS NULL OR stock >= 0),
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collected_product_id,position)
);

CREATE INDEX idx_collector_keys_active_hash ON product_collector_keys(key_hash) WHERE revoked_at IS NULL;
CREATE INDEX idx_collected_products_tenant_time ON collected_products(tenant_id,collected_at DESC);
CREATE INDEX idx_collected_products_status ON collected_products(tenant_id,processing_status,collected_at DESC);
CREATE INDEX idx_collected_variants_product ON collected_product_variants(collected_product_id,position);

UPDATE roles SET permissions=permissions||'["collection:read","collection:create","collection:delete"]'::jsonb
WHERE code IN ('sales_manager','sales_rep') AND NOT permissions ? 'collection:read';
UPDATE roles SET permissions=permissions||'["collection:read"]'::jsonb
WHERE code IN ('order_specialist','executive') AND NOT permissions ? 'collection:read';

COMMENT ON TABLE collected_products IS '1688/Alibaba 原始采集商品，供后续 AI 清洗与官方接口发布使用';
COMMENT ON COLUMN collected_products.raw_data IS '采集器上传的原始商品级数据，禁止在 AI 处理前覆盖丢失';

COMMIT;
