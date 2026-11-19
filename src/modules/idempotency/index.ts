/**
 * Публічна точка входу модуля `idempotency` — повтори `POST /trips*` з `Idempotency-Key`
 * (ADR-0019). Логіка рішення тут; сховище ключів — порт, реалізації в `storage`.
 */
import { createHash } from 'node:crypto';

import { currentUser } from '../context/index.ts';

export interface StoredResponse {
  readonly status: number;
  readonly body: string;
}

export interface IdempotencyRecord {
  readonly requestHash: string;
  /** `null` — запит ще обробляється. */
  readonly response: StoredResponse | null;
  readonly createdAt: Date;
}

/** Порт сховища ключів; ключ унікальний у межах власника. */
export interface IdempotencyStore {
  /**
   * Атомарно резервує ключ (`in_progress`). Наявний запис повертає без змін, крім двох
   * випадків, коли замінює його: створений раніше за `expiredBefore` (TTL) або ще
   * `in_progress`, але створений раніше за `abandonedBefore` — запит покинуто (spec-fix-04, п. 3).
   */
  reserve(
    ownerId: string,
    key: string,
    requestHash: string,
    now: Date,
    limits: { readonly expiredBefore: Date; readonly abandonedBefore: Date },
  ): Promise<IdempotencyRecord | null>;
  complete(ownerId: string, key: string, response: StoredResponse): Promise<void>;
  release(ownerId: string, key: string): Promise<void>;
}

export class IdempotencyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Той самий ключ ще обробляється (паралельний дубль). */
export class IdempotencyInProgressError extends IdempotencyError {
  override readonly name = 'IdempotencyInProgressError';
}

/** Той самий ключ з іншим запитом — помилка клієнта, не маскуємо її повтором. */
export class IdempotencyMismatchError extends IdempotencyError {
  override readonly name = 'IdempotencyMismatchError';
}

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/** `in_progress` довше за це — процес упав або збереження відповіді не вдалося. */
export const IDEMPOTENCY_LEASE_MS = 60 * 1000;

export type BeginResult =
  { readonly kind: 'execute' } | { readonly kind: 'replay'; readonly response: StoredResponse };

export interface Idempotency {
  begin(key: string, request: { method: string; url: string; body: unknown }): Promise<BeginResult>;
  /** 2xx–4xx зберігаються; 5xx звільняють ключ для ретраю. */
  finish(key: string, response: StoredResponse): Promise<void>;
}

export interface IdempotencyDeps {
  readonly store: IdempotencyStore;
  readonly now?: () => Date;
}

export function requestHash(request: { method: string; url: string; body: unknown }): string {
  return createHash('sha256')
    .update(`${request.method} ${request.url}\n${JSON.stringify(request.body ?? null)}`)
    .digest('hex');
}

export function createIdempotency({ store, now = () => new Date() }: IdempotencyDeps): Idempotency {
  return {
    async begin(key, request) {
      const hash = requestHash(request);
      const at = now();
      const existing = await store.reserve(currentUser(), key, hash, at, {
        expiredBefore: new Date(at.getTime() - IDEMPOTENCY_TTL_MS),
        abandonedBefore: new Date(at.getTime() - IDEMPOTENCY_LEASE_MS),
      });
      if (existing === null) return { kind: 'execute' };
      if (existing.requestHash !== hash) {
        throw new IdempotencyMismatchError(
          'idempotency_key_reused',
          'Idempotency-Key уже використано з іншим запитом',
        );
      }
      if (existing.response === null) {
        throw new IdempotencyInProgressError(
          'idempotency_in_progress',
          'Запит з цим Idempotency-Key ще обробляється',
        );
      }
      return { kind: 'replay', response: existing.response };
    },

    async finish(key, response) {
      if (response.status >= 500) await store.release(currentUser(), key);
      else await store.complete(currentUser(), key, response);
    },
  };
}
