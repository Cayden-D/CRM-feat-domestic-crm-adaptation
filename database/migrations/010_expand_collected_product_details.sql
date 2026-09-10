BEGIN;

ALTER TABLE collected_products ADD COLUMN video_url varchar(2000);
ALTER TABLE collected_products ADD COLUMN description_url varchar(2000);
ALTER TABLE collected_products ADD COLUMN currency varchar(10) NOT NULL DEFAULT 'CNY';
ALTER TABLE collected_products ADD COLUMN price_min numeric(18,4) CHECK (price_min IS NULL OR price_min >= 0);
ALTER TABLE collected_products ADD COLUMN price_max numeric(18,4) CHECK (price_max IS NULL OR price_max >= 0);
ALTER TABLE collected_products ADD COLUMN sku_props jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE collected_products ADD COLUMN seller_name varchar(500);
ALTER TABLE collected_products ADD COLUMN seller_id varchar(200);
ALTER TABLE collected_products ADD COLUMN category_path varchar(1000);
ALTER TABLE collected_products ADD COLUMN source_category_id varchar(200);
ALTER TABLE collected_products ADD COLUMN source_category_attributes jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE collected_products ADD COLUMN tags jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE collected_products ADD COLUMN collector_note text;
ALTER TABLE collected_products ADD COLUMN source_collected_at timestamptz;
ALTER TABLE collected_products ADD CONSTRAINT collected_products_price_range_check
  CHECK (price_max IS NULL OR price_min IS NULL OR price_max >= price_min);

COMMENT ON COLUMN collected_products.sku_props IS '来源商品的 SKU 维度和值定义';
COMMENT ON COLUMN collected_products.source_category_attributes IS '来源平台类目属性原始结构，供 AI 清洗和发布映射使用';

COMMIT;
