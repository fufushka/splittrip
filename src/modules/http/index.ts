/**
 * Публічна точка входу модуля `http` — єдиний модуль, що знає про Fastify (ADR-0003).
 */
import Fastify, { type FastifyInstance } from 'fastify';

import type { SystemInfo } from '../system/index.ts';

export interface ServerDeps {
  readonly system: SystemInfo;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get(
    '/health',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            // Без `const`: серіалізатор підставив би 'ok' замість реального значення
            // й приховав би зламаний стан від smoke-тесту (reports/05).
            properties: { status: { type: 'string' } },
            required: ['status'],
          },
        },
      },
    },
    () => ({ status: 'ok' }),
  );

  app.get(
    '/version',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: { version: { type: 'string' } },
            required: ['version'],
          },
        },
      },
    },
    () => ({ version: deps.system.version }),
  );

  return app;
}
