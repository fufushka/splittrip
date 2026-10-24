/**
 * Підключення до Postgres через postgres.js (ADR-0015), транзакції з таймаутами й ретраями
 * тимчасових помилок (ADR-0018, spec «Збої»). Таймаути задаються `set_config(…, true)`
 * усередині транзакції — так вони працюють і через Supavisor у transaction mode.
 */
import postgres from 'postgres';

import { log } from '../../context/index.ts';
import { SourceUnavailableError } from '../../trips/index.ts';

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

export interface PostgresConfig {
  readonly url: string;
  /** `false` для Supavisor transaction mode: prepared statements там не підтримуються. */
  readonly prepare: boolean;
  readonly maxConnections?: number;
  /** Кожен запит до БД — для лічильника N+1 у тестах (spec, крит. 10). */
  readonly onQuery?: (query: string) => void;
}

const STATEMENT_TIMEOUT_MS = 5000;
const LOCK_TIMEOUT_MS = 3000;
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 50;

/** Повторюємо: serialization failure, deadlock, клас 08 і обриви з'єднання (spec «Збої»). */
const RETRYABLE_SQLSTATE = new Set(['40001', '40P01']);
const CONNECTION_ERRORS = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'CONNECTION_CLOSED',
  'CONNECTION_ENDED',
  'CONNECTION_DESTROYED',
  'CONNECT_TIMEOUT',
]);
/** Не повторюємо, але це теж «джерело недоступне», а не помилка клієнта: → 503. */
const UNAVAILABLE_SQLSTATE = new Set(['57014', '55P03', '57P01', '57P02', '57P03', '53300']);

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

export function isRetryable(error: unknown): boolean {
  const code = errorCode(error);
  if (code === undefined) return false;
  return RETRYABLE_SQLSTATE.has(code) || CONNECTION_ERRORS.has(code) || code.startsWith('08');
}

function isUnavailable(error: unknown): boolean {
  const code = errorCode(error);
  return isRetryable(error) || (code !== undefined && UNAVAILABLE_SQLSTATE.has(code));
}

/** Помилки БД, що означають недоступність, → `SourceUnavailableError`; решта — як є. */
export function translate(error: unknown): unknown {
  if (!isUnavailable(error)) return error;
  return new SourceUnavailableError(`БД недоступна: ${errorCode(error) ?? 'невідомо'}`, {
    cause: error,
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** До `MAX_ATTEMPTS` спроб з експоненційним backoff і джитером; далі — `503`. */
export async function withRetry<T>(op: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await op();
    } catch (error) {
      if (!isRetryable(error) || attempt >= MAX_ATTEMPTS) throw translate(error);
      const delay = BACKOFF_BASE_MS * 4 ** (attempt - 1) + Math.random() * BACKOFF_BASE_MS;
      log.warn({ attempt, code: errorCode(error), delayMs: Math.round(delay) }, 'storage: retry');
      await sleep(delay);
    }
  }
}

export function connect(config: PostgresConfig): Sql {
  const { onQuery } = config;
  return postgres(config.url, {
    prepare: config.prepare,
    max: config.maxConnections ?? 10,
    connect_timeout: 5,
    idle_timeout: 30,
    connection: { application_name: 'splittrip' },
    onnotice: () => undefined,
    ...(onQuery === undefined
      ? {}
      : {
          debug: (_connection: number, query: string) => {
            onQuery(query);
          },
        }),
  });
}

/**
 * Транзакція з локальними таймаутами; уся транзакція повторюється на тимчасовій помилці,
 * тож `fn` має бути безпечною для повтору (ADR-0018).
 */
export function transaction<T>(sql: Sql, fn: (tx: Tx) => Promise<T>, mode?: string): Promise<T> {
  const body = async (tx: Tx): Promise<T> => {
    await tx`select set_config('statement_timeout', ${String(STATEMENT_TIMEOUT_MS)}, true),
                    set_config('lock_timeout', ${String(LOCK_TIMEOUT_MS)}, true)`;
    return fn(tx);
  };
  return withRetry(
    () => (mode === undefined ? sql.begin(body) : sql.begin(mode, body)) as Promise<T>,
  );
}
