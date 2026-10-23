/**
 * Один глобальний обробник помилок (ADR-0021): клас помилки → статус, тіло RFC 9457
 * `application/problem+json` з `requestId`. Таблиця кодів — contract.md, «Помилки».
 */
import type { FastifyError, FastifyInstance } from 'fastify';

import { AuthUnavailableError, EmailTakenError, UnauthorizedError } from '../auth/index.ts';
import { log } from '../context/index.ts';
import { IdempotencyInProgressError, IdempotencyMismatchError } from '../idempotency/index.ts';
import {
  ConflictError,
  DomainRuleError,
  NotFoundError,
  SourceUnavailableError,
} from '../trips/index.ts';

/** Скільки секунд радимо клієнту чекати перед повтором на `503`. */
const RETRY_AFTER_SECONDS = 2;

interface Problem {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail: string;
}

const TITLES: Record<number, string> = {
  400: 'Некоректний запит',
  401: 'Потрібна автентифікація',
  404: 'Не знайдено',
  409: 'Конфлікт зі станом',
  413: 'Завеликий запит',
  415: 'Непідтримуваний тип вмісту',
  422: 'Порушено правило домену',
  503: 'Сервіс тимчасово недоступний',
  500: 'Внутрішня помилка',
};

function problem(status: number, code: string, detail: string): Problem {
  return { status, code, title: TITLES[status] ?? 'Помилка', detail };
}

/** Клас → статус. Порядок важливий лише для підкласів; невідоме → 500 без деталей. */
function toProblem(error: unknown): Problem {
  if (error instanceof NotFoundError) return problem(404, error.code, error.message);
  if (error instanceof ConflictError) return problem(409, error.code, error.message);
  if (error instanceof DomainRuleError) return problem(422, error.code, error.message);
  if (error instanceof UnauthorizedError) return problem(401, error.code, error.message);
  if (error instanceof EmailTakenError) return problem(409, error.code, error.message);
  if (error instanceof IdempotencyInProgressError) return problem(409, error.code, error.message);
  if (error instanceof IdempotencyMismatchError) return problem(422, error.code, error.message);
  if (error instanceof SourceUnavailableError || error instanceof AuthUnavailableError) {
    return problem(503, error.code, 'Джерело даних тимчасово недоступне, повторіть пізніше');
  }
  const fastifyError = error as Partial<FastifyError>;
  if (fastifyError.validation !== undefined) {
    return problem(400, 'validation_failed', fastifyError.message ?? 'Некоректні дані');
  }
  const status = fastifyError.statusCode;
  if (status !== undefined && status >= 400 && status < 500) {
    return problem(status, 'bad_request', fastifyError.message ?? 'Некоректний запит');
  }
  return problem(500, 'internal_error', 'Внутрішня помилка; повідомте requestId');
}

export function registerProblemHandlers(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const p = toProblem(error);
    if (p.status >= 500) log.error({ err: error, code: p.code }, 'request failed');
    else log.info({ code: p.code, status: p.status }, 'request rejected');
    if (p.status === 401) void reply.header('www-authenticate', 'Bearer');
    if (p.status === 503) void reply.header('retry-after', String(RETRY_AFTER_SECONDS));
    return reply
      .code(p.status)
      .type('application/problem+json')
      .send({ type: `/problems/${p.code}`, ...p, requestId: request.id });
  });

  app.setNotFoundHandler((request, reply) =>
    reply
      .code(404)
      .type('application/problem+json')
      .send({
        type: '/problems/route_not_found',
        ...problem(404, 'route_not_found', `Немає маршруту ${request.method} ${request.url}`),
        requestId: request.id,
      }),
  );
}
