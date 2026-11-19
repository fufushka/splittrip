/**
 * База прогону `run_<id>` у локальному Supabase (ADR-0020) — спільне для `npm run test:api:db`
 * (C12) і `npm test` (ADR-0024; architecture.md лаби 3, розд. 2): створити базу, накотити
 * `db/migrations`, видалити (`drop … with (force)`), env інтеграційних тестів.
 */
import { randomUUID } from 'node:crypto';

import { connect, migrate } from '../src/modules/storage/index.ts';
import { localSupabase } from './supabase-env.ts';

export interface RunDatabase {
  readonly name: string;
  /** Env інтеграційних: `STORAGE=postgres`, база прогону, локальний Supabase Auth. */
  readonly env: Readonly<Record<string, string>>;
  create(): Promise<void>;
  migrate(): Promise<void>;
  /** Видаляє базу, навіть якщо `create` чи `migrate` упали; закриває адмін-з'єднання. */
  drop(): Promise<void>;
}

/** Ім'я й з'єднання з локальним Supabase; сама база з'являється лише після `create`. */
export function openRunDatabase(): RunDatabase {
  const local = localSupabase();
  const name = `run_${randomUUID().replaceAll('-', '')}`;
  const runUrl = new URL(local.dbUrl);
  runUrl.pathname = `/${name}`;
  const admin = connect({ url: local.dbUrl, prepare: true, maxConnections: 1 });

  return {
    name,
    env: {
      STORAGE: 'postgres',
      DATABASE_URL: runUrl.href,
      SUPABASE_URL: local.apiUrl,
      SUPABASE_ANON_KEY: local.anonKey,
      SUPABASE_SIGNING_KEYS: 'supabase/signing_keys.json',
    },
    async create() {
      await admin.unsafe(`create database ${name}`);
    },
    async migrate() {
      const sql = connect({ url: runUrl.href, prepare: true, maxConnections: 1 });
      await migrate(sql, 'db/migrations').finally(() => sql.end({ timeout: 5 }));
    },
    async drop() {
      try {
        await admin.unsafe(`drop database if exists ${name} with (force)`);
      } finally {
        await admin.end({ timeout: 5 });
      }
    },
  };
}
