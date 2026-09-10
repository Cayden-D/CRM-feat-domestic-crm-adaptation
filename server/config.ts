import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config({ path: '.env.local' })

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().default('ai_crm'),
  DB_USER: z.string().default('postgres'),
  DB_PASSWORD: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('8h'),
  CORS_ORIGIN: z.string().default('http://127.0.0.1:5173'),
  DASHSCOPE_API_KEY: z.string().min(1).optional(),
  DASHSCOPE_BASE_URL: z.string().url().default('https://dashscope.aliyuncs.com/compatible-mode/v1'),
  QWEN_DEFAULT_MODEL: z.enum(['qwen3.7-flash','qwen3.7-plus','qwen3.6-plus']).default('qwen3.7-flash'),
  QWEN_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  const issues = parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')
  throw new Error(`Invalid server configuration: ${issues}`)
}

export const config = parsed.data
