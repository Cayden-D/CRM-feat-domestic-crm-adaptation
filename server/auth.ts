import type { FastifyReply, FastifyRequest } from 'fastify'
import type { AuthToken } from './types/fastify.js'

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify()
    request.authUser = request.user as AuthToken
  } catch {
    return reply.code(401).send({ error: 'UNAUTHORIZED', message: '登录已失效，请重新登录。' })
  }
}

export function hasPermission(granted: string[], required: string) {
  if (granted.includes('*') || granted.includes(required)) return true
  return granted.includes(`${required.split(':')[0]}:*`)
}

export function requirePermission(permission: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(request, reply)
    if (reply.sent) return
    if (!hasPermission(request.authUser.permissions, permission)) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: '当前账号没有执行此操作的权限。' })
    }
  }
}
