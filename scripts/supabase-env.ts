/**
 * Змінні локального Supabase з `supabase status -o env` (ADR-0020). Значення ключів не
 * друкуються — лише передаються дочірнім процесам.
 */
import { execSync } from 'node:child_process';

export interface LocalSupabase {
  readonly apiUrl: string;
  readonly dbUrl: string;
  readonly anonKey: string;
}

export function localSupabase(): LocalSupabase {
  let output: string;
  try {
    output = execSync('npx supabase status -o env', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error('Локальний Supabase не запущено: спершу `npm run db:start` (потрібен Docker)');
  }
  const vars = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^([A-Z_]+)="?(.*?)"?$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) vars.set(match[1], match[2]);
  }
  const get = (name: string): string => {
    const value = vars.get(name);
    if (value === undefined || value === '') throw new Error(`supabase status: немає ${name}`);
    return value;
  };
  return {
    apiUrl: get('API_URL'),
    dbUrl: get('DB_URL'),
    anonKey: vars.get('PUBLISHABLE_KEY') ?? get('ANON_KEY'),
  };
}
