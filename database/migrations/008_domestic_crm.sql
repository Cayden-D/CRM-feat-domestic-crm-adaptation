BEGIN;

-- 国内业务统一使用人民币，并将客户区域模型调整为省/市/区。
ALTER TABLE tenants ALTER COLUMN default_currency SET DEFAULT 'CNY';
UPDATE tenants SET default_currency='CNY' WHERE default_currency<>'CNY';

ALTER TABLE leads ADD COLUMN province varchar(50);
ALTER TABLE leads ADD COLUMN city varchar(100);
ALTER TABLE leads DROP COLUMN country_code;

ALTER TABLE accounts RENAME COLUMN region TO province;
ALTER TABLE accounts ADD COLUMN district varchar(100);
ALTER TABLE accounts ADD COLUMN address varchar(500);
ALTER TABLE accounts DROP COLUMN country_code;
ALTER TABLE accounts DROP COLUMN compliance_status;
ALTER TABLE accounts DROP COLUMN preferred_language;
ALTER TABLE accounts DROP COLUMN preferred_currency;

ALTER TABLE contacts RENAME COLUMN whatsapp TO wechat;
ALTER TABLE contacts DROP COLUMN timezone;
ALTER TABLE contacts DROP COLUMN language;

UPDATE contacts SET preferred_channel='wechat' WHERE preferred_channel='whatsapp';
UPDATE activities SET activity_type='wechat' WHERE activity_type='whatsapp';
ALTER TABLE activities DROP CONSTRAINT activities_activity_type_check;
ALTER TABLE activities ADD CONSTRAINT activities_activity_type_check
  CHECK (activity_type IN ('note','call','email','meeting','wechat','stage_change','system'));

-- 产品价格仅保留人民币阶梯价和客户分级，不再按币种或海外区域拆分。
UPDATE products SET base_currency='CNY';
ALTER TABLE products ALTER COLUMN base_currency SET DEFAULT 'CNY';

DO $$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid='product_prices'::regclass AND contype='u' LIMIT 1;
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE product_prices DROP CONSTRAINT %I',constraint_name);
  END IF;
END $$;

DROP INDEX IF EXISTS idx_product_prices_lookup;
ALTER TABLE product_prices DROP COLUMN currency;
ALTER TABLE product_prices DROP COLUMN region;
ALTER TABLE product_prices ADD CONSTRAINT product_prices_product_tier_unique
  UNIQUE NULLS NOT DISTINCT (product_id,min_quantity,customer_level);
CREATE INDEX idx_product_prices_lookup ON product_prices
  (product_id,min_quantity DESC,customer_level);

-- 商机、报价、订单及回款金额统一以人民币计价。
UPDATE opportunities SET currency='CNY';
ALTER TABLE opportunities ALTER COLUMN currency SET DEFAULT 'CNY';

UPDATE quotes SET currency='CNY';
ALTER TABLE quotes ALTER COLUMN currency SET DEFAULT 'CNY';
ALTER TABLE quotes DROP COLUMN exchange_rate;
ALTER TABLE quotes DROP COLUMN exchange_rate_date;
ALTER TABLE quotes DROP COLUMN incoterm;
ALTER TABLE quotes DROP COLUMN insurance_cost;
ALTER TABLE quotes DROP COLUMN document_type;

UPDATE orders SET currency='CNY';
ALTER TABLE orders ALTER COLUMN currency SET DEFAULT 'CNY';
ALTER TABLE orders DROP COLUMN incoterm;

UPDATE payments SET currency='CNY';
DROP TABLE exchange_rates;

ALTER TABLE fulfillments DROP COLUMN vessel_or_flight;

COMMENT ON DATABASE ai_crm IS 'AI-powered CRM for domestic sales';

COMMIT;
