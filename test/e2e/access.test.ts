/**
 * E2E, доступ (spec лаби 3, крит. 10; architecture.md, розд. 3): чужа поїздка → 404 на
 * читання й зміну; refresh-токен після `logout` → 401 (spec-fix-02 лаби 2, п. 3).
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { type User, newUser, request } from './client.ts';

describe('E2E: доступ', () => {
  let owner: User;
  let stranger: User;
  let tripId: string;

  before(async () => {
    [owner, stranger] = await Promise.all([newUser(), newUser()]);
    const trip = await request('POST', '/trips', {
      token: owner.token,
      body: { name: 'E2E: чужа поїздка', currency: 'UAH' },
    });
    assert.equal(trip.status, 201);
    tripId = (trip.body as { id: string }).id;
  });

  it('користувач Б: чужа поїздка → 404 на GET і на додавання учасника', async () => {
    const read = await request('GET', `/trips/${tripId}`, { token: stranger.token });
    assert.equal(read.status, 404);
    const write = await request('POST', `/trips/${tripId}/participants`, {
      token: stranger.token,
      body: { name: 'Чужий' },
    });
    assert.equal(write.status, 404);
  });

  it('користувач А: logout 204 → refresh старим refresh-токеном 401', async () => {
    const logout = await request('POST', '/auth/logout', { token: owner.token });
    assert.equal(logout.status, 204);
    const refresh = await request('POST', '/auth/refresh', {
      body: { refreshToken: owner.refreshToken },
    });
    assert.equal(refresh.status, 401);
  });
});
