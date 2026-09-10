import '@fastify/jwt'
import 'fastify'

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthToken
    user: AuthToken
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthToken
  }
}

export interface AuthToken {
  sub: string
  tenantId: string
  email: string
  displayName: string
  roles: string[]
  permissions: string[]
}
