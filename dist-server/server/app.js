import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { config } from './config.js';
import { checkDatabase } from './db.js';
import { authRoutes } from './routes/auth.js';
import { leadRoutes } from './routes/leads.js';
import { leadWorkflowRoutes } from './routes/lead-workflow.js';
import { userRoutes } from './routes/users.js';
import { accountRoutes } from './routes/accounts.js';
import { opportunityRoutes } from './routes/opportunities.js';
import { productRoutes } from './routes/products.js';
import { quoteRoutes } from './routes/quotes.js';
import { productCollectionRoutes } from './routes/product-collections.js';
import { aiRoutes } from './routes/ai.js';
export async function buildApp() {
    const app = Fastify({
        logger: { level: config.NODE_ENV === 'production' ? 'info' : 'warn' },
        requestIdHeader: 'x-request-id',
        genReqId: () => randomUUID(),
    });
    await app.register(cors, {
        origin: config.CORS_ORIGIN,
        credentials: true,
        methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Collector-Key'],
    });
    await app.register(jwt, { secret: config.JWT_SECRET });
    app.setErrorHandler((error, request, reply) => {
        const apiError = error;
        request.log.error(apiError);
        if (reply.sent)
            return;
        const clientError = Boolean(apiError.statusCode && apiError.statusCode < 500);
        reply.code(clientError ? apiError.statusCode : 500).send({
            error: clientError ? 'REQUEST_ERROR' : 'INTERNAL_SERVER_ERROR',
            message: clientError ? apiError.message : '服务器处理请求时发生错误。',
        });
    });
    app.get('/api/health', async () => {
        const database = await checkDatabase();
        return { status: 'ok', service: 'ai-crm-api', database: database.database, time: database.now };
    });
    await app.register(authRoutes, { prefix: '/api/auth' });
    await app.register(leadRoutes, { prefix: '/api/leads' });
    await app.register(leadWorkflowRoutes, { prefix: '/api/leads' });
    await app.register(userRoutes, { prefix: '/api/users' });
    await app.register(accountRoutes, { prefix: '/api/accounts' });
    await app.register(opportunityRoutes, { prefix: '/api/opportunities' });
    await app.register(productRoutes, { prefix: '/api/products' });
    await app.register(quoteRoutes, { prefix: '/api/quotes' });
    await app.register(productCollectionRoutes, { prefix: '/api/product-collections' });
    await app.register(aiRoutes, { prefix: '/api/ai' });
    return app;
}
