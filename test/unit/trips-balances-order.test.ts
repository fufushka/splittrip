/**
 * Модульні тести `trips/domain`: баланси — за порядком додавання учасників (`position`),
 * а не за порядком масиву, який віддало сховище (порт `TripRepository` порядку не обіцяє);
 * на цьому порядку тримається тай-брейк розрахунку «за рівності — за `position`» (ADR-0011).
 * Тести-підсилення лаби 3 (spec, крит. 17; `ai/lab3/015`, п. 4): T11 за
 * `docs/specs/lab3-testing/reports/mutation-analysis.md`, розд. 6 (спірне С2).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { balancesOf } from '../../src/modules/trips/domain.ts';
import type { Trip } from '../../src/modules/trips/index.ts';

describe('trips/domain: balancesOf — порядок за position', () => {
  // T11: мутанти #50, #51 — прибрано `.sort(…)` / `a.position - b.position` → `+`
  // (рядок 164 за звітом «до»).
  it('учасники [B (2), A (1)] → баланси [A, B]', () => {
    const trip: Trip = {
      id: 't',
      ownerId: 'u',
      name: 'Поїздка',
      currency: 'UAH',
      status: 'open',
      closedAt: null,
      createdAt: new Date(0),
      participants: [
        { id: 'b', name: 'B', position: 2 },
        { id: 'a', name: 'A', position: 1 },
      ],
      expenses: [],
      transfers: [],
    };
    assert.deepEqual(
      balancesOf(trip).map((b) => b.participantId),
      ['a', 'b'],
    );
  });
});
