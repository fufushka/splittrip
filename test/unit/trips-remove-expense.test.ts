/**
 * Модульні тести `trips/domain`: видалити витрату — лише її (contract.md лаби 2:
 * `DELETE /trips/:id/expenses/:eid` → 204). Тести-підсилення лаби 3 (spec, крит. 17;
 * `ai/lab3/015`, п. 4): T9 за `docs/specs/lab3-testing/reports/mutation-analysis.md`, розд. 6.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { money } from '../../src/modules/money/index.ts';
import { addExpense, addParticipant, removeExpense } from '../../src/modules/trips/domain.ts';
import type { Trip } from '../../src/modules/trips/index.ts';

function tripWith(...ids: string[]): Trip {
  const empty: Trip = {
    id: 't',
    ownerId: 'u',
    name: 'Поїздка',
    currency: 'UAH',
    status: 'open',
    closedAt: null,
    createdAt: new Date(0),
    participants: [],
    expenses: [],
    transfers: [],
  };
  return ids.reduce((trip, id) => addParticipant(trip, id, id.toUpperCase()), empty);
}

describe('trips/domain: removeExpense — лише одна витрата', () => {
  // T9: мутанти #37, #38 — `(e) => e.id !== expenseId` → `() => undefined` / `false`
  // (рядок 140 за звітом «до»).
  it('з двох витрат прибрано першу, друга лишається без змін', () => {
    const first = addExpense(tripWith('a', 'b'), 'e1', {
      payerId: 'a',
      amount: money(100),
      description: '',
      split: { mode: 'equal', participantIds: ['a', 'b'] },
    });
    const trip = addExpense(first, 'e2', {
      payerId: 'b',
      amount: money(300),
      description: '',
      split: { mode: 'equal', participantIds: ['a', 'b'] },
    });
    assert.deepEqual(removeExpense(trip, 'e1').expenses, trip.expenses.slice(1));
  });
});
