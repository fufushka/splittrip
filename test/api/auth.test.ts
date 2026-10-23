/**
 * `/auth/*` і перевірка JWT (contract.md, розд. 1; spec, крит. 6).
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { type Harness, PASSWORD, field, startHarness } from './harness.ts';

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(() => h.close());

describe('auth: реєстрація й логін', () => {
  it('signup → 201 з користувачем і токенами; email у нижньому регістрі', async () => {
    const res = await h.call('POST', '/auth/signup', {
      body: { email: 'Mixed.Case@Example.com', password: PASSWORD },
    });
    assert.equal(res.status, 201);
    assert.equal(field(res, 'user', 'email'), 'mixed.case@example.com');
    assert.equal(typeof field(res, 'accessToken'), 'string');
    assert.equal(typeof field(res, 'refreshToken'), 'string');
    assert.equal(typeof field(res, 'expiresIn'), 'number');
  });

  it('signup з зайнятим email → 409 email_taken', async () => {
    const { email } = await h.user();
    const res = await h.call('POST', '/auth/signup', { body: { email, password: PASSWORD } });
    assert.equal(res.status, 409);
    assert.equal(field(res, 'code'), 'email_taken');
  });

  it('signup з некоректним email, коротким чи задовгим паролем → 400', async () => {
    for (const body of [
      { email: 'not-an-email', password: PASSWORD },
      { email: 'a@example.com', password: 'short' },
      { email: 'a@example.com', password: 'x'.repeat(73) },
      { email: 'a@example.com' },
      { email: 'a@example.com', password: PASSWORD, admin: true },
    ]) {
      const res = await h.call('POST', '/auth/signup', { body });
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(field(res, 'code'), 'validation_failed');
    }
  });

  it('login → 200 і токен працює на /trips', async () => {
    const { email } = await h.user();
    const res = await h.call('POST', '/auth/login', { body: { email, password: PASSWORD } });
    assert.equal(res.status, 200);
    const list = await h.call('GET', '/trips', { token: field(res, 'accessToken') });
    assert.equal(list.status, 200);
  });

  it('невідомий email і хибний пароль — однаковий 401 (без перебору email)', async () => {
    const { email } = await h.user();
    const wrong = await h.call('POST', '/auth/login', {
      body: { email, password: 'wrong-password' },
    });
    const unknown = await h.call('POST', '/auth/login', {
      body: { email: 'nobody@example.com', password: 'wrong-password' },
    });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    const strip = (body: unknown) => ({ ...(body as object), requestId: undefined });
    assert.deepEqual(strip(wrong.body), strip(unknown.body));
  });
});

describe('auth: refresh і logout', () => {
  it('refresh → нова пара токенів; старий refresh-токен уже не діє', async () => {
    const user = await h.user();
    const first = await h.call('POST', '/auth/refresh', {
      body: { refreshToken: user.refreshToken },
    });
    assert.equal(first.status, 200);
    const again = await h.call('POST', '/auth/refresh', {
      body: { refreshToken: user.refreshToken },
    });
    assert.equal(again.status, 401);
  });

  it('logout → 204; після нього refresh-токен не діє', async () => {
    const user = await h.user();
    const out = await h.call('POST', '/auth/logout', { token: user.token });
    assert.equal(out.status, 204);
    const res = await h.call('POST', '/auth/refresh', {
      body: { refreshToken: user.refreshToken },
    });
    assert.equal(res.status, 401);
  });

  it('logout без токена → 401', async () => {
    assert.equal((await h.call('POST', '/auth/logout')).status, 401);
  });
});

describe('auth: доступ до /trips', () => {
  it('без токена, з підробленим чи не-Bearer → 401 з WWW-Authenticate', async () => {
    const user = await h.user();
    const [head, payload] = user.token.split('.');
    const forged = `${head ?? ''}.${payload ?? ''}.${'A'.repeat(86)}`;
    for (const headers of [
      {},
      { authorization: 'Bearer garbage' },
      { authorization: `Bearer ${forged}` },
      { authorization: `Basic ${user.token}` },
    ]) {
      const res = await h.call('GET', '/trips', { headers });
      assert.equal(res.status, 401, JSON.stringify(headers));
      assert.equal(field(res, 'code'), 'invalid_token');
      assert.equal(res.headers['www-authenticate'], 'Bearer');
    }
  });

  it('прострочений токен → 401', async () => {
    const expired = await startHarness({ accessTokenTtlSeconds: -10 });
    const user = await expired.user();
    const res = await expired.call('GET', '/trips', { token: user.token });
    assert.equal(res.status, 401);
    await expired.close();
  });

  it('токен іншого екземпляра (інший ключ підпису) → 401', async () => {
    const other = await startHarness();
    const stranger = await other.user();
    await other.close();
    assert.equal((await h.call('GET', '/trips', { token: stranger.token })).status, 401);
  });
});
