/**
 * `TripRepository` у пам'яті — статичний етап (spec, крит. 1). Агрегати незмінні, тож
 * зберігаються як є. `mutate` синхронна, а JS однопотоковий: зміна атомарна без блокувань —
 * той самий контракт, що `FOR UPDATE` дає в Postgres (ADR-0018).
 */
import { currentUser, log } from '../../context/index.ts';
import type { Trip, TripHeader, TripRepository } from '../../trips/index.ts';

function header(trip: Trip): TripHeader {
  const { id, ownerId, name, currency, status, closedAt, createdAt } = trip;
  return { id, ownerId, name, currency, status, closedAt, createdAt };
}

export function createMemoryTripRepository(): TripRepository {
  const trips = new Map<string, Trip>();

  return {
    create(trip) {
      trips.set(trip.id, trip);
      log.debug({ tripId: trip.id }, 'storage(memory): create');
      return Promise.resolve();
    },

    findById(id) {
      log.debug({ tripId: id }, 'storage(memory): findById');
      return Promise.resolve(trips.get(id) ?? null);
    },

    list({ limit, cursor }) {
      const owner = currentUser();
      const page = [...trips.values()]
        .filter((t) => t.ownerId === owner && (cursor === undefined || t.id < cursor))
        .sort((a, b) => (a.id < b.id ? 1 : -1))
        .slice(0, limit)
        .map(header);
      log.debug({ count: page.length }, 'storage(memory): list');
      return Promise.resolve(page);
    },

    update(id, mutate) {
      return new Promise<Trip>((resolve) => {
        const next = mutate(trips.get(id) ?? null);
        trips.set(id, next);
        log.debug({ tripId: id }, 'storage(memory): update');
        resolve(next);
      });
    },

    delete(id) {
      trips.delete(id);
      log.debug({ tripId: id }, 'storage(memory): delete');
      return Promise.resolve();
    },
  };
}
