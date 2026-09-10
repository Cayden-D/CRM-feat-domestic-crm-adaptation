import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../server/db.js';
const input = z.object({
    CRM_ADMIN_EMAIL: z.string().email().default('admin@local.crm'),
    CRM_ADMIN_PASSWORD: z.string().min(12),
    CRM_ADMIN_NAME: z.string().min(1).default('系统管理员'),
    CRM_TENANT_SLUG: z.string().default('default'),
}).parse(process.env);
try {
    const passwordHash = await bcrypt.hash(input.CRM_ADMIN_PASSWORD, 12);
    const result = await db.query(`
    INSERT INTO users (tenant_id, email, password_hash, display_name, status)
    SELECT id, $1, $2, $3, 'active' FROM tenants WHERE slug = $4
    ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = excluded.password_hash,
      display_name = excluded.display_name, status = 'active', deleted_at = NULL
    RETURNING id
  `, [input.CRM_ADMIN_EMAIL.toLowerCase(), passwordHash, input.CRM_ADMIN_NAME, input.CRM_TENANT_SLUG]);
    if (!result.rows[0])
        throw new Error('Tenant not found');
    await db.query(`
    INSERT INTO user_roles (user_id, role_id)
    SELECT $1, r.id FROM roles r JOIN tenants t ON t.id = r.tenant_id
    WHERE t.slug = $2 AND r.code = 'super_admin' ON CONFLICT DO NOTHING
  `, [result.rows[0].id, input.CRM_TENANT_SLUG]);
    console.log(`Admin user ready: ${input.CRM_ADMIN_EMAIL}`);
}
finally {
    await db.end();
}
