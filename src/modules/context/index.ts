/**
 * Публічна точка входу модуля `context` — контекст запиту без протягування параметрів
 * (ADR-0016). `http` відкриває контекст один раз на запит; будь-який рівень читає
 * ініціатора й пише логи, у які `processId` і `userId` потрапляють автоматично.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  readonly processId: string;
  userId: string | undefined;
}

/** Структурний логер (сумісний з pino): поля першим аргументом, повідомлення — другим. */
export interface Logger {
  debug(fields: object, message?: string): void;
  info(fields: object, message?: string): void;
  warn(fields: object, message?: string): void;
  error(fields: object, message?: string): void;
}

/** Код викликано поза запитом — помилка програміста, а не клієнта (→ 500). */
export class MissingContextError extends Error {
  override readonly name = 'MissingContextError';
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(processId: string, fn: () => T): T {
  return storage.run({ processId, userId: undefined }, fn);
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Фіксує ініціатора після перевірки JWT (`http` → `auth`). */
export function setCurrentUser(userId: string): void {
  const context = storage.getStore();
  if (context === undefined) throw new MissingContextError('setCurrentUser поза запитом');
  context.userId = userId;
}

/** Ініціатор поточного запиту. Кидає, якщо запит не автентифіковано. */
export function currentUser(): string {
  const userId = storage.getStore()?.userId;
  if (userId === undefined) throw new MissingContextError('Немає ініціатора в контексті');
  return userId;
}

/** Поля контексту для pino `mixin`: додаються до кожного рядка логу. */
export function logFields(): Record<string, string> {
  const context = storage.getStore();
  if (context === undefined) return {};
  return context.userId === undefined
    ? { processId: context.processId }
    : { processId: context.processId, userId: context.userId };
}

const ignore = (): void => undefined;
const silent: Logger = { debug: ignore, info: ignore, warn: ignore, error: ignore };
let root: Logger = silent;

/** Кореневий логер процесу; задає `http` логером Fastify з `mixin: logFields`. */
export function setLogger(logger: Logger): void {
  root = logger;
}

/** Логер для будь-якого рівня: делегує поточному кореневому. */
export const log: Logger = {
  debug: (fields, message) => {
    root.debug(fields, message);
  },
  info: (fields, message) => {
    root.info(fields, message);
  },
  warn: (fields, message) => {
    root.warn(fields, message);
  },
  error: (fields, message) => {
    root.error(fields, message);
  },
};
