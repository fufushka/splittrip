/**
 * Клієнт E2E (spec лаби 3, крит. 9–12; architecture.md лаби 3, розд. 3). Чорна скринька:
 * лише `node:*` і `fetch` по мережі до зібраного застосунку, який запустив `npm test`
 * (`E2E_BASE_URL`); нічого з `src/`.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const baseUrl = process.env.E2E_BASE_URL;
if (baseUrl === undefined || baseUrl === '') {
  // Помилка, а не пропуск: E2E без застосунку нічого не доводить.
  throw new Error('E2E_BASE_URL не задано: E2E запускає `npm test` (scripts/test-all.ts)');
}

export interface Reply {
  readonly status: number;
  readonly headers: Headers;
  readonly body: unknown;
}

export interface RequestOptions {
  readonly token?: string;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

export async function request(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<Reply> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(new URL(path, baseUrl), {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    body: text === '' ? undefined : (JSON.parse(text) as unknown),
  };
}

export const PASSWORD = 'e2e-correct-horse-battery';

export interface User {
  readonly id: string;
  readonly email: string;
  readonly token: string;
  readonly refreshToken: string;
}

/** Новий користувач через справжній Supabase Auth: `signup` 201 + `login` 200 (contract.md). */
export async function newUser(): Promise<User> {
  const email = `e2e-${randomUUID()}@example.com`;
  const credentials = { email, password: PASSWORD };
  const signup = await request('POST', '/auth/signup', { body: credentials });
  assert.equal(signup.status, 201, `signup: ${JSON.stringify(signup.body)}`);
  const login = await request('POST', '/auth/login', { body: credentials });
  assert.equal(login.status, 200, `login: ${JSON.stringify(login.body)}`);
  const session = login.body as {
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
}
