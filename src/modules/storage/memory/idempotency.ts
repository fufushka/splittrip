/**
 * `IdempotencyStore` у пам'яті (ADR-0019): та сама семантика резервування, що й таблиця
 * `idempotency_keys` з PK `(owner_id, key)`.
 */
import type { IdempotencyRecord, IdempotencyStore } from '../../idempotency/index.ts';

export function createMemoryIdempotencyStore(): IdempotencyStore {
  const records = new Map<string, IdempotencyRecord>();
  const id = (ownerId: string, key: string): string => `${ownerId}\u0000${key}`;

  return {
    reserve(ownerId, key, requestHash, now, expiredBefore) {
      const existing = records.get(id(ownerId, key));
      if (existing !== undefined && existing.createdAt >= expiredBefore) {
        return Promise.resolve(existing);
      }
      records.set(id(ownerId, key), { requestHash, response: null, createdAt: now });
      return Promise.resolve(null);
    },

    complete(ownerId, key, response) {
      const existing = records.get(id(ownerId, key));
      if (existing !== undefined) records.set(id(ownerId, key), { ...existing, response });
      return Promise.resolve();
    },

    release(ownerId, key) {
      records.delete(id(ownerId, key));
      return Promise.resolve();
    },
  };
}
