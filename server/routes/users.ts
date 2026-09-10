import type { FastifyInstance } from 'fastify'
import { db } from '../db.js'
import { requireAuth } from '../auth.js'

export async function userRoutes(app: FastifyInstance) {
  app.get('/assignable', { preHandler: requireAuth }, async request => {
    const result = await db.query(`
      SELECT u.id, u.display_name, u.email::text,
        array_remove(array_agg(DISTINCT r.code), NULL) AS roles
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN roles r ON r.id = ur.role_id
      WHERE u.tenant_id = $1 AND u.status = 'active' AND u.deleted_at IS NULL
      GROUP BY u.id ORDER BY u.display_name
    `, [request.authUser.tenantId])
    return { data: result.rows }
  })
}
