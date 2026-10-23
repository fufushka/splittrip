/**
 * Раннер SQL-міграцій (ADR-0020): `db/migrations/NNNN-*.sql` за номером, кожен файл — у
 * транзакції під advisory-lock; у `schema_migrations` — ім'я й SHA-256. Застосований файл,
 * що змінився, — помилка, а не мовчазний пропуск.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { log } from '../context/index.ts';
import type { Sql } from './postgres/client.ts';

const FILE = /^\d{4}-[a-z0-9-]+\.sql$/;
/** Довільна стала для pg_advisory_xact_lock: один раннер на базу одночасно. */
const LOCK_KEY = 2_026_024;

export class MigrationError extends Error {
  override readonly name = 'MigrationError';
}

async function sha256(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Повертає імена щойно застосованих міграцій. */
export async function migrate(sql: Sql, dir: string): Promise<string[]> {
  await sql`create table if not exists schema_migrations (
              name text primary key,
              sha256 text not null,
              applied_at timestamptz not null default now())`;
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  const applied: string[] = [];
  for (const name of files) {
    if (!FILE.test(name)) throw new MigrationError(`Назва міграції не за форматом: ${name}`);
    const text = readFileSync(join(dir, name), 'utf8');
    const hash = await sha256(text);
    const done = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(${LOCK_KEY})`;
      const [row] = await tx<{ sha256: string }[]>`
        select sha256 from schema_migrations where name = ${name}`;
      if (row !== undefined) {
        if (row.sha256 !== hash) {
          throw new MigrationError(`Застосовану міграцію ${name} змінено — потрібна нова міграція`);
        }
        return false;
      }
      await tx.unsafe(text).simple();
      await tx`insert into schema_migrations (name, sha256) values (${name}, ${hash})`;
      return true;
    });
    if (done) {
      applied.push(name);
      log.info({ migration: name }, 'migration applied');
    }
  }
  return applied;
}
