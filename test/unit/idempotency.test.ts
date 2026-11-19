/**
 * Логіка Idempotency-Key з керованим годинником (ADR-0019; spec-fix-04, п. 2–3): дубль у
 * процесі, звільнення на 5xx, повтор відповіді, перезайняття покинутого ключа.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runWithContext, setCurrentUser } from '../../src/modules/context/index.ts';
import { IDEMPOTENCY_LEASE_MS, createIdempotency } from '../../src/modules/idempotency/index.ts';
import { createMemoryStorage } from '../../src/modules/storage/index.ts';

const request = { method: 'POST', url: '/trips', body: { name: 'A', currency: 'UAH' } };

function setup() {
  let now = Date.parse('2026-10-24T10:00:00Z');
  const idempotency = createIdempotency({
    store: createMemoryStorage().idempotency,
    now: () => new Date(now),
  });
  const as = <T>(fn: () => Promise<T>): Promise<T> =>
    runWithContext('test', () => {
      setCurrentUser('user-1');
      return fn();
    });
  return {
    idempotency,
    as,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('idempotency: стани ключа', () => {
  it('дубль, поки перший запит обробляється → IdempotencyInProgressError (409)', async () => {
    const { idempotency, as } = setup();
    assert.deepEqual(await as(() => idempotency.begin('k', request)), { kind: 'execute' });
    await assert.rejects(
      as(() => idempotency.begin('k', request)),
      { name: 'IdempotencyInProgressError', code: 'idempotency_in_progress' },
    );
  });

  it('після успіху повтор отримує збережену відповідь', async () => {
    const { idempotency, as } = setup();
    await as(() => idempotency.begin('k', request));
    await as(() => idempotency.finish('k', { status: 201, body: '{"id":"t1"}' }));
    assert.deepEqual(await as(() => idempotency.begin('k', request)), {
      kind: 'replay',
      response: { status: 201, body: '{"id":"t1"}' },
    });
  });

  it('5xx звільняє ключ: повтор виконується знову', async () => {
    const { idempotency, as } = setup();
    await as(() => idempotency.begin('k', request));
    await as(() => idempotency.finish('k', { status: 503, body: '{}' }));
    assert.deepEqual(await as(() => idempotency.begin('k', request)), { kind: 'execute' });
  });

  it('покинутий in_progress ключ перезаймається після lease, не раніше', async () => {
    const { idempotency, as, advance } = setup();
    await as(() => idempotency.begin('k', request));
    advance(IDEMPOTENCY_LEASE_MS - 1000);
    await assert.rejects(
      as(() => idempotency.begin('k', request)),
      {
        name: 'IdempotencyInProgressError',
      },
    );
    advance(2000);
    assert.deepEqual(await as(() => idempotency.begin('k', request)), { kind: 'execute' });
  });

  it('завершений ключ lease не перезаймає: відповідь діє весь TTL', async () => {
    const { idempotency, as, advance } = setup();
    await as(() => idempotency.begin('k', request));
    await as(() => idempotency.finish('k', { status: 201, body: '{}' }));
    advance(IDEMPOTENCY_LEASE_MS * 10);
    const again = await as(() => idempotency.begin('k', request));
    assert.equal(again.kind, 'replay');
  });
});
