/**
 * E2E, повний шлях (spec лаби 3, крит. 9; architecture.md, розд. 3): signup → login →
 * поїздка → 3 учасники → витрати `equal` і `exact` → баланси → пропозиція переказів →
 * перекази за нею → баланси 0 → закриття. Зібраний застосунок, справжні БД і Supabase Auth.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { newUser, request } from './client.ts';

interface Balance {
  readonly participantId: string;
  readonly amount: number;
}

interface SuggestedTransfer {
  readonly fromId: string;
  readonly toId: string;
  readonly amount: number;
}

describe('E2E: повний шлях поїздки', () => {
  it('signup → login → поїздка → учасники → витрати → перекази → баланси 0 → закриття', async () => {
    // signup 201 → login 200 через справжній Supabase Auth.
    const { token } = await newUser();
    const call = (method: string, path: string, body?: unknown) =>
      request(method, path, { token, body });

    const trip = await call('POST', '/trips', { name: 'E2E: Карпати', currency: 'UAH' });
    assert.equal(trip.status, 201);
    const tripId = (trip.body as { id: string }).id;

    const participant = async (name: string): Promise<string> => {
      const res = await call('POST', `/trips/${tripId}/participants`, { name });
      assert.equal(res.status, 201);
      return (res.body as { id: string }).id;
    };
    const anna = await participant('Анна');
    const bohdan = await participant('Богдан');
    const vira = await participant('Віра');

    const equal = await call('POST', `/trips/${tripId}/expenses`, {
      payerId: anna,
      amount: 9000,
      description: 'Житло',
      split: { mode: 'equal', participantIds: [anna, bohdan, vira] },
    });
    assert.equal(equal.status, 201);
    const exact = await call('POST', `/trips/${tripId}/expenses`, {
      payerId: bohdan,
      amount: 3000,
      description: 'Вечеря',
      split: {
        mode: 'exact',
        shares: [
          { participantId: anna, amount: 1000 },
          { participantId: bohdan, amount: 500 },
          { participantId: vira, amount: 1500 },
        ],
      },
    });
    assert.equal(exact.status, 201);

    const before = await call('GET', `/trips/${tripId}/balances`);
    assert.equal(before.status, 200);
    const balances = (before.body as { balances: Balance[] }).balances;
    assert.equal(balances.length, 3);
    assert.ok(
      balances.every((b) => b.amount !== 0),
      `баланси ≠ 0: ${JSON.stringify(balances)}`,
    );
    assert.equal(
      balances.reduce((sum, b) => sum + b.amount, 0),
      0,
    );

    const settlements = await call('GET', `/trips/${tripId}/settlements`);
    assert.equal(settlements.status, 200);
    const suggested = (settlements.body as { transfers: SuggestedTransfer[] }).transfers;
    assert.ok(suggested.length > 0, 'є хоч один запропонований переказ');
    for (const { fromId, toId, amount } of suggested) {
      const transfer = await call('POST', `/trips/${tripId}/transfers`, { fromId, toId, amount });
      assert.equal(transfer.status, 201);
    }

    const after = await call('GET', `/trips/${tripId}/balances`);
    assert.equal(after.status, 200);
    assert.deepEqual(
      (after.body as { balances: Balance[] }).balances.map((b) => b.amount),
      [0, 0, 0],
    );

    const closed = await call('POST', `/trips/${tripId}/close`);
    assert.equal(closed.status, 200);
    assert.equal((closed.body as { status: string }).status, 'closed');
  });
});
