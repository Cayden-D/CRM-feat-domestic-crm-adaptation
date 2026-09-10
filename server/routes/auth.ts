import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { db } from '../db.js'
import { config } from '../config.js'
import { requireAuth } from '../auth.js'

const loginSchema = z.object({
  email: z.string().email().max(255).transform(value => value.toLowerCase()),
  password: z.string().min(8).max(128),
  tenant: z.string().min(1).max(80).default('default'),
})

type LoginUser = {
  id: string; tenant_id: string; email: string; password_hash: string | null
  display_name: string; status: string; role_codes: string[] | null; permissions: string[] | null
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/login', async (request, reply) => {
    const input = loginSchema.safeParse(request.body)
    if (!input.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', details: input.error.flatten() })

    const result = await db.query<LoginUser>(`
      SELECT u.id, u.tenant_id, u.email::text, u.password_hash, u.display_name, u.status,
        array_remove(array_agg(DISTINCT r.code), NULL) AS role_codes,
        coalesce(jsonb_agg(DISTINCT p.permission) FILTER (WHERE p.permission IS NOT NULL), '[]') AS permissions
      FROM users u
      JOIN tenants t ON t.id = u.tenant_id
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN roles r ON r.id = ur.role_id
      LEFT JOIN LATERAL jsonb_array_elements_text(coalesce(r.permissions, '[]')) p(permission) ON true
      WHERE u.email = $1 AND t.slug = $2 AND u.deleted_at IS NULL
      GROUP BY u.id
    `, [input.data.email, input.data.tenant])

    const user = result.rows[0]
    const valid = user?.password_hash && await bcrypt.compare(input.data.password, user.password_hash)
    if (!user || !valid || user.status !== 'active') {
      return reply.code(401).send({ error: 'INVALID_CREDENTIALS', message: '邮箱或密码不正确。' })
    }

    const token = await reply.jwtSign({ sub: user.id, tenantId: user.tenant_id, email: user.email,
      displayName: user.display_name, roles: user.role_codes ?? [], permissions: user.permissions ?? [] },
    { expiresIn: config.JWT_EXPIRES_IN })
    await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id])
    return { token, user: { id: user.id, email: user.email, displayName: user.display_name, roles: user.role_codes ?? [] } }
  })

  app.get('/me', { preHandler: requireAuth }, async request => ({ user: request.authUser }))
}
