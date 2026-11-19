/**
 * E2E, ідемпотентність по мережі (spec лаби 3, крит. 11; architecture.md, розд. 3): два
 * послідовні `POST /trips/:id/expenses` з одним `Idempotency-Key` і тілом → той самий `id`,
 * а `GET /trips/:id` показує одну витрату. Перевірка лише через API (ai/lab3/008, п. 3).
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { newUser, request } from './client.ts';

describe('E2E: ідемпотентність', () => {
  it('два POST /expenses з одним Idempotency-Key → той самий id і одна витрата', async () => {
    const { token } = await newUser();
    const trip = await request('POST', '/trips', {
      token,
      body: { name: 'E2E: ідемпотентність', currency: 'UAH' },
    });
    assert.equal(trip.status, 201);
    const tripId = (trip.body as { id: string }).id;

    const participant = async (name: string): Promise<string> => {
      const res = await request('POST', `/trips/${tripId}/participants`, {
        token,
        body: { name },
      });
      assert.equal(res.status, 201);
      return (res.body as { id: string }).id;
    };
    const olena = await participant('Олена');
    const petro = await participant('Петро');

    const body = {
      payerId: olena,
      amount: 5000,
      description: 'Таксі',
      split: { mode: 'equal', participantIds: [olena, petro] },
    };
    const headers = { 'idempotency-key': randomUUID() };
    const first = await request('POST', `/trips/${tripId}/expenses`, { token, body, headers });
    const second = await request('POST', `/trips/${tripId}/expenses`, { token, body, headers });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal((second.body as { id: string }).id, (first.body as { id: string }).id);

    const saved = await request('GET', `/trips/${tripId}`, { token });
    assert.equal(saved.status, 200);
    assert.equal((saved.body as { expenses: unknown[] }).expenses.length, 1);
  });
});
