/**
 * Прогін сценаріїв у хмарному Supabase через Supavisor (spec, крит. 11). Запуск:
 *   node --env-file=<шлях до .env> scripts/cloud-run.ts
 * Складає той самий застосунок, що й `main.ts`, проходить «Функціонал продукту» через API
 * і пише звіт у reports/. Токени й паролі у звіт не потрапляють; поїздку наприкінці видаляє.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { composeApp } from '../src/compose.ts';

const REPORT = join('docs/specs/lab2-api-db/reports', '11-cloud-supavisor.txt');
const env = process.env;
const lines: string[] = [];
let failed = false;

const supabaseHost = new URL(env.SUPABASE_URL ?? 'http://invalid').hostname.replace(
  /^[^.]+/,
  '<ref>',
);
const db = new URL(env.DATABASE_URL ?? 'postgres://invalid');

const app = await composeApp({ env: { ...env, LOG_LEVEL: 'warn' } });

async function step(
  title: string,
  method: string,
  url: string,
  expected: number,
  options: { token?: string; body?: unknown } = {},
): Promise<Record<string, unknown>> {
  const started = Date.now();
  const res = await app.server.inject({
    method: method as 'GET',
    url,
    headers: options.token === undefined ? {} : { authorization: `Bearer ${options.token}` },
    ...(options.body === undefined ? {} : { payload: options.body as object }),
  });
  const ok = res.statusCode === expected;
  failed ||= !ok;
  lines.push(
    `${ok ? 'OK ' : 'ERR'} ${method.padEnd(6)} ${url.replace(/[0-9a-f-]{36}/g, ':id').padEnd(34)} ` +
      `${String(res.statusCode)} (очік. ${String(expected)}) ${String(Date.now() - started)} мс — ${title}`,
  );
  return res.body === '' ? {} : (JSON.parse(res.body) as Record<string, unknown>);
}

try {
  lines.push(
    '# Відтворити: node --env-file=<.env хмари> scripts/cloud-run.ts',
    `# Supabase: ${supabaseHost}; БД: Supavisor ${db.hostname.replace(/^[^.]+/, '<x>')}:${db.port} ` +
      `(${db.port === '6543' ? 'transaction mode, prepare: false' : 'не transaction mode!'})`,
    `# Час: ${new Date().toISOString()}`,
    '',
  );
  await step('готовність: SELECT now() через Supavisor', 'GET', '/ready', 200);

  const email = `splittrip-cloud-${randomUUID().slice(0, 8)}@example.com`;
  const password = randomUUID();
  const signup = await step('реєстрація в Supabase Auth', 'POST', '/auth/signup', 201, {
    body: { email, password },
  });
  await step('логін', 'POST', '/auth/login', 200, { body: { email, password } });
  const token = String(signup.accessToken);
  const as = { token };

  const trip = await step('створити поїздку', 'POST', '/trips', 201, {
    ...as,
    body: { name: 'Хмарний прогін', currency: 'UAH' },
  });
  const t = `/trips/${String(trip.id)}`;
  const ids: string[] = [];
  for (const name of ['Аня', 'Богдан', 'Віра']) {
    const p = await step(`додати учасника ${name}`, 'POST', `${t}/participants`, 201, {
      ...as,
      body: { name },
    });
    ids.push(String(p.id));
  }
  const [a, b, c] = ids;
  const extra = await step('додати й прибрати учасника', 'POST', `${t}/participants`, 201, {
    ...as,
    body: { name: 'Зайвий' },
  });
  await step(
    'прибрати незгаданого учасника',
    'DELETE',
    `${t}/participants/${String(extra.id)}`,
    204,
    as,
  );

  const expense = await step('витрата порівну 100,00 на трьох', 'POST', `${t}/expenses`, 201, {
    ...as,
    body: { payerId: a, amount: 10000, split: { mode: 'equal', participantIds: [a, b, c] } },
  });
  await step('змінити витрату (PUT)', 'PUT', `${t}/expenses/${String(expense.id)}`, 200, {
    ...as,
    body: { payerId: a, amount: 9000, split: { mode: 'equal', participantIds: [a, b, c] } },
  });
  const extraExpense = await step('витрата точними частками', 'POST', `${t}/expenses`, 201, {
    ...as,
    body: {
      payerId: b,
      amount: 500,
      split: { mode: 'exact', shares: [{ participantId: c, amount: 500 }] },
    },
  });
  await step('видалити витрату', 'DELETE', `${t}/expenses/${String(extraExpense.id)}`, 204, as);
  await step('прибрати згаданого → 409', 'DELETE', `${t}/participants/${String(b)}`, 409, as);
  await step('баланси', 'GET', `${t}/balances`, 200, as);
  await step('закрити з боргами → 409', 'POST', `${t}/close`, 409, as);

  const settlements = await step('запропоновані перекази', 'GET', `${t}/settlements`, 200, as);
  for (const transfer of settlements.transfers as unknown[]) {
    await step('зафіксувати переказ', 'POST', `${t}/transfers`, 201, { ...as, body: transfer });
  }
  const wrong = await step('помилковий переказ', 'POST', `${t}/transfers`, 201, {
    ...as,
    body: { fromId: a, toId: b, amount: 1 },
  });
  await step(
    'видалити помилковий переказ',
    'DELETE',
    `${t}/transfers/${String(wrong.id)}`,
    204,
    as,
  );
  await step('закрити поїздку', 'POST', `${t}/close`, 200, as);
  await step('закрита не змінюється → 409', 'POST', `${t}/participants`, 409, {
    ...as,
    body: { name: 'Пізно' },
  });
  await step('список поїздок', 'GET', '/trips?limit=5', 200, as);
  await step('перегляд агрегату', 'GET', t, 200, as);
  await step('видалити поїздку', 'DELETE', t, 204, as);
  await step('видалена → 404', 'GET', t, 404, as);
  await step('вихід', 'POST', '/auth/logout', 204, as);
  await step('refresh після logout → 401', 'POST', '/auth/refresh', 401, {
    body: { refreshToken: String(signup.refreshToken) },
  });

  // Data API Supabase закритий RLS (spec-fix-03, п. 1).
  const base = (env.SUPABASE_URL ?? '').replace(/\/+$/, '');
  const rest = await fetch(`${base}/rest/v1/trips?select=id`, {
    headers: { apikey: env.SUPABASE_ANON_KEY ?? '' },
  });
  const rows = (await rest.json()) as unknown[];
  const closed = rest.status === 200 && rows.length === 0;
  failed ||= !closed;
  lines.push(
    `${closed ? 'OK ' : 'ERR'} GET    <SUPABASE_URL>/rest/v1/trips      ${String(rest.status)}, рядків: ${String(rows.length)} — Data API закритий RLS`,
  );
} finally {
  await app.close();
  lines.push('', `# Результат: ${failed ? 'ПОМИЛКИ' : 'усі кроки OK'}`);
  mkdirSync('docs/specs/lab2-api-db/reports', { recursive: true });
  writeFileSync(REPORT, `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
}
process.exitCode = failed ? 1 : 0;
