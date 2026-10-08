import { buildApp } from './app.js';
import { config } from './config.js';
import { db } from './db.js';
import { startCollectionQueue } from './integrations/1688-collection-queue.js';
const app = await buildApp();
let stopCollectionQueue = async () => { };
async function shutdown(signal) {
    app.log.info({ signal }, 'Shutting down');
    await stopCollectionQueue();
    await app.close();
    await db.end();
    process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
try {
    await app.listen({ host: config.API_HOST, port: config.API_PORT });
    stopCollectionQueue = startCollectionQueue(error => app.log.error({ err: error }, '1688 collection queue tick failed'));
}
catch (error) {
    app.log.error(error);
    await db.end();
    process.exit(1);
}
