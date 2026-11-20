import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Hub } from './hub/load.ts';
import { GENERIC_MESSAGE } from './http/sendResult.ts';
import { taskRoutes } from './routes/tasks.ts';
import { workspaceRoutes } from './routes/workspace.ts';
import { createTaskQueue } from './tasks/queue.ts';
import type { TaskRunner } from './tasks/runner.ts';
import { createTaskStore } from './tasks/store.ts';

export type BuildOptions = {
  hub: Hub;
  runner: TaskRunner;
  maxConcurrentTasks?: number;
  logger?: FastifyServerOptions['logger'];
  rateLimitMax?: number;
};

export const buildApp = async (options: BuildOptions) => {
  const app = Fastify({
    logger: options.logger ?? false,
    // Caddy on the same host is the only proxy: trust loopback, nothing else,
    // so request.ip (and the rate limit) can't be spoofed with X-Forwarded-For.
    trustProxy: ['127.0.0.1', '::1'],
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    bodyLimit: 16_384,
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // Faults land here: logged, then a generic 500 with the request id.
  app.setErrorHandler(
    (error: { statusCode?: number; message: string }, request, reply) => {
      const status = error.statusCode ?? 500;
      if (status < 500) {
        return reply.status(status).send({
          code: status === 429 ? 'unavailable' : 'invalid',
          message: error.message,
        });
      }
      request.log.error({ err: error }, 'unhandled error');
      return reply.status(500).send({
        code: 'unexpected',
        message: GENERIC_MESSAGE,
        requestId: request.id,
      });
    }
  );
  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ code: 'not_found', message: 'No such route' })
  );

  await app.register(rateLimit, {
    max: options.rateLimitMax ?? 300,
    timeWindow: '1 minute',
    // request.ip throws on a socket without an address (Fastify's injectWS
    // in tests); fall back rather than 500.
    keyGenerator: (request) => {
      try {
        return request.ip;
      } catch {
        return 'unknown';
      }
    },
  });
  await app.register(websocket, { options: { maxPayload: 1024 } });

  const store = createTaskStore();
  const queue = createTaskQueue({
    hub: options.hub,
    store,
    runner: options.runner,
    maxConcurrent: options.maxConcurrentTasks ?? 2,
    log: app.log,
  });

  app.get('/api/health', { config: { rateLimit: false } }, async () => ({
    status: 'ok',
  }));
  workspaceRoutes(app, options.hub);
  taskRoutes(app, options.hub, store, queue);

  return app;
};
