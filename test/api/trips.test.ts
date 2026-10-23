/**
 * Сценарії «Функціоналу продукту» через API (contract.md, розд. 1; spec, крит. 1): успіх і
 * кожна помилка з таблиці контракту.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { type Harness, type Reply, type User, field, startHarness } from './harness.ts';

let h: Harness;
let me: User;
before(async () => {
  h = await startHarness();
  me = await h.user();
});
after(() => h.close());

const NO_SUCH = '01900000-0000-7000-8000-000000000000';

const as = (method: string, url: string, body?: unknown): Promise<Reply> =>
  h.call(method, url, body === undefined ? { token: me.token } : { token: me.token, body });

async function trip(name = 'Карпати'): Promise<string> {
  const res = await as('POST', '/trips', { name, currency: 'UAH' });
  assert.equal(res.status, 201, res.text);
  return field<string>(res, 'id');
}

async function participant(tripId: string, name: string): Promise<string> {
  const res = await as('POST', `/trips/${tripId}/participants`, { name });
  assert.equal(res.status, 201, res.text);
  return field<string>(res, 'id');
}

function assertProblem(res: Reply, status: number, code: string): void {
  assert.equal(res.status, status, res.text);
  assert.match(String(res.headers['content-type']), /^application\/problem\+json/);
  assert.equal(field(res, 'code'), code);
  assert.equal(field(res, 'status'), status);
}

describe('поїздки: створення, список, перегляд, видалення', () => {
  it('POST /trips → 201 відкрита поїздка без учасників', async () => {
    const res = await as('POST', '/trips', { name: 'Львів', currency: 'EUR' });
    assert.equal(res.status, 201);
    assert.equal(field(res, 'status'), 'open');
    assert.equal(field(res, 'closedAt'), null);
    assert.deepEqual(field(res, 'participants'), []);
    assert.equal(field(res, 'ownerId'), undefined, 'ownerId не віддається клієнту');
  });

  it('POST /trips з порожньою назвою, невідомою валютою чи зайвим полем → 400', async () => {
    for (const body of [
      { name: '   ', currency: 'UAH' },
      { name: 'x'.repeat(101), currency: 'UAH' },
      { name: 'Ок', currency: 'XYZ' },
      { name: 'Ок', currency: 'uah' },
      { name: 'Ок' },
      { name: 'Ок', currency: 'UAH', status: 'closed' },
    ]) {
      assertProblem(await as('POST', '/trips', body), 400, 'validation_failed');
    }
  });

  it('GET /trips — лише свої, новіші першими, з курсором', async () => {
    const user = await h.user();
    const mine = (url: string) => h.call('GET', url, { token: user.token });
    const ids: string[] = [];
    for (const name of ['a', 'b', 'c']) {
      const res = await h.call('POST', '/trips', {
        token: user.token,
        body: { name, currency: 'UAH' },
      });
      ids.push(field<string>(res, 'id'));
    }
    const first = await mine('/trips?limit=2');
    assert.equal(first.status, 200);
    assert.deepEqual(
      field<{ id: string }[]>(first, 'items').map((t) => t.id),
      [ids[2], ids[1]],
    );
    const cursor = field<string>(first, 'nextCursor');
    const second = await mine(`/trips?limit=2&cursor=${cursor}`);
    assert.deepEqual(
      field<{ id: string }[]>(second, 'items').map((t) => t.id),
      [ids[0]],
    );
    assert.equal(field(second, 'nextCursor'), null);
  });

  it('GET /trips з limit поза 1–100 чи некоректним курсором → 400', async () => {
    for (const query of ['limit=0', 'limit=101', 'limit=abc', 'cursor=nope', 'extra=1']) {
      assertProblem(await as('GET', `/trips?${query}`), 400, 'validation_failed');
    }
  });

  it('GET /trips/:id → агрегат з учасниками, витратами й переказами', async () => {
    const id = await trip();
    const a = await participant(id, 'Аня');
    const b = await participant(id, 'Богдан');
    await as('POST', `/trips/${id}/expenses`, {
      payerId: a,
      amount: 1000,
      split: { mode: 'equal', participantIds: [a, b] },
    });
    await as('POST', `/trips/${id}/transfers`, { fromId: b, toId: a, amount: 500 });
    const res = await as('GET', `/trips/${id}`);
    assert.equal(res.status, 200);
    assert.equal(field<unknown[]>(res, 'participants').length, 2);
    assert.equal(field<unknown[]>(res, 'expenses', 0, 'shares').length, 2);
    assert.equal(field<unknown[]>(res, 'transfers').length, 1);
  });

  it('GET /trips/:id неіснуючої → 404; некоректний id → 400', async () => {
    assertProblem(await as('GET', `/trips/${NO_SUCH}`), 404, 'trip_not_found');
    assertProblem(await as('GET', '/trips/not-a-uuid'), 400, 'validation_failed');
  });

  it('DELETE /trips/:id → 204 для відкритої й закритої; потім 404', async () => {
    const open = await trip();
    assert.equal((await as('DELETE', `/trips/${open}`)).status, 204);
    assertProblem(await as('GET', `/trips/${open}`), 404, 'trip_not_found');
    assertProblem(await as('DELETE', `/trips/${open}`), 404, 'trip_not_found');

    const closed = await trip();
    assert.equal((await as('POST', `/trips/${closed}/close`)).status, 200);
    assert.equal((await as('DELETE', `/trips/${closed}`)).status, 204);
  });
});

describe('учасники', () => {
  it('додати → 201 з position за порядком; прибрати незгаданого → 204', async () => {
    const id = await trip();
    const a = await as('POST', `/trips/${id}/participants`, { name: 'Аня' });
    const b = await as('POST', `/trips/${id}/participants`, { name: 'Богдан' });
    assert.equal(field(a, 'position'), 1);
    assert.equal(field(b, 'position'), 2);
    const res = await as('DELETE', `/trips/${id}/participants/${field<string>(b, 'id')}`);
    assert.equal(res.status, 204);
  });

  it('порожнє ім’я → 400; неіснуючий учасник → 404', async () => {
    const id = await trip();
    assertProblem(
      await as('POST', `/trips/${id}/participants`, { name: '' }),
      400,
      'validation_failed',
    );
    assertProblem(
      await as('DELETE', `/trips/${id}/participants/${NO_SUCH}`),
      404,
      'participant_not_found',
    );
  });

  it('прибрати згаданого у витраті чи переказі → 409 participant_in_use (I5)', async () => {
    const id = await trip();
    const a = await participant(id, 'Аня');
    const b = await participant(id, 'Богдан');
    const c = await participant(id, 'Віра');
    await as('POST', `/trips/${id}/expenses`, {
      payerId: a,
      amount: 100,
      split: { mode: 'exact', shares: [{ participantId: b, amount: 100 }] },
    });
    await as('POST', `/trips/${id}/transfers`, { fromId: c, toId: a, amount: 1 });
    for (const pid of [a, b, c]) {
      assertProblem(
        await as('DELETE', `/trips/${id}/participants/${pid}`),
        409,
        'participant_in_use',
      );
    }
  });
});

describe('витрати', () => {
  it('поділ порівну: залишкові копійки — першим за порядком додавання (ADR-0010)', async () => {
    const id = await trip();
    const a = await participant(id, 'Аня');
    const b = await participant(id, 'Богдан');
    const c = await participant(id, 'Віра');
    const res = await as('POST', `/trips/${id}/expenses`, {
      payerId: a,
      amount: 10000,
      description: 'Хатинка',
      // Порядок у запиті не впливає на розподіл залишку.
      split: { mode: 'equal', participantIds: [c, b, a] },
    });
    assert.equal(res.status, 201);
    assert.deepEqual(field(res, 'shares'), [
      { participantId: a, amount: 3334 },
      { participantId: b, amount: 3333 },
      { participantId: c, amount: 3333 },
    ]);
    assert.equal(field(res, 'splitMode'), 'equal');
  });

  it('точні частки; платник може не входити в поділ', async () => {
    const id = await trip();
    const a = await participant(id, 'Аня');
    const b = await participant(id, 'Богдан');
    const res = await as('POST', `/trips/${id}/expenses`, {
      payerId: a,
      amount: 700,
      split: { mode: 'exact', shares: [{ participantId: b, amount: 700 }] },
    });
    assert.equal(res.status, 201);
    assert.equal(field(res, 'description'), '');
  });

  it('Σ часток ≠ сумі → 422 shares_sum_mismatch (I1)', async () => {
    const id = await trip();
    const a = await participant(id, 'Аня');
    const res = await as('POST', `/trips/${id}/expenses`, {
      payerId: a,
      amount: 700,
      split: { mode: 'exact', shares: [{ participantId: a, amount: 699 }] },
    });
    assertProblem(res, 422, 'shares_sum_mismatch');
  });

  it('чужий учасник (платник чи частка) → 422 unknown_participant (I3)', async () => {
    const id = await trip();
    const other = await trip('Інша');
    const a = await participant(id, 'Аня');
    const stranger = await participant(other, 'Чужий');
    for (const body of [
      { payerId: stranger, amount: 100, split: { mode: 'equal', participantIds: [a] } },
      { payerId: a, amount: 100, split: { mode: 'equal', participantIds: [a, stranger] } },
    ]) {
      assertProblem(await as('POST', `/trips/${id}/expenses`, body), 422, 'unknown_participant');
    }
  });

  it('дубль учасника в поділі → 422 duplicate_participant', async () => {
    const id = await trip();
    const a = await participant(id, 'Аня');
    const res = await as('POST', `/trips/${id}/expenses`, {
      payerId: a,
      amount: 100,
      split: { mode: 'equal', participantIds: [a, a] },
    });
    assertProblem(res, 422, 'duplicate_participant');
  });

  it('некоректна форма: сума 0, дробова, рядком, булева; невідомий mode → 400', async () => {
    const id = await trip();
    const a = await participant(id, 'Аня');
    for (const amount of [0, -1, 1.5, '100', true, 10_000_000_001]) {
      const res = await as('POST', `/trips/${id}/expenses`, {
        payerId: a,
        amount,
        split: { mode: 'equal', participantIds: [a] },
      });
      assertProblem(res, 400, 'validation_failed');
    }
    const res = await as('POST', `/trips/${id}/expenses`, {
      payerId: a,
      amount: 100,
      split: { mode: 'percent', participantIds: [a] },
    });
    assertProblem(res, 400, 'validation_failed');
  });

  it('PUT → 200, частки перераховано; неіснуюча витрата → 404', async () => {
    const id = await trip();
    const a = await participant(id, 'Аня');
    const b = await participant(id, 'Богдан');
    const created = await as('POST', `/trips/${id}/expenses`, {
      payerId: a,
      amount: 100,
      split: { mode: 'equal', participantIds: [a] },
    });
    const eid = field<string>(created, 'id');
    const res = await as('PUT', `/trips/${id}/expenses/${eid}`, {
      payerId: b,
      amount: 301,
      description: 'Виправлено',
      split: { mode: 'equal', participantIds: [a, b] },
    });
    assert.equal(res.status, 200);
    assert.equal(field(res, 'id'), eid);
    assert.deepEqual(field(res, 'shares'), [
      { participantId: a, amount: 151 },
      { participantId: b, amount: 150 },
    ]);
    const missing = await as('PUT', `/trips/${id}/expenses/${NO_SUCH}`, {
      payerId: a,
      amount: 1,
      split: { mode: 'equal', participantIds: [a] },
    });
    assertProblem(missing, 404, 'expense_not_found');
  });

  it('DELETE → 204; повторно → 404', async () => {
    const id = await trip();
    const a = await participant(id, 'Аня');
    const created = await as('POST', `/trips/${id}/expenses`, {
      payerId: a,
      amount: 100,
      split: { mode: 'equal', participantIds: [a] },
    });
    const url = `/trips/${id}/expenses/${field<string>(created, 'id')}`;
    assert.equal((await as('DELETE', url)).status, 204);
    assertProblem(await as('DELETE', url), 404, 'expense_not_found');
  });
});

describe('перекази, баланси, розрахунок, закриття', () => {
  it('сценарій повністю: витрата → баланси → пропозиції → перекази → закриття', async () => {
    const id = await trip();
    const a = await participant(id, 'Аня');
    const b = await participant(id, 'Богдан');
    const c = await participant(id, 'Віра');
    await as('POST', `/trips/${id}/expenses`, {
      payerId: a,
      amount: 9000,
      split: { mode: 'equal', participantIds: [a, b, c] },
    });

    const balances = await as('GET', `/trips/${id}/balances`);
    assert.deepEqual(field(balances, 'balances'), [
      { participantId: a, amount: 6000 },
      { participantId: b, amount: -3000 },
      { participantId: c, amount: -3000 },
    ]);

    assertProblem(await as('POST', `/trips/${id}/close`), 409, 'balances_not_settled');

    const settlements = await as('GET', `/trips/${id}/settlements`);
    const transfers = field<{ fromId: string; toId: string; amount: number }[]>(
      settlements,
      'transfers',
    );
    assert.deepEqual(transfers, [
      { fromId: b, toId: a, amount: 3000 },
      { fromId: c, toId: a, amount: 3000 },
    ]);
    for (const t of transfers) {
      assert.equal((await as('POST', `/trips/${id}/transfers`, t)).status, 201);
    }

    const closed = await as('POST', `/trips/${id}/close`);
    assert.equal(closed.status, 200);
    assert.equal(field(closed, 'status'), 'closed');
    assert.equal(typeof field(closed, 'closedAt'), 'string');
    assert.deepEqual(field(await as('GET', `/trips/${id}/settlements`), 'transfers'), []);
  });

  it('переказ сам собі → 422; чужому → 422; неіснуючий → 404 при видаленні', async () => {
    const id = await trip();
    const a = await participant(id, 'Аня');
    assertProblem(
      await as('POST', `/trips/${id}/transfers`, { fromId: a, toId: a, amount: 1 }),
      422,
      'same_participant',
    );
    assertProblem(
      await as('POST', `/trips/${id}/transfers`, { fromId: a, toId: NO_SUCH, amount: 1 }),
      422,
      'unknown_participant',
    );
    assertProblem(
      await as('DELETE', `/trips/${id}/transfers/${NO_SUCH}`),
      404,
      'transfer_not_found',
    );
  });

  it('помилковий переказ видаляється → 204; переплата лише змінює баланс', async () => {
    const id = await trip();
    const a = await participant(id, 'Аня');
    const b = await participant(id, 'Богдан');
    const t = await as('POST', `/trips/${id}/transfers`, { fromId: a, toId: b, amount: 50 });
    const balances = field(await as('GET', `/trips/${id}/balances`), 'balances');
    assert.deepEqual(balances, [
      { participantId: a, amount: 50 },
      { participantId: b, amount: -50 },
    ]);
    assert.equal(
      (await as('DELETE', `/trips/${id}/transfers/${field<string>(t, 'id')}`)).status,
      204,
    );
  });

  it('закрита поїздка не змінюється: кожна зміна → 409 trip_closed (I4)', async () => {
    const id = await trip();
    const a = await participant(id, 'Аня');
    const expense = await as('POST', `/trips/${id}/expenses`, {
      payerId: a,
      amount: 100,
      split: { mode: 'equal', participantIds: [a] },
    });
    const eid = field<string>(expense, 'id');
    assert.equal((await as('POST', `/trips/${id}/close`)).status, 200);

    const body = { payerId: a, amount: 1, split: { mode: 'equal', participantIds: [a] } };
    const attempts: [string, string, unknown][] = [
      ['POST', `/trips/${id}/participants`, { name: 'Пізно' }],
      ['DELETE', `/trips/${id}/participants/${a}`, undefined],
      ['POST', `/trips/${id}/expenses`, body],
      ['PUT', `/trips/${id}/expenses/${eid}`, body],
      ['DELETE', `/trips/${id}/expenses/${eid}`, undefined],
      ['POST', `/trips/${id}/transfers`, { fromId: a, toId: a, amount: 1 }],
      ['POST', `/trips/${id}/close`, undefined],
    ];
    for (const [method, url, payload] of attempts) {
      assertProblem(await as(method, url, payload), 409, 'trip_closed');
    }
  });
});
