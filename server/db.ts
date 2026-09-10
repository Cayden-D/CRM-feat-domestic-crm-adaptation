import pg from 'pg'
import { config } from './config.js'

const { Pool } = pg
export const db = new Pool({
  host: config.DB_HOST,
  port: config.DB_PORT,
  database: config.DB_NAME,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  application_name: 'ai-crm-api',
})

db.on('error', error => console.error('Unexpected PostgreSQL pool error', error))

export async function checkDatabase() {
  const result = await db.query<{ now: Date; database: string }>('SELECT now(), current_database() AS database')
  return result.rows[0]
}
