/**
 * Модульні тести `trips/domain`: видалити переказ — лише наявний і лише його (contract.md
 * лаби 2: `DELETE /trips/:id/transfers/:tid` → 204 / 404). Тести-підсилення лаби 3 (spec,
 * крит. 17; `ai/lab3/015`, п. 4): T10 за
 * `docs/specs/lab3-testing/reports/mutation-analysis.md`, розд. 6.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { money } from '../../src/modules/money/index.ts';
import { addParticipant, addTransfer, removeTransfer } from '../../src/modules/trips/domain.ts';
import type { Trip } from '../../src/modules/trips/index.ts';

function twoTransfers(): Trip {
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
  const people = addParticipant(addParticipant(empty, 'a', 'A'), 'b', 'B');
  const first = addTransfer(people, 'tr1', { fromId: 'a', toId: 'b', amount: money(50) });
  return addTransfer(first, 'tr2', { fromId: 'b', toId: 'a', amount: money(70) });
}

describe('trips/domain: removeTransfer — лише наявний і лише один переказ', () => {
  // T10: мутант #43 — `(t) => t.id === transferId` → `true` (рядок 156 за звітом «до»).
  it('неіснуючий у поїздці з переказами → NotFoundError transfer_not_found', () => {
    assert.throws(() => removeTransfer(twoTransfers(), 'zzz'), {
      name: 'NotFoundError',
      code: 'transfer_not_found',
    });
  });

  // T10: мутанти #45–49 — `filter((t) => t.id !== transferId)` (рядок 159).
  it('з двох переказів прибрано перший, другий лишається без змін', () => {
    const trip = twoTransfers();
    assert.deepEqual(removeTransfer(trip, 'tr1').transfers, trip.transfers.slice(1));
  });
});
