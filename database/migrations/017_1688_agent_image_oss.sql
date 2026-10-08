BEGIN;
ALTER TABLE integration_1688_agent_images
  ADD COLUMN oss_key text,
  ADD COLUMN persisted_at timestamptz;
CREATE UNIQUE INDEX idx_1688_agent_images_oss_key
  ON integration_1688_agent_images(oss_key) WHERE oss_key IS NOT NULL;
COMMIT;
