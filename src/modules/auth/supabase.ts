/**
 * Адаптер Supabase Auth (ADR-0017): реєстрація й токени — HTTP API `/auth/v1/*` через
 * `fetch`; перевірка access-токена — локально за JWKS (асиметричні ключі, кешуються `jose`).
 * Коди відповідей перевірено на локальному Supabase CLI 2.120.0.
 */
import { createRemoteJWKSet, errors, jwtVerify } from 'jose';

import {
  type AuthProvider,
  AuthRejectedError,
  AuthUnavailableError,
  EmailTakenError,
  type Session,
  invalidCredentials,
  invalidToken,
} from './model.ts';

export interface SupabaseAuthOptions {
  /** Напр. `http://127.0.0.1:54321` або `https://<ref>.supabase.co`. */
  readonly url: string;
  /** Publishable (anon) ключ проєкту — не секрет, але й не service role. */
  readonly apiKey: string;
  readonly timeoutMs?: number;
}

interface SupabaseSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; email: string };
}

interface SupabaseError {
  error_code?: string;
  msg?: string;
}

const unavailable = (cause: unknown): AuthUnavailableError =>
  new AuthUnavailableError('auth_unavailable', 'Supabase Auth недоступний', { cause });

export function createSupabaseAuth(options: SupabaseAuthOptions): AuthProvider {
  const base = options.url.replace(/\/+$/, '');
  const issuer = `${base}/auth/v1`;
  const timeoutMs = options.timeoutMs ?? 5000;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
    timeoutDuration: timeoutMs,
  });

  /** Виклик Auth API: мережа, таймаут чи 5xx → 503; 4xx — тіло помилки для мапінгу. */
  const call = async (
    path: string,
    body: unknown,
    accessToken?: string,
  ): Promise<{ status: number; json: unknown }> => {
    const res = await fetch(`${issuer}${path}`, {
      method: 'POST',
      headers: {
        apikey: options.apiKey,
        'content-type': 'application/json',
        ...(accessToken === undefined ? {} : { authorization: `Bearer ${accessToken}` }),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    }).catch((error: unknown) => {
      throw unavailable(error);
    });
    // 5xx і rate limit (429) — тимчасово недоступно, а не «невірний пароль» (spec-fix-04, п. 5).
    if (res.status >= 500 || res.status === 429) {
      throw unavailable(new Error(`Supabase Auth ${String(res.status)}`));
    }
    const text = await res.text().catch((error: unknown) => {
      throw unavailable(error);
    });
    if (text === '') return { status: res.status, json: null };
    // Не-JSON (HTML від проксі) — відповідь не за контрактом Auth API, а не помилка клієнта.
    const json = await Promise.resolve(text)
      .then((t) => JSON.parse(t) as unknown)
      .catch((error: unknown) => {
        throw unavailable(error);
      });
    return { status: res.status, json };
  };

  const session = (json: unknown): Session => {
    const s = json as SupabaseSession;
    return {
      user: { id: s.user.id, email: s.user.email },
      accessToken: s.access_token,
      refreshToken: s.refresh_token,
      expiresIn: s.expires_in,
    };
  };

  const errorCode = (json: unknown): string | undefined =>
    (json as SupabaseError | null)?.error_code;

  return {
    async signup(email, password) {
      const { status, json } = await call('/signup', { email, password });
      if (status === 200 && typeof (json as Partial<SupabaseSession>).access_token !== 'string') {
        // Проєкт вимагає підтвердження email, а контракт його не підтримує (spec-fix-03, п. 2):
        // це помилка конфігурації сервера, не клієнта → 500 з причиною в лозі.
        throw new Error(
          'Supabase Auth повернув користувача без сесії: вимкніть «Confirm email» у проєкті',
        );
      }
      if (status === 200) return session(json);
      if (errorCode(json) === 'user_already_exists') {
        throw new EmailTakenError('email_taken', 'Email уже зареєстровано');
      }
      throw new AuthRejectedError(
        'auth_rejected',
        `Supabase Auth відхилив реєстрацію: ${errorCode(json) ?? String(status)}`,
      );
    },

    async login(email, password) {
      const { status, json } = await call('/token?grant_type=password', { email, password });
      if (status === 200) return session(json);
      // invalid_credentials і будь-яка інша 4xx — однакова відповідь (contract.md).
      throw invalidCredentials();
    },

    async refresh(refreshToken) {
      const { status, json } = await call('/token?grant_type=refresh_token', {
        refresh_token: refreshToken,
      });
      if (status === 200) return session(json);
      throw invalidToken();
    },

    async logout(accessToken) {
      const { status } = await call('/logout?scope=global', {}, accessToken);
      if (status !== 204 && status !== 200) throw invalidToken();
    },

    async verify(accessToken) {
      const result = await jwtVerify(accessToken, jwks, {
        issuer,
        audience: 'authenticated',
        algorithms: ['ES256', 'RS256'],
      }).catch((error: unknown) => {
        // JWKS недоступний — проблема джерела (503); решта — недійсний токен (401).
        if (error instanceof errors.JWKSTimeout) throw unavailable(error);
        if (error instanceof errors.JOSEError) throw invalidToken();
        if (error instanceof TypeError) throw unavailable(error);
        throw error;
      });
      const subject = result.payload.sub;
      if (subject === undefined) throw invalidToken();
      return subject;
    },
  };
}
