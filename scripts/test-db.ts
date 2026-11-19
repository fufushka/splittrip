/**
 * `npm run test:api:db` — той самий набір API-тестів на Postgres (spec, крит. 2; C12):
 * створює в локальному Supabase окрему базу `run_<id>`, накочує міграції, проганяє тести з
 * `STORAGE=postgres` і видаляє базу навіть після падіння (ADR-0020).
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { connect, migrate } from '../src/modules/storage/index.ts';
import { localSupabase } from './supabase-env.ts';

const local = localSupabase();
const database = `run_${randomUUID().replaceAll('-', '')}`;
const runUrl = new URL(local.dbUrl);
runUrl.pathname = `/${database}`;

const admin = connect({ url: local.dbUrl, prepare: true, maxConnections: 1 });
try {
  await admin.unsafe(`create database ${database}`);
  console.log(`test:api:db: база ${database}`);
  const sql = connect({ url: runUrl.href, prepare: true, maxConnections: 1 });
  await migrate(sql, 'db/migrations').finally(() => sql.end({ timeout: 5 }));

  const files = process.argv.slice(2);
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-timeout=120000', ...(files.length > 0 ? files : ['test/api/*.test.ts'])],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        STORAGE: 'postgres',
        DATABASE_URL: runUrl.href,
        SUPABASE_URL: local.apiUrl,
        SUPABASE_ANON_KEY: local.anonKey,
        SUPABASE_SIGNING_KEYS: 'supabase/signing_keys.json',
      },
    },
  );
  process.exitCode = result.status ?? 1;
} finally {
  await admin.unsafe(`drop database if exists ${database} with (force)`);
  await admin.end({ timeout: 5 });
  console.log(`test:api:db: базу ${database} видалено`);
}
