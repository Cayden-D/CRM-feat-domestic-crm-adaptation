import dotenv from 'dotenv';
import { z } from 'zod';
dotenv.config({ path: '.env.local' });
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
    ALI1688_APP_KEY: z.string().min(1).optional(),
    ALI1688_APP_SECRET: z.string().min(1).optional(),
    ALI1688_REDIRECT_URI: z.string().url().optional(),
    ALI1688_TOKEN_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
    DASHSCOPE_API_KEY: z.string().min(1).optional(),
    DASHSCOPE_BASE_URL: z.string().url().default('https://dashscope.aliyuncs.com/compatible-mode/v1'),
    QWEN_DEFAULT_MODEL: z.enum(['qwen3.8-flash', 'qwen3.7-flash', 'qwen3.7-plus', 'qwen3.6-plus']).default('qwen3.8-flash'),
    QWEN_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
    OSS_REGION: z.string().regex(/^oss-[a-z0-9-]+$/).optional(),
    OSS_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/).optional(),
    OSS_ACCESS_KEY_ID: z.string().min(1).optional(),
    OSS_ACCESS_KEY_SECRET: z.string().min(1).optional(),
    OSS_CUSTOM_DOMAIN: z.string().url().refine(value => {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.port && url.pathname === '/' && !url.search && !url.hash;
    }, 'Must be an HTTPS origin without path, query, fragment, or port').optional(),
    AGENT_QUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
    AGENT_QUEUE_POLL_MS: z.coerce.number().int().min(500).max(60_000).default(3000),
});
const parsed = schema.safeParse(process.env);
if (!parsed.success) {
    const issues = parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid server configuration: ${issues}`);
}
export const config = parsed.data;
