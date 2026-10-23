/**
 * Наскрізні вимоги: доступ власника (крит. 6), формат помилок і requestId, ідемпотентність
 * (крит. 8), processId у логах з усіх рівнів (крит. 5), секрети поза логами (крит. 6),
 * паралельні зміни (крит. 7).
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { type Harness, PASSWORD, type User, field, startHarness } from './harness.ts';

let h: Harness;
let owner: User;
let stranger: User;
before(async () => {
  h = await startHarness();
  owner = await h.user();
  stranger = await h.user();
});
after(() => h.close());

async function tripWithData(): Promise<{ id: string; a: string; e: string; t: string }> {
  const call = (method: string, url: string, body?: unknown) =>
    h.call(method, url, body === undefined ? { token: owner.token } : { token: owner.token, body });
  const id = field<string>(
    await call('POST', '/trips', { name: 'Спільна', currency: 'UAH' }),
    'id',
  );
  const a = field<string>(await call('POST', `/trips/${id}/participants`, { name: 'Аня' }), 'id');
  const b = field<string>(
    await call('POST', `/trips/${id}/participants`, { name: 'Богдан' }),
    'id',
  );
  const e = field<string>(
    await call('POST', `/trips/${id}/expenses`, {
      payerId: a,
      amount: 100,
      split: { mode: 'equal', participantIds: [a, b] },
    }),
    'id',
  );
  const t = field<string>(
    await call('POST', `/trips/${id}/transfers`, { fromId: b, toId: a, amount: 50 }),
    'id',
  );
  return { id, a, e, t };
}

describe('доступ: чужа поїздка → 404 на кожен /trips/:id*', () => {
  it('жоден ендпоінт не видає й не змінює чужу поїздку', async () => {
    const { id, a, e, t } = await tripWithData();
    const expense = { payerId: a, amount: 1, split: { mode: 'equal', participantIds: [a] } };
    const attempts: [string, string, unknown][] = [
      ['GET', `/trips/${id}`, undefined],
      ['DELETE', `/trips/${id}`, undefined],
      ['POST', `/trips/${id}/participants`, { name: 'Злом' }],
      ['DELETE', `/trips/${id}/participants/${a}`, undefined],
      ['POST', `/trips/${id}/expenses`, expense],
      ['PUT', `/trips/${id}/expenses/${e}`, expense],
      ['DELETE', `/trips/${id}/expenses/${e}`, undefined],
      ['POST', `/trips/${id}/transfers`, { fromId: a, toId: a, amount: 1 }],
      ['DELETE', `/trips/${id}/transfers/${t}`, undefined],
      ['GET', `/trips/${id}/balances`, undefined],
      ['GET', `/trips/${id}/settlements`, undefined],
      ['POST', `/trips/${id}/close`, undefined],
    ];
    for (const [method, url, body] of attempts) {
      const res = await h.call(
        method,
        url,
        body === undefined ? { token: stranger.token } : { token: stranger.token, body },
      );
      assert.equal(res.status, 404, `${method} ${url}: ${res.text}`);
      assert.equal(field(res, 'code'), 'trip_not_found');
    }
    // Поїздка власника не змінилась.
    const mine = await h.call('GET', `/trips/${id}`, { token: owner.token });
    assert.equal(field<unknown[]>(mine, 'participants').length, 2);
    assert.equal(field<unknown[]>(mine, 'expenses').length, 1);
    assert.equal(field<unknown[]>(mine, 'transfers').length, 1);
  });

  it('GET /trips не показує чужих поїздок', async () => {
    await tripWithData();
    const res = await h.call('GET', '/trips', { token: stranger.token });
    assert.deepEqual(field(res, 'items'), []);
  });
});

describe('помилки й requestId', () => {
  it('problem+json з requestId = X-Request-Id відповіді', async () => {
    const res = await h.call('GET', '/trips/01900000-0000-7000-8000-000000000000', {
      token: owner.token,
    });
    assert.equal(res.status, 404);
    assert.match(String(res.headers['content-type']), /^application\/problem\+json/);
    assert.equal(field(res, 'type'), '/problems/trip_not_found');
    assert.equal(typeof field(res, 'title'), 'string');
    assert.equal(field(res, 'requestId'), res.headers['x-request-id']);
  });

  it('X-Request-Id клієнта використовується; небезпечний — замінюється UUIDv7', async () => {
    const given = await h.call('GET', '/health', { headers: { 'x-request-id': 'client-42' } });
    assert.equal(given.headers['x-request-id'], 'client-42');
    const unsafe = await h.call('GET', '/health', { headers: { 'x-request-id': 'bad id\n' } });
    assert.match(String(unsafe.headers['x-request-id']), /^[0-9a-f-]{36}$/);
  });

  it('невідомий маршрут → 404 route_not_found; зламаний JSON → 400', async () => {
    const res = await h.call('GET', '/nope');
    assert.equal(field(res, 'code'), 'route_not_found');
    const broken = await h.app.server.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{"email":',
    });
    assert.equal(broken.statusCode, 400);
  });

  it('/health 200, /ready 200 на статиці, /version — без JWT', async () => {
    assert.equal((await h.call('GET', '/health')).status, 200);
    assert.deepEqual((await h.call('GET', '/ready')).body, { status: 'ready' });
    assert.equal((await h.call('GET', '/version')).status, 200);
  });
});

describe('ідемпотентність POST /trips* (ADR-0019)', () => {
  const create = (key: string, name = 'Ідемпотентна') =>
    h.call('POST', '/trips', {
      token: owner.token,
      headers: { 'idempotency-key': key },
      body: { name, currency: 'UAH' },
    });

  it('повтор із тим самим ключем → та сама відповідь і одна поїздка', async () => {
    const key = `k-${String(Date.now())}`;
    const first = await create(key);
    const second = await create(key);
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(second.text, first.text);
    assert.equal(second.headers['idempotent-replayed'], 'true');
    const list = await h.call('GET', '/trips?limit=100', { token: owner.token });
    const same = field<{ id: string }[]>(list, 'items').filter((t) => t.id === field(first, 'id'));
    assert.equal(same.length, 1);
  });

  it('без ключа POST виконується; ключ довший за 255 символів → 400 (spec-fix-01, п. 4)', async () => {
    const plain = await h.call('POST', '/trips', {
      token: owner.token,
      body: { name: 'Без ключа', currency: 'UAH' },
    });
    assert.equal(plain.status, 201);
    const res = await create('k'.repeat(256));
    assert.equal(res.status, 400);
    assert.equal(field(res, 'code'), 'validation_failed');
  });

  it('той самий ключ з іншим тілом → 422 idempotency_key_reused', async () => {
    const key = `k2-${String(Date.now())}`;
    await create(key, 'Перша');
    const res = await create(key, 'Інша');
    assert.equal(res.status, 422);
    assert.equal(field(res, 'code'), 'idempotency_key_reused');
  });

  it('ключі ізольовані між користувачами', async () => {
    const key = `shared-${String(Date.now())}`;
    await create(key);
    const res = await h.call('POST', '/trips', {
      token: stranger.token,
      headers: { 'idempotency-key': key },
      body: { name: 'Ідемпотентна', currency: 'UAH' },
    });
    assert.equal(res.status, 201);
    assert.equal(res.headers['idempotent-replayed'], undefined);
  });

  it('4xx теж відтворюється: повтор не виконує операцію вдруге', async () => {
    const key = `k4-${String(Date.now())}`;
    const id = field<string>(await create(`t-${key}`), 'id');
    await h.call('POST', `/trips/${id}/close`, { token: owner.token });
    const first = await h.call('POST', `/trips/${id}/participants`, {
      token: owner.token,
      headers: { 'idempotency-key': key },
      body: { name: 'Пізно' },
    });
    assert.equal(first.status, 409);
    const second = await h.call('POST', `/trips/${id}/participants`, {
      token: owner.token,
      headers: { 'idempotency-key': key },
      body: { name: 'Пізно' },
    });
    assert.equal(second.status, 409);
    assert.equal(second.headers['idempotent-replayed'], 'true');
  });
});

describe('логи (крит. 5, 6)', () => {
  it('рядки роута, сервісу й сховища одного запиту мають той самий processId і userId', async () => {
    const processId = `trace-${String(Date.now())}`;
    const res = await h.call('POST', '/trips', {
      token: owner.token,
      headers: { 'x-request-id': processId },
      body: { name: 'Трасування', currency: 'UAH' },
    });
    assert.equal(res.status, 201);
    const lines = h.logs.filter((l) => l.processId === processId);
    const messages = lines.map((l) => l.msg);
    assert.ok(messages.includes('storage(memory): create'), 'лог сховища');
    assert.ok(messages.includes('trip created'), 'лог сервісу');
    assert.ok(messages.includes('request completed'), 'лог http');
    for (const line of lines.filter((l) => l.msg !== undefined && l.msg !== 'request rejected')) {
      assert.equal(line.userId, owner.id, String(line.msg));
    }
  });

  it('паролі й токени не потрапляють у логи', async () => {
    const user = await h.user();
    await h.call('POST', '/auth/login', { body: { email: user.email, password: PASSWORD } });
    await h.call('POST', '/auth/refresh', { body: { refreshToken: user.refreshToken } });
    await h.call('GET', '/trips', { token: 'Bearer-garbage' });
    const all = JSON.stringify(h.logs);
    for (const secret of [PASSWORD, user.token, user.refreshToken]) {
      assert.ok(!all.includes(secret), 'секрет у логах');
    }
  });
});

describe('паралельні зміни (крит. 7)', () => {
  it('close і POST expenses одночасно: рівно одна операція успішна, стан узгоджений', async () => {
    for (let round = 0; round < 10; round++) {
      const call = (method: string, url: string, body?: unknown) =>
        h.call(
          method,
          url,
          body === undefined ? { token: owner.token } : { token: owner.token, body },
        );
      const id = field<string>(
        await call('POST', '/trips', { name: 'Гонка', currency: 'UAH' }),
        'id',
      );
      const a = field<string>(await call('POST', `/trips/${id}/participants`, { name: 'А' }), 'id');
      const b = field<string>(await call('POST', `/trips/${id}/participants`, { name: 'Б' }), 'id');
      const [close, expense] = await Promise.all([
        call('POST', `/trips/${id}/close`),
        call('POST', `/trips/${id}/expenses`, {
          payerId: a,
          amount: 100,
          split: { mode: 'equal', participantIds: [b] },
        }),
      ]);
      const trip = await call('GET', `/trips/${id}`);
      const closed = field(trip, 'status') === 'closed';
      const expenses = field<unknown[]>(trip, 'expenses').length;
      if (closed) {
        assert.equal(close.status, 200);
        assert.equal(expense.status, 409);
        assert.equal(expenses, 0, 'у закритій поїздці не може з’явитися витрата');
      } else {
        assert.equal(expense.status, 201);
        assert.equal(close.status, 409);
        assert.equal(expenses, 1);
      }
    }
  });
});
