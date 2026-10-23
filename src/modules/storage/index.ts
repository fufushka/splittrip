/**
 * Публічна точка входу модуля `storage` — реалізації портів `TripRepository` і
 * `IdempotencyStore` (architecture.md лаби 2, розд. 1). SQL і транзакції — лише тут.
 */
import type { IdempotencyStore } from '../idempotency/index.ts';
import type { TripRepository } from '../trips/index.ts';
import { createMemoryIdempotencyStore } from './memory/idempotency.ts';
import { createMemoryTripRepository } from './memory/trips.ts';

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
