/**
 * Спільна обв'язка API-тестів (spec, крит. 1–2): складає той самий застосунок, що й
 * `main.ts`, зі сховищем за `STORAGE` і ганяє запити через `inject` — без мережі.
 * `STORAGE=postgres` задає `npm run test:api:db` разом з базою прогону й локальним Supabase.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { type JWK, SignJWT, generateKeyPair, importJWK } from 'jose';

import { type App, type ComposeOptions, composeApp } from '../../src/compose.ts';

export interface Reply {
  readonly status: number;
  readonly headers: Record<string, string | string[] | number | undefined>;
  readonly body: unknown;
  readonly text: string;
}

export interface CallOptions {
  readonly token?: string;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

export interface User {
  readonly id: string;
  readonly email: string;
  readonly token: string;
  readonly refreshToken: string;
}

export type Mode = 'memory' | 'postgres';

export const MODE: Mode = process.env.STORAGE === 'postgres' ? 'postgres' : 'memory';

export interface Harness {
  readonly app: App;
  /** SQL-запити до БД (лише postgres) — лічильник N+1. */
  readonly queries: string[];
  /** JSON-рядки логів, записані застосунком. */
  readonly logs: Record<string, unknown>[];
  call(method: string, url: string, options?: CallOptions): Promise<Reply>;
  user(): Promise<User>;
  /** Токен з правильними claims, але підписаний чужим ключем. */
  forgedToken(user: User): Promise<string>;
  close(): Promise<void>;
}

const MEMORY_ISSUER = 'splittrip-memory-auth';

function issuer(): string {
  return MODE === 'memory' ? MEMORY_ISSUER : `${process.env.SUPABASE_URL ?? ''}/auth/v1`;
}

/** Приватний ключ локального Supabase (`supabase/signing_keys.json`, не комітиться). */
function localSigningKey(): JWK & { kid: string } {
  const path = process.env.SUPABASE_SIGNING_KEYS ?? 'supabase/signing_keys.json';
  const [key] = JSON.parse(readFileSync(path, 'utf8')) as (JWK & { kid: string })[];
  if (key === undefined) throw new Error(`Немає ключа в ${path}`);
  return key;
}

async function sign(
  user: User,
  key: Parameters<SignJWT['sign']>[0],
  kid: string,
  expiresAt: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ role: 'authenticated', email: user.email })
    .setProtectedHeader({ alg: 'ES256', kid })
    .setSubject(user.id)
    .setIssuer(issuer())
    .setAudience('authenticated')
    .setIssuedAt(Math.min(now, expiresAt - 60))
    .setExpirationTime(expiresAt)
    .sign(key);
}

/** Прострочений, але справжньо підписаний токен локального Supabase (лише postgres). */
export async function expiredSupabaseToken(user: User): Promise<string> {
  // key_ops ключа Supabase містить і `verify` — для імпорту як ключа підпису прибираємо.
  const signing = localSigningKey();
  const jwk: JWK = { ...signing };
  delete jwk.key_ops;
  delete jwk.use;
  const key = await importJWK(jwk, 'ES256');
  return sign(user, key, signing.kid, Math.floor(Date.now() / 1000) - 60);
}

export const PASSWORD = 'correct-horse-battery';

export async function startHarness(
  options: Omit<ComposeOptions, 'logStream'> = {},
): Promise<Harness> {
  const logs: Record<string, unknown>[] = [];
  const queries: string[] = [];
  const app = await composeApp({
    ...options,
    onQuery: (query) => queries.push(query),
    env: { LOG_LEVEL: 'debug', ...process.env, ...options.env },
    logStream: {
      write(line) {
        logs.push(JSON.parse(line) as Record<string, unknown>);
      },
    },
  });

  const call = async (method: string, url: string, opts: CallOptions = {}): Promise<Reply> => {
    const res = await app.server.inject({
      method: method as 'GET',
      url,
      headers: {
        ...(opts.token === undefined ? {} : { authorization: `Bearer ${opts.token}` }),
        ...opts.headers,
      },
      ...(opts.body === undefined ? {} : { payload: opts.body as object }),
    });
    const text = res.body;
    return {
      status: res.statusCode,
      headers: res.headers,
      text,
      body: text === '' ? undefined : (JSON.parse(text) as unknown),
    };
  };

  return {
    app,
    queries,
    logs,
    call,
    async forgedToken(user) {
      const { privateKey } = await generateKeyPair('ES256');
      const kid = MODE === 'postgres' ? localSigningKey().kid : 'forged';
      return sign(user, privateKey, kid, Math.floor(Date.now() / 1000) + 3600);
    },
    async user() {
      const email = `user-${randomUUID()}@example.com`;
      const res = await call('POST', '/auth/signup', { body: { email, password: PASSWORD } });
      if (res.status !== 201) throw new Error(`signup ${String(res.status)}: ${res.text}`);
      const session = res.body as {
        user: { id: string };
        accessToken: string;
        refreshToken: string;
      };
      return {
        id: session.user.id,
        email,
        token: session.accessToken,
        refreshToken: session.refreshToken,
      };
    },
    close: () => app.close(),
  };
}

/** Поле тіла відповіді без перевірок типів — для коротких тестів. */
// T — лише очікуваний тип поля для читабельності тестів; перевіряють його assert-и.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function field<T = unknown>(reply: Reply, ...path: (string | number)[]): T {
  let value: unknown = reply.body;
  for (const key of path) value = (value as Record<string | number, unknown>)[key];
  return value as T;
}
