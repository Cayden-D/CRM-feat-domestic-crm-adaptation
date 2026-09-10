BEGIN;

UPDATE roles
SET permissions = '["dashboard:read","lead:own","lead:create","lead:update","lead:delete","account:own","opportunity:own","quote:own","order:read"]'::jsonb
WHERE code = 'sales_rep';

COMMENT ON COLUMN roles.permissions IS '权限代码数组；resource:* 表示租户内全量权限，resource:own 与具体动作组合表示仅本人数据。';

COMMIT;
