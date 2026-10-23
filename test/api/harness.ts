/**
 * Спільна обв'язка API-тестів (spec, крит. 1–2): складає той самий застосунок, що й
 * `main.ts`, зі сховищем за `STORAGE` і ганяє запити через `inject` — без мережі.
 */
import { randomUUID } from 'node:crypto';

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

export interface Harness {
  readonly app: App;
  /** JSON-рядки логів, записані застосунком. */
  readonly logs: Record<string, unknown>[];
  call(method: string, url: string, options?: CallOptions): Promise<Reply>;
  user(): Promise<User>;
  close(): Promise<void>;
}

export const PASSWORD = 'correct-horse-battery';

export async function startHarness(
  options: Omit<ComposeOptions, 'logStream'> = {},
): Promise<Harness> {
  const logs: Record<string, unknown>[] = [];
  const app = await composeApp({
    ...options,
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
    logs,
    call,
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
