/**
 * `npm run db:migrate` — накочує `db/migrations/*.sql` на базу з `DATABASE_URL` (ADR-0020).
 * Без `DATABASE_URL` — на локальний Supabase. Повторний запуск нічого не застосовує.
 */
import { connect, migrate } from '../src/modules/storage/index.ts';
import { localSupabase } from './supabase-env.ts';

const url = process.env.DATABASE_URL ?? localSupabase().dbUrl;
const prepare =
  (process.env.DATABASE_PREPARE ?? (url.includes(':6543/') ? 'false' : 'true')) === 'true';
const sql = connect({ url, prepare, maxConnections: 1 });

try {
  const applied = await migrate(sql, 'db/migrations');
  console.log(
    applied.length === 0 ? 'db:migrate: усе вже застосовано' : `db:migrate: ${applied.join(', ')}`,
  );
} catch (error) {
  console.error(`db:migrate: ${String(error)}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
