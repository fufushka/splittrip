/**
 * `npm run test:api:db` — той самий набір API-тестів на Postgres (spec, крит. 2; C12):
 * створює в локальному Supabase окрему базу `run_<id>`, накочує міграції, проганяє тести з
 * `STORAGE=postgres` і видаляє базу навіть після падіння (ADR-0020). База прогону —
 * `run-db.ts`, спільний із `npm test` (ADR-0024).
 */
import { spawnSync } from 'node:child_process';

import { openRunDatabase } from './run-db.ts';

const db = openRunDatabase();
try {
  await db.create();
  console.log(`test:api:db: база ${db.name}`);
  await db.migrate();

  const files = process.argv.slice(2);
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-timeout=120000', ...(files.length > 0 ? files : ['test/api/*.test.ts'])],
    { stdio: 'inherit', env: { ...process.env, ...db.env } },
  );
  process.exitCode = result.status ?? 1;
} finally {
  await db.drop();
  console.log(`test:api:db: базу ${db.name} видалено`);
}
