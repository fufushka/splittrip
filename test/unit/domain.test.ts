/**
 * Модульні тести чистих модулів: `ids` (монотонність UUIDv7), `money` (ADR-0010),
 * `balances` (ADR-0011, ADR-0012).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { computeBalances, suggestTransfers } from '../../src/modules/balances/index.ts';
import { isUuid, uuidv7 } from '../../src/modules/ids/index.ts';
import { type Money, allocateEqually, money, sum } from '../../src/modules/money/index.ts';

const m = (values: number[]): Money[] => values.map(money);

describe('ids: UUIDv7', () => {
  it('формат RFC 9562: версія 7, варіант 10', () => {
    const id = uuidv7();
    assert.ok(isUuid(id));
    assert.equal(id[14], '7');
    assert.match(id[19] ?? '', /[89ab]/);
  });

  it('монотонні в межах однієї мілісекунди й при відставанні годинника', () => {
    const now = Date.now();
    const ids = [
      ...Array.from({ length: 5000 }, () => uuidv7(now)),
      ...Array.from({ length: 10 }, () => uuidv7(now - 1000)),
    ];
    const sorted = [...ids].sort();
    assert.deepEqual(ids, sorted);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe('money: allocateEqually (ADR-0010)', () => {
  it('10000 на 3 → [3334, 3333, 3333]', () => {
    assert.deepEqual(allocateEqually(money(10000), 3), m([3334, 3333, 3333]));
  });

  it('Σ часток = сума для різних входів (I1)', () => {
    for (let amount = 1; amount <= 2000; amount += 37) {
      for (let parts = 1; parts <= 13; parts++) {
        const shares = allocateEqually(money(amount), parts);
        assert.equal(sum(shares), amount);
        assert.ok(Math.max(...shares) - Math.min(...shares) <= 1);
      }
    }
  });

  it('дробові суми й нецілі частки відхиляються', () => {
    assert.throws(() => money(1.5), RangeError);
    assert.throws(() => allocateEqually(money(100), 0), RangeError);
  });
});

describe('balances: computeBalances і suggestTransfers', () => {
  const ids = ['a', 'b', 'c', 'd'];

  it('Σ балансів = 0 (I2); переказ зменшує борг', () => {
    const balances = computeBalances(
      ids,
      [
        {
          payerId: 'a',
          amount: money(900),
          shares: [
            { participantId: 'a', amount: money(300) },
            { participantId: 'b', amount: money(300) },
            { participantId: 'c', amount: money(300) },
          ],
        },
      ],
      [{ fromId: 'b', toId: 'a', amount: money(100) }],
    );
    assert.deepEqual(
      balances.map((b) => b.amount),
      [500, -200, -300, 0],
    );
    assert.equal(sum(balances.map((b) => b.amount)), 0);
  });

  it('жадібний розрахунок обнуляє всі баланси, не більше n − 1 переказу (ADR-0011)', () => {
    const balances = [
      { participantId: 'a', amount: money(700) },
      { participantId: 'b', amount: money(-400) },
      { participantId: 'c', amount: money(-200) },
      { participantId: 'd', amount: money(-100) },
    ];
    const transfers = suggestTransfers(balances);
    assert.ok(transfers.length <= 3);
    const after = computeBalances(ids, [], transfers);
    assert.deepEqual(
      after.map((b, i) => b.amount + (balances[i]?.amount ?? 0)),
      [0, 0, 0, 0],
    );
  });
});
