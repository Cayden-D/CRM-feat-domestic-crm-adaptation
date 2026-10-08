BEGIN;

CREATE OR REPLACE FUNCTION enqueue_1688_collected_product() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_connection uuid;
BEGIN
  IF NEW.source <> '1688' OR NEW.product_id IS NOT NULL THEN RETURN NEW; END IF;

  SELECT q.connection_id INTO target_connection
  FROM integration_1688_collection_queue_settings q
  JOIN integration_1688_agent_settings a ON a.connection_id=q.connection_id AND a.enabled
  JOIN integration_1688_connections c ON c.id=q.connection_id AND c.status='connected'
  WHERE q.tenant_id=NEW.tenant_id AND q.enabled
  LIMIT 1;
  IF target_connection IS NULL THEN RETURN NEW; END IF;

  INSERT INTO integration_1688_collection_queue_jobs(tenant_id,connection_id,collected_product_id,actor_id,source_updated_at)
  VALUES(NEW.tenant_id,target_connection,NEW.id,NEW.collected_by,NEW.updated_at)
  ON CONFLICT(collected_product_id) DO NOTHING;

  IF TG_OP='UPDATE'
     AND OLD.source_category_id IS DISTINCT FROM NEW.source_category_id
     AND NEW.source_category_id ~ '^[1-9][0-9]{0,19}$' THEN
    UPDATE integration_1688_collection_queue_jobs
    SET connection_id=target_connection,actor_id=NEW.collected_by,source_updated_at=NEW.updated_at,
        status='queued',phase='screening',attempts=0,available_at=now(),
        worker_id=NULL,lease_until=NULL,message=NULL,report='{}'::jsonb,updated_at=now()
    WHERE collected_product_id=NEW.id AND tenant_id=NEW.tenant_id
      AND status IN ('blocked','failed','cancelled')
      AND product_id IS NULL AND draft_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
