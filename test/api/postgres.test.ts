/**
 * Поведінка, яку має сенс перевіряти лише на справжній БД (`npm run test:api:db`):
 * N+1 (крит. 10), ретраї й 503 (крит. 8), збій джерела й fail-fast на старті (крит. 9),
 * обмеження БД як друга лінія інваріантів. На `STORAGE=memory` набір пропускається.
 * Збої підкидаються ззовні — тригером у базі прогону й TCP-проксі, без гачків у коді.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { type Server, type Socket, createConnection, createServer } from 'node:net';
import { after, before, describe, it } from 'node:test';

import postgres from 'postgres';

import { type App, composeApp } from '../../src/compose.ts';
import { type Harness, MODE, type User, field, startHarness } from './harness.ts';

const skip = MODE !== 'postgres' && 'лише для npm run test:api:db';
const DATABASE_URL = process.env.DATABASE_URL ?? '';

let h: Harness;
let me: User;
let db: postgres.Sql;

before(async () => {
  if (skip !== false) return;
  h = await startHarness();
  me = await h.user();
  db = postgres(DATABASE_URL, { max: 1, onnotice: () => undefined });
});
after(async () => {
  if (skip !== false) return;
  await h.close();
  await db.end({ timeout: 5 });
});

const as = (method: string, url: string, body?: unknown) =>
  h.call(method, url, body === undefined ? { token: me.token } : { token: me.token, body });

async function tripWith(expenses: number): Promise<{ id: string; a: string; b: string }> {
  const id = field<string>(await as('POST', '/trips', { name: 'N+1', currency: 'UAH' }), 'id');
  const a = field<string>(await as('POST', `/trips/${id}/participants`, { name: 'А' }), 'id');
  const b = field<string>(await as('POST', `/trips/${id}/participants`, { name: 'Б' }), 'id');
  for (let i = 0; i < expenses; i++) {
    const res = await as('POST', `/trips/${id}/expenses`, {
      payerId: a,
      amount: 100 + i,
      split: { mode: 'equal', participantIds: [a, b] },
    });
    assert.equal(res.status, 201);
  }
  return { id, a, b };
}

async function queriesOf(url: string): Promise<number> {
  const start = h.queries.length;
  assert.equal((await as('GET', url)).status, 200);
  return h.queries.length - start;
}

describe('N+1 (крит. 10)', { skip }, () => {
  it('GET /trips/:id: та сама кількість запитів для 1 і 20 витрат', async () => {
    const small = await tripWith(1);
    const large = await tripWith(20);
    const one = await queriesOf(`/trips/${small.id}`);
    const twenty = await queriesOf(`/trips/${large.id}`);
    assert.equal(twenty, one, `1 витрата: ${String(one)} запитів, 20: ${String(twenty)}`);
    // begin, set_config, 4 запити агрегату, commit.
    assert.ok(one <= 7, `агрегат за ${String(one)} запитів`);
  });

  it('баланси й розрахунок — теж без залежності від кількості витрат', async () => {
    const small = await tripWith(1);
    const large = await tripWith(20);
    assert.equal(
      await queriesOf(`/trips/${large.id}/balances`),
      await queriesOf(`/trips/${small.id}/balances`),
    );
  });
});

describe('ретраї тимчасових помилок (крит. 8)', { skip }, () => {
  before(async () => {
    if (skip !== false) return;
    // Тригер підкидає 40001 рівно N разів лише для обраної поїздки: лічильник — sequence,
    // яку не відкочує ROLLBACK, тож кожна спроба транзакції «витрачає» одну помилку.
    await db.unsafe(`
      create table test_fault_config (trip_id uuid, failures int not null);
      insert into test_fault_config values (null, 0);
      create sequence test_fault_seq;
      create function test_fault() returns trigger language plpgsql as $$
      begin
        if new.trip_id = (select trip_id from test_fault_config)
           and nextval('test_fault_seq') <= (select failures from test_fault_config) then
          raise exception 'injected serialization failure' using errcode = '40001';
        end if;
        return new;
      end $$;
      create trigger test_fault before insert on transfers
        for each row execute function test_fault();`);
  });

  const arm = async (tripId: string, failures: number) => {
    await db`update test_fault_config set trip_id = ${tripId}, failures = ${failures}`;
    await db`select setval('test_fault_seq', 1, false)`;
  };

  it('2 помилки 40001 поспіль → третя спроба успішна, 201', async () => {
    const { id, a, b } = await tripWith(0);
    await arm(id, 2);
    const logsBefore = h.logs.length;
    const res = await as('POST', `/trips/${id}/transfers`, { fromId: a, toId: b, amount: 10 });
    assert.equal(res.status, 201, res.text);
    const retries = h.logs.slice(logsBefore).filter((l) => l.msg === 'storage: retry');
    assert.equal(retries.length, 2);
    assert.equal(field<unknown[]>(await as('GET', `/trips/${id}`), 'transfers').length, 1);
  });

  it('3 помилки поспіль → 503 з Retry-After, нічого не збережено', async () => {
    const { id, a, b } = await tripWith(0);
    await arm(id, 3);
    const res = await as('POST', `/trips/${id}/transfers`, { fromId: a, toId: b, amount: 10 });
    assert.equal(res.status, 503, res.text);
    assert.equal(field(res, 'code'), 'source_unavailable');
    assert.equal(res.headers['retry-after'], '2');
    assert.equal(field<unknown[]>(await as('GET', `/trips/${id}`), 'transfers').length, 0);
  });
});

/** TCP-проксі до БД, який можна «вимкнути» посеред роботи — імітація падіння джерела. */
async function dbProxy(target: URL): Promise<{ url: string; down(): void; up(): Promise<void> }> {
  const sockets = new Set<Socket>();
  let server: Server | undefined;
  let port = 0;
  const up = () =>
    new Promise<void>((resolve) => {
      server = createServer((client) => {
        const upstream = createConnection(Number(target.port), target.hostname);
        sockets.add(client).add(upstream);
        client.pipe(upstream).pipe(client);
        for (const s of [client, upstream]) {
          s.on('error', () => {
            client.destroy();
            upstream.destroy();
          });
          s.on('close', () => sockets.delete(s));
        }
      });
      server.listen(port, '127.0.0.1', () => {
        const address = server?.address();
        if (address !== null && typeof address === 'object') port = address.port;
        resolve();
      });
    });
  await up();
  const url = new URL(target.href);
  url.hostname = '127.0.0.1';
  url.port = String(port);
  return {
    url: url.href,
    down() {
      server?.close();
      for (const s of sockets) s.destroy();
    },
    up,
  };
}

describe('збій джерела під час роботи (крит. 9)', { skip }, () => {
  it('БД зникла → 503 + Retry-After, /ready 503, /health 200; повернулась → 200', async () => {
    const proxy = await dbProxy(new URL(DATABASE_URL));
    const app = await startHarness({ env: { DATABASE_URL: proxy.url } });
    const user = await app.user();
    const created = await app.call('POST', '/trips', {
      token: user.token,
      body: { name: 'Збій', currency: 'UAH' },
    });
    assert.equal(created.status, 201);
    const url = `/trips/${field<string>(created, 'id')}`;

    proxy.down();
    const failed = await app.call('GET', url, { token: user.token });
    assert.equal(failed.status, 503, failed.text);
    assert.equal(field(failed, 'code'), 'source_unavailable');
    assert.equal(failed.headers['retry-after'], '2');
    assert.equal((await app.call('GET', '/ready')).status, 503);
    assert.equal((await app.call('GET', '/health')).status, 200);

    await proxy.up();
    assert.equal((await app.call('GET', url, { token: user.token })).status, 200);
    assert.equal((await app.call('GET', '/ready')).status, 200);
    proxy.down();
    await app.close();
  });
});

describe('fail-fast на старті (крит. 9)', { skip }, () => {
  const badUrl = 'postgres://postgres:postgres@127.0.0.1:1/nope';

  it('composeApp з недоступною БД відхиляється SourceUnavailableError', async () => {
    const started = Date.now();
    let startedApp: App | undefined;
    let failure: unknown;
    await composeApp({ env: { ...process.env, DATABASE_URL: badUrl } }).then(
      (app) => (startedApp = app),
      (error: unknown) => (failure = error),
    );
    // Якщо застосунок усе ж стартував — закрити пул, інакше процес тестів не завершиться.
    if (startedApp !== undefined) {
      await startedApp.close();
      assert.fail('composeApp мав відхилитися на недоступній БД');
    }
    assert.ok(failure instanceof Error && failure.name === 'SourceUnavailableError');
    assert.ok(Date.now() - started < 10_000);
  });

  it('процес з невірним DATABASE_URL завершується з кодом 1 за ≤ 10 с', async () => {
    const started = Date.now();
    const child = spawn(process.execPath, ['src/main.ts'], {
      env: { ...process.env, DATABASE_URL: badUrl, PORT: '0' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    // Жорсткий дедлайн = межа крит. 9: процес, що «стартував» на зламаній БД, вбиваємо, інакше
    // він слухатиме порт вічно й тримає прогін (знайдено мутацією «старт без SELECT now()»).
    const deadline = setTimeout(() => child.kill('SIGKILL'), 10_000);
    const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
    clearTimeout(deadline);
    assert.equal(code, 1, `процес не впав за 10 с (код ${String(code)}); stderr: ${stderr}`);
    assert.match(stderr, /не вдалося стартувати/);
    assert.ok(Date.now() - started < 10_000, `${String(Date.now() - started)} мс`);
  });
});

describe('обмеження БД — друга лінія інваріантів', { skip }, () => {
  it('усі таблиці схеми public під RLS — закриті від Data API (spec-fix-03, п. 1)', async () => {
    const open = await db<{ relname: string }[]>`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
         and c.relname not like 'test\_%'`;
    assert.deepEqual(
      open.map((r) => r.relname),
      [],
    );
  });

  it('частка учасника з іншої поїздки відхиляється FK (I3), навіть повз домен', async () => {
    const first = await tripWith(1);
    const second = await tripWith(0);
    const [expense] = await db<{ id: string }[]>`
      select id from expenses where trip_id = ${first.id} limit 1`;
    await assert.rejects(
      db`insert into expense_shares (trip_id, expense_id, participant_id, amount)
         values (${first.id}, ${expense?.id ?? ''}, ${second.a}, 1)`,
      (error: { code?: string }) => error.code === '23503',
    );
  });

  it('учасника, згаданого у витраті, не видалити й напряму (I5)', async () => {
    const { a } = await tripWith(1);
    await assert.rejects(
      db`delete from participants where id = ${a}`,
      (error: { code?: string }) => error.code === '23503',
    );
  });
});
