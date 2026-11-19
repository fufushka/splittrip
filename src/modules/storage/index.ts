/**
 * Публічна точка входу модуля `storage` — реалізації портів `TripRepository` і
 * `IdempotencyStore` (architecture.md лаби 2, розд. 1). SQL і транзакції — лише тут.
 */
import type { IdempotencyStore } from '../idempotency/index.ts';
import { SourceUnavailableError, type TripRepository } from '../trips/index.ts';
import { createMemoryIdempotencyStore } from './memory/idempotency.ts';
import { createMemoryTripRepository } from './memory/trips.ts';
import { type PostgresConfig, connect } from './postgres/client.ts';
import { createPostgresIdempotencyStore } from './postgres/idempotency.ts';
import { createPostgresTripRepository } from './postgres/trips.ts';

export { MigrationError, migrate } from './migrate.ts';
export type { PostgresConfig } from './postgres/client.ts';
export { connect } from './postgres/client.ts';

export interface Storage {
  readonly trips: TripRepository;
  readonly idempotency: IdempotencyStore;
  /** Перевірка готовності джерела для `/ready`; кидає `SourceUnavailableError` з `trips`. */
  ping(): Promise<void>;
  close(): Promise<void>;
}

export function createMemoryStorage(): Storage {
  return {
    trips: createMemoryTripRepository(),
    idempotency: createMemoryIdempotencyStore(),
    ping: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
}

/**
 * Пул і явна перевірка `SELECT now()` на старті: недоступна БД — помилка одразу, а не на
 * першому запиті клієнта (рекомендація лаби; spec «Збої», крит. 9).
 */
export async function createPostgresStorage(config: PostgresConfig): Promise<Storage> {
  const sql = connect(config);
  const ping = async (): Promise<void> => {
    await sql`select now()`.catch((error: unknown) => {
      throw new SourceUnavailableError('БД не відповідає на select now()', { cause: error });
    });
  };
  await ping().catch(async (error: unknown) => {
    await sql.end({ timeout: 1 });
    throw error;
  });
  return {
    trips: createPostgresTripRepository(sql),
    idempotency: createPostgresIdempotencyStore(sql),
    ping,
    close: () => sql.end({ timeout: 5 }),
  };
}
