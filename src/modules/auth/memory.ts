/**
 * Фейк Supabase Auth для `STORAGE=memory` (spec, «Шари і контекст»): користувачі в пам'яті,
 * JWT підписано власним ключем і перевіряється тим самим `jwtVerify`, що й для Supabase.
 * Паролі — PBKDF2 через Web Crypto, не відкритим текстом навіть у пам'яті.
 */
import { SignJWT, errors, generateKeyPair, jwtVerify } from 'jose';

import {
  type AuthProvider,
  EmailTakenError,
  type Session,
  invalidCredentials,
  invalidToken,
} from './model.ts';

const ISSUER = 'splittrip-memory-auth';
const AUDIENCE = 'authenticated';
const PBKDF2_ITERATIONS = 100_000;

interface StoredUser {
  readonly id: string;
  readonly email: string;
  readonly salt: Uint8Array<ArrayBuffer>;
  readonly hash: string;
}

export interface MemoryAuthOptions {
  /** Час життя access-токена, секунди; від'ємний — для тесту прострочення. */
  readonly accessTokenTtlSeconds?: number;
}

function randomHex(bytes: number): string {
  const buffer = globalThis.crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buffer, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password: string, salt: Uint8Array<ArrayBuffer>): Promise<string> {
  const subtle = globalThis.crypto.subtle;
  const key = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createMemoryAuth(options: MemoryAuthOptions = {}): Promise<AuthProvider> {
  const ttl = options.accessTokenTtlSeconds ?? 3600;
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const users = new Map<string, StoredUser>();
  /** refresh-токен → id користувача. */
  const refreshTokens = new Map<string, string>();

  const issue = async (user: StoredUser): Promise<Session> => {
    const now = Math.floor(Date.now() / 1000);
    const accessToken = await new SignJWT({ email: user.email, role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256' })
      .setSubject(user.id)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + ttl)
      .sign(privateKey);
    const refreshToken = randomHex(32);
    refreshTokens.set(refreshToken, user.id);
    return { user: { id: user.id, email: user.email }, accessToken, refreshToken, expiresIn: ttl };
  };

  const verify = async (accessToken: string): Promise<string> => {
    const result = await jwtVerify(accessToken, publicKey, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['ES256'],
    }).catch((error: unknown) => {
      if (error instanceof errors.JOSEError) throw invalidToken();
      throw error;
    });
    const subject = result.payload.sub;
    if (subject === undefined) throw invalidToken();
    return subject;
  };

  return {
    async signup(email, password) {
      if (users.has(email)) throw new EmailTakenError('email_taken', 'Email уже зареєстровано');
      const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
      // id — UUIDv4, як у Supabase Auth; `ids` (UUIDv7) — для доменних сутностей.
      const id = globalThis.crypto.randomUUID();
      const user: StoredUser = { id, email, salt, hash: await hashPassword(password, salt) };
      users.set(email, user);
      return issue(user);
    },

    async login(email, password) {
      const user = users.get(email);
      const hash = user === undefined ? undefined : await hashPassword(password, user.salt);
      // Невідомий email і хибний пароль — однакова відповідь (contract.md).
      if (user === undefined || hash !== user.hash) throw invalidCredentials();
      return issue(user);
    },

    async refresh(refreshToken) {
      const userId = refreshTokens.get(refreshToken);
      const user = [...users.values()].find((u) => u.id === userId);
      if (user === undefined) throw invalidToken();
      refreshTokens.delete(refreshToken);
      return issue(user);
    },

    async logout(accessToken) {
      const userId = await verify(accessToken);
      for (const [token, owner] of refreshTokens) {
        if (owner === userId) refreshTokens.delete(token);
      }
    },

    verify,
  };
}
