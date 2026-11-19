/**
 * Модульні тести `balances` (ADR-0011): тести-підсилення лаби 3 (spec, крит. 17) за
 * `docs/specs/lab3-testing/reports/mutation-analysis.md`, розд. 6.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { computeBalances, suggestTransfers } from '../../src/modules/balances/index.ts';
import { money } from '../../src/modules/money/index.ts';

describe('balances: suggestTransfers, кілька кредиторів (ADR-0011)', () => {
  // T1: мутант #7 — `creditor.amount -= amount` → `+=` (рядок 84 за звітом «до»).
  it('кожен кредитор отримує рівно свій баланс; після переказів усі баланси 0', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const balances = [
      { participantId: 'a', amount: money(60) },
      { participantId: 'b', amount: money(40) },
      { participantId: 'c', amount: money(-50) },
      { participantId: 'd', amount: money(-50) },
    ];
    const transfers = suggestTransfers(balances);
    assert.deepEqual(transfers, [
      { fromId: 'c', toId: 'a', amount: money(50) },
      { fromId: 'd', toId: 'b', amount: money(40) },
      { fromId: 'd', toId: 'a', amount: money(10) },
    ]);
    const after = computeBalances(ids, [], transfers);
    assert.deepEqual(
      after.map((b, i) => b.amount + (balances[i]?.amount ?? 0)),
      [0, 0, 0, 0],
    );
  });
});
