BEGIN;

CREATE TABLE integration_1688_collection_queue_settings (
  connection_id uuid PRIMARY KEY REFERENCES integration_1688_connections(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_1688_collection_queue_one_target
  ON integration_1688_collection_queue_settings(tenant_id) WHERE enabled;

CREATE TABLE integration_1688_collection_queue_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES integration_1688_connections(id) ON DELETE CASCADE,
  collected_product_id uuid NOT NULL REFERENCES collected_products(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  source_updated_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','blocked','failed','published','unknown','cancelled')),
  phase text NOT NULL DEFAULT 'screening' CHECK (phase IN ('screening','materializing','publishing')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  worker_id uuid,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  draft_id uuid REFERENCES integration_1688_publish_drafts(id) ON DELETE SET NULL,
  message text,
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(collected_product_id)
);
CREATE INDEX idx_1688_collection_queue_claim
  ON integration_1688_collection_queue_jobs(status,available_at,created_at) WHERE status IN ('queued','processing');
CREATE INDEX idx_1688_collection_queue_tenant
  ON integration_1688_collection_queue_jobs(tenant_id,created_at DESC);

CREATE FUNCTION enqueue_1688_collected_product() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source <> '1688' OR NEW.product_id IS NOT NULL THEN RETURN NEW; END IF;
  INSERT INTO integration_1688_collection_queue_jobs(tenant_id,connection_id,collected_product_id,actor_id,source_updated_at)
  SELECT NEW.tenant_id,q.connection_id,NEW.id,NEW.collected_by,NEW.updated_at
  FROM integration_1688_collection_queue_settings q
  JOIN integration_1688_agent_settings a ON a.connection_id=q.connection_id AND a.enabled
  JOIN integration_1688_connections c ON c.id=q.connection_id AND c.status='connected'
  WHERE q.tenant_id=NEW.tenant_id AND q.enabled
  ON CONFLICT(collected_product_id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_enqueue_1688_collected_product
  AFTER INSERT OR UPDATE OF source_url,title,main_image_url,gallery_images,detail_images,attributes,source_category_id,source_category_attributes,price_min,price_max
  ON collected_products FOR EACH ROW EXECUTE FUNCTION enqueue_1688_collected_product();

COMMIT;
