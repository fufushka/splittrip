/**
 * Модульні тести `trips/domain`: прибрати учасника — рівно одного й лише наявного
 * (contract.md лаби 2: `DELETE /trips/:id/participants/:pid` → 204 / 404). Тести-підсилення
 * лаби 3 (spec, крит. 17; `ai/lab3/015`, п. 4): T7, T8 за
 * `docs/specs/lab3-testing/reports/mutation-analysis.md`, розд. 6.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { money } from '../../src/modules/money/index.ts';
import {
  addExpense,
  addParticipant,
  addTransfer,
  removeParticipant,
} from '../../src/modules/trips/domain.ts';
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

describe('trips/domain: removeParticipant — рівно один учасник', () => {
  // T7: мутанти #16, #20, #21 — предикати «згаданий» (рядки 65–66) → `true`; #25–29 —
  // `filter((p) => p.id !== participantId)` (рядок 70 за звітом «до»).
  it('незгаданого прибрано, решта учасників лишається без змін', () => {
    const withExpense = addExpense(tripWith('a', 'b', 'c'), 'e', {
      payerId: 'a',
      amount: money(100),
      description: '',
      split: { mode: 'equal', participantIds: ['a', 'b'] },
    });
    const trip = addTransfer(withExpense, 'tr', { fromId: 'b', toId: 'a', amount: money(50) });
    assert.deepEqual(removeParticipant(trip, 'c').participants, [
      { id: 'a', name: 'A', position: 1 },
      { id: 'b', name: 'B', position: 2 },
    ]);
  });

  // T8: мутанти #13, #14 — `(p) => p.id === participantId` → `true` / `!==` (рядок 60).
  it('неіснуючий у поїздці з учасниками → NotFoundError participant_not_found', () => {
    assert.throws(() => removeParticipant(tripWith('a'), 'zzz'), {
      name: 'NotFoundError',
      code: 'participant_not_found',
    });
  });

  it('єдиного учасника прибрано', () => {
    assert.deepEqual(removeParticipant(tripWith('a'), 'a').participants, []);
  });
});
