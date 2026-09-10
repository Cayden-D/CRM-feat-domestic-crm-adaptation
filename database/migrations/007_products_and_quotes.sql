BEGIN;

CREATE TABLE product_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  currency char(3) NOT NULL,
  min_quantity numeric(18,4) NOT NULL DEFAULT 1 CHECK (min_quantity > 0),
  unit_price numeric(18,4) NOT NULL CHECK (unit_price >= 0),
  region varchar(80),
  customer_level char(1) CHECK (customer_level IN ('A','B','C','D')),
  valid_from date,
  valid_until date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from),
  UNIQUE NULLS NOT DISTINCT (product_id,currency,min_quantity,region,customer_level)
);

ALTER TABLE quotes ADD COLUMN document_type varchar(10) NOT NULL DEFAULT 'quote'
  CHECK (document_type IN ('quote','pi'));
ALTER TABLE quotes ADD COLUMN deleted_at timestamptz;

CREATE INDEX idx_product_prices_lookup ON product_prices
  (product_id,currency,min_quantity DESC,region,customer_level);
CREATE INDEX idx_products_tenant_status_category ON products
  (tenant_id,status,category,name) WHERE deleted_at IS NULL;
CREATE INDEX idx_quotes_tenant_owner_status ON quotes
  (tenant_id,owner_id,status,created_at DESC) WHERE deleted_at IS NULL;

UPDATE roles SET permissions=permissions||'["product:*","quote:*"]'::jsonb
WHERE code='sales_manager' AND NOT permissions ? 'product:*';
UPDATE roles SET permissions=permissions||'["product:read","quote:create","quote:update","quote:delete"]'::jsonb
WHERE code='sales_rep' AND NOT permissions ? 'product:read';
UPDATE roles SET permissions=permissions||'["product:read"]'::jsonb
WHERE code='order_specialist' AND NOT permissions ? 'product:read';

COMMIT;
