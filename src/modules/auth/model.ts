/**
 * Порт автентифікації й помилки (ADR-0017). Реалізації: Supabase Auth і фейк для статики.
 */

export interface Session {
  readonly user: { readonly id: string; readonly email: string };
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Час життя access-токена, секунди. */
  readonly expiresIn: number;
}

export interface AuthProvider {
  signup(email: string, password: string): Promise<Session>;
  login(email: string, password: string): Promise<Session>;
  refresh(refreshToken: string): Promise<Session>;
  /** Відкликає refresh-токени користувача; access-токен діє до `exp` (ADR-0017). */
  logout(accessToken: string): Promise<void>;
  /** Перевіряє access-токен локально; повертає `sub` — id користувача. */
  verify(accessToken: string): Promise<string>;
}

export class AuthError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

/** Немає, підроблений чи прострочений токен; хибні email або пароль — однаково. */
export class UnauthorizedError extends AuthError {
  override readonly name = 'UnauthorizedError';
}

export class EmailTakenError extends AuthError {
  override readonly name = 'EmailTakenError';
}

/** Supabase Auth відхилив дані, які пройшли нашу схему (напр. слабкий пароль) → 400. */
export class AuthRejectedError extends AuthError {
  override readonly name = 'AuthRejectedError';
}

/** Supabase Auth недоступний або відповів не за контрактом (→ 503). */
export class AuthUnavailableError extends AuthError {
  override readonly name = 'AuthUnavailableError';
}

export const invalidCredentials = (): UnauthorizedError =>
  new UnauthorizedError('invalid_credentials', 'Невірний email або пароль');

export const invalidToken = (): UnauthorizedError =>
  new UnauthorizedError('invalid_token', 'Токен відсутній, недійсний або прострочений');
