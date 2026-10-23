/**
 * Публічна точка входу модуля `auth` — адаптер автентифікації (ADR-0017).
 */
export {
  AuthError,
  AuthUnavailableError,
  EmailTakenError,
  UnauthorizedError,
  invalidToken,
} from './model.ts';
export type { AuthProvider, Session } from './model.ts';
export { createMemoryAuth } from './memory.ts';
export type { MemoryAuthOptions } from './memory.ts';
