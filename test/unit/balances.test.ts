/**
 * Модульні тести `balances` (ADR-0011, ADR-0012): тести-підсилення лаби 3 (spec, крит. 17) і
 * повне покриття (крит. 2, 3, 14; spec-fix-01) за
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

  // T2: мутанти #3 (прибрано `.sort(…)`), #4 (`||` → `&&`) і #5 (`|y| − |x|` → `+`) у
  // компараторі `pick` (рядки 72, 74 за звітом «до»): з ними `pick` бере першого за порядком.
  it('найбільший боржник платить найбільшому кредитору, а не першому в списку', () => {
    const balances = [
      { participantId: 'a', amount: money(10) },
      { participantId: 'b', amount: money(20) },
      { participantId: 'c', amount: money(-20) },
      { participantId: 'd', amount: money(-10) },
    ];
    assert.deepEqual(suggestTransfers(balances), [
      { fromId: 'c', toId: 'b', amount: money(20) },
      { fromId: 'd', toId: 'a', amount: money(10) },
    ]);
  });
});

describe('balances: computeBalances (ADR-0012)', () => {
  // T3: гілка `?? ZERO` у `shift` (рядок 42) — єдиний тест, що її покриває (spec-fix-01, п. 1);
  // через API недосяжна: домен відхиляє невідомого платника з 422.
  it('платник поза списком учасників не потрапляє в результат, частка учасника — так', () => {
    const balances = computeBalances(
      ['a'],
      [{ payerId: 'x', amount: money(100), shares: [{ participantId: 'a', amount: money(100) }] }],
      [],
    );
    assert.deepEqual(balances, [{ participantId: 'a', amount: money(-100) }]);
  });
});
