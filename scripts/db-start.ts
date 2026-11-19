/**
 * `npm run db:start` — локальний Supabase у Docker (ADR-0020). Якщо ключа підпису JWT ще немає,
 * створює його (ES256, ADR-0017); файл ключа в .gitignore і не комітиться.
 */
import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';

const KEYS = 'supabase/signing_keys.json';

if (!existsSync(KEYS)) {
  writeFileSync(KEYS, '[]\n');
  execSync('npx supabase gen signing-key --algorithm ES256 --append', { stdio: 'inherit' });
}
execSync('npx supabase start', { stdio: 'inherit' });
