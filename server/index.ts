import { buildApp } from './app.js'
import { config } from './config.js'
import { db } from './db.js'

const app = await buildApp()

async function shutdown(signal: string) {
  app.log.info({ signal }, 'Shutting down')
  await app.close()
  await db.end()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

try {
  await app.listen({ host: config.API_HOST, port: config.API_PORT })
} catch (error) {
  app.log.error(error)
  await db.end()
  process.exit(1)
}
