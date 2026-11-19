/**
 * Публічна точка входу модуля `http` — єдиний модуль, що знає про Fastify (ADR-0003).
 * Роути знають лише HTTP (architecture.md лаби 2, розд. 1); контекст запиту відкривається
 * тут один раз (ADR-0016), помилки — один глобальний обробник (ADR-0021).
 */
import Fastify, { type FastifyInstance, LogController } from 'fastify';

import type { AuthProvider } from '../auth/index.ts';
import { log, logFields, runWithContext, setLogger } from '../context/index.ts';
import { uuidv7 } from '../ids/index.ts';
import type { Idempotency } from '../idempotency/index.ts';
import type { SystemInfo } from '../system/index.ts';
import type { TripService } from '../trips/index.ts';
import { registerProblemHandlers } from './problems.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerTripRoutes } from './routes/trips.ts';

/** Тип сервера для composition root — без прямого імпорту `fastify` поза `http` (C6). */
export type Server = FastifyInstance;

export interface ServerDeps {
  readonly system: SystemInfo;
  readonly trips: TripService;
  readonly auth: AuthProvider;
  readonly idempotency: Idempotency;
  readonly logLevel?: string;
  /** Куди писати логи (тести перехоплюють рядки); типово stdout. */
  readonly logStream?: { write(line: string): void };
}

const REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** `X-Request-Id` клієнта, якщо він безпечний для логів, інакше новий UUIDv7 (spec). */
function processIdFrom(header: string | string[] | undefined): string {
  return typeof header === 'string' && REQUEST_ID.test(header) ? header : uuidv7();
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({
    logger: {
      level: deps.logLevel ?? 'info',
      // processId і userId — у кожному рядку з будь-якого рівня (spec, крит. 5).
      mixin: logFields,
      // Паролі й токени не потрапляють у логи (spec, крит. 6).
      redact: {
        paths: [
          'password',
          '*.password',
          'accessToken',
          '*.accessToken',
          'refreshToken',
          '*.refreshToken',
          'req.headers.authorization',
        ],
        censor: '[redacted]',
      },
      ...(deps.logStream === undefined ? {} : { stream: deps.logStream }),
    },
    // Власний лог запиту в onResponse — через `context.log`, з тими самими полями.
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: (request) => processIdFrom(request.headers['x-request-id']),
    // Без приведення типів: `"amount": "100"` чи `true` — 400, а не сума.
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  setLogger(app.log);

  app.addHook('onRequest', (request, reply, done) => {
    void reply.header('x-request-id', request.id);
    runWithContext(request.id, done);
  });

  app.addHook('onResponse', (request, reply, done) => {
    log.info(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTimeMs: Math.round(reply.elapsedTime),
      },
      'request completed',
    );
    done();
  });

  registerProblemHandlers(app);

  app.get('/health', () => ({ status: 'ok' }));

  app.get('/ready', async (_request, reply) =>
    (await deps.system.ready())
      ? { status: 'ready' }
      : reply.code(503).header('retry-after', '2').send({ status: 'unavailable' }),
  );

  app.get('/version', () => ({ version: deps.system.version }));

  registerAuthRoutes(app, deps.auth);
  registerTripRoutes(app, deps);

  return app;
}
