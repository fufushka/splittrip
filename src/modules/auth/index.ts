/**
 * Публічна точка входу модуля `auth` — адаптер автентифікації (ADR-0017).
 */
export {
  AuthError,
  AuthRejectedError,
  AuthUnavailableError,
  EmailTakenError,
  UnauthorizedError,
  invalidToken,
} from './model.ts';
export type { AuthProvider, Session } from './model.ts';
export { createMemoryAuth } from './memory.ts';
export { createSupabaseAuth } from './supabase.ts';
export type { SupabaseAuthOptions } from './supabase.ts';
export type { MemoryAuthOptions } from './memory.ts';
