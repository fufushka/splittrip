/**
 * `IdempotencyStore` на таблиці `idempotency_keys` (ADR-0019). Резервування атомарне за
 * PK `(owner_id, key)`: з двох паралельних дублів вставку виграє один, другий бачить
 * `in_progress` і отримує `409`.
 */
import type { IdempotencyRecord, IdempotencyStore } from '../../idempotency/index.ts';
import { type Sql, transaction } from './client.ts';

interface KeyRow {
  request_hash: string;
  status: number | null;
  response: string | null;
  created_at: Date;
}

export function createPostgresIdempotencyStore(sql: Sql): IdempotencyStore {
  return {
    reserve(ownerId, key, requestHash, now, expiredBefore) {
      return transaction(sql, async (tx): Promise<IdempotencyRecord | null> => {
        await tx`delete from idempotency_keys
                  where owner_id = ${ownerId} and key = ${key} and created_at < ${expiredBefore}`;
        const inserted = await tx`
          insert into idempotency_keys (owner_id, key, request_hash, created_at)
          values (${ownerId}, ${key}, ${requestHash}, ${now})
          on conflict (owner_id, key) do nothing
          returning 1`;
        if (inserted.length > 0) return null;
        const [row] = await tx<KeyRow[]>`
          select request_hash, status, response, created_at
            from idempotency_keys where owner_id = ${ownerId} and key = ${key}`;
        if (row === undefined) throw new Error('Інваріант: ключ мав існувати після конфлікту');
        return {
          requestHash: row.request_hash,
          response:
            row.status === null || row.response === null
              ? null
              : { status: row.status, body: row.response },
          createdAt: row.created_at,
        };
      });
    },

    async complete(ownerId, key, response) {
      await transaction(sql, async (tx) => {
        await tx`update idempotency_keys set status = ${response.status}, response = ${response.body}
                  where owner_id = ${ownerId} and key = ${key}`;
      });
    },

    async release(ownerId, key) {
      await transaction(sql, async (tx) => {
        await tx`delete from idempotency_keys where owner_id = ${ownerId} and key = ${key}`;
      });
    },
  };
}
