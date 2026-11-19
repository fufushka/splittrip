/**
 * HTTP-поведінка Idempotency-Key на збоях сховища ключів (spec-fix-04, п. 2; ADR-0019).
 * Сервер складено вручну з memory-сховищем, у якому сховище ключів навмисно ламається.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createMemoryAuth } from '../../src/modules/auth/index.ts';
import { buildServer } from '../../src/modules/http/index.ts';
import { type IdempotencyStore, createIdempotency } from '../../src/modules/idempotency/index.ts';
import { createMemoryStorage } from '../../src/modules/storage/index.ts';
import { createSystemInfo } from '../../src/modules/system/index.ts';
import { createTripService } from '../../src/modules/trips/index.ts';
import { PASSWORD } from './harness.ts';

async function serverWith(store: (real: IdempotencyStore) => IdempotencyStore) {
  const storage = createMemoryStorage();
  const logs: Record<string, unknown>[] = [];
  const server = buildServer({
    system: createSystemInfo(),
    trips: createTripService({ repo: storage.trips }),
    auth: await createMemoryAuth(),
    idempotency: createIdempotency({ store: store(storage.idempotency) }),
    logStream: { write: (line) => logs.push(JSON.parse(line) as Record<string, unknown>) },
  });
  const signup = await server.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: { email: 'faults@example.com', password: PASSWORD },
  });
  const token = (JSON.parse(signup.body) as { accessToken: string }).accessToken;
  const create = (key: string) =>
    server.inject({
      method: 'POST',
      url: '/trips',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': key },
      payload: { name: 'Збій ключа', currency: 'UAH' },
    });
  return { server, logs, create };
}

describe('Idempotency-Key: збої сховища ключів', () => {
  it('збій збереження відповіді після успіху → клієнт отримує оригінальний 201', async () => {
    const { server, logs, create } = await serverWith((real) => ({
      ...real,
      complete: () => Promise.reject(new Error('БД зникла після коміту')),
    }));
    const res = await create('k-complete-fails');
    assert.equal(res.statusCode, 201, res.body);
    assert.equal(typeof (JSON.parse(res.body) as { id: unknown }).id, 'string');
    assert.ok(logs.some((l) => l.msg === 'idempotency: response not stored'));
    await server.close();
  });

  it('паралельний дубль (ключ in_progress) → 409 idempotency_in_progress', async () => {
    const { server, create } = await serverWith((real) => ({
      ...real,
      // Ключ уже зарезервовано тим самим запитом, який ще не завершився.
      reserve: (ownerId, key, requestHash, now, limits) =>
        real
          .reserve(ownerId, key, requestHash, now, limits)
          .then((existing) => existing ?? { requestHash, response: null, createdAt: now }),
    }));
    const res = await create('k-in-progress');
    assert.equal(res.statusCode, 409, res.body);
    assert.equal((JSON.parse(res.body) as { code: string }).code, 'idempotency_in_progress');
    await server.close();
  });
});
