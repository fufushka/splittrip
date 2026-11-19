/**
 * Модульні тести `trips/domain`: учасник, згаданий у витраті чи переказі, не видаляється
 * (I5, architecture.md лаби 1, розд. 4; contract.md лаби 2 — 409). Тести-підсилення лаби 3
 * (spec, крит. 17; `ai/lab3/015`, п. 4): T6 за
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

const inUse = { name: 'ConflictError', code: 'participant_in_use' };

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

describe('trips/domain: removeParticipant — згаданого учасника не прибирають (I5)', () => {
  // Мутанти #22, #23 — `t.toId === participantId` → `false` / `!==` (рядок 66 за звітом «до»).
  it('лише отримувач переказу → ConflictError participant_in_use', () => {
    const trip = addTransfer(tripWith('a', 'b'), 'tr', {
      fromId: 'a',
      toId: 'b',
      amount: money(100),
    });
    assert.throws(() => removeParticipant(trip, 'b'), inUse);
  });

  // Мутанти #17, #18 — `e.payerId === participantId` → `false` / `!==` (рядок 65).
  it('лише платник витрати, без власної частки → ConflictError participant_in_use', () => {
    const trip = addExpense(tripWith('a', 'b'), 'e', {
      payerId: 'a',
      amount: money(100),
      description: '',
      split: { mode: 'exact', shares: [{ participantId: 'b', amount: money(100) }] },
    });
    assert.throws(() => removeParticipant(trip, 'a'), inUse);
  });

  // Мутант #19 — `e.shares.some(…)` → `e.shares.every(…)` (рядок 65).
  it('учасник однієї з кількох часток → ConflictError participant_in_use', () => {
    const trip = addExpense(tripWith('a', 'b'), 'e', {
      payerId: 'a',
      amount: money(100),
      description: '',
      split: { mode: 'equal', participantIds: ['a', 'b'] },
    });
    assert.throws(() => removeParticipant(trip, 'b'), inUse);
  });
});
