/**
 * Складання застосунку (architecture.md лаби 2, розд. 1): ресурси процесу створюються тут
 * один раз і передаються у фабрики (ADR-0016). Вибір `STORAGE` — лише тут. Окремо від
 * `main.ts`, щоб API-тести складали той самий застосунок (правило: ніхто не імпортує main).
 */
import { type AuthProvider, createMemoryAuth, createSupabaseAuth } from './modules/auth/index.ts';
import { type Server, buildServer } from './modules/http/index.ts';
import { createIdempotency } from './modules/idempotency/index.ts';
import {
  type Storage,
  createMemoryStorage,
  createPostgresStorage,
} from './modules/storage/index.ts';
import { createSystemInfo } from './modules/system/index.ts';
import { createTripService } from './modules/trips/index.ts';

export interface ComposeOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly logStream?: { write(line: string): void };
  /** Лише для фейкового Auth: час життя access-токена (тест прострочення). */
  readonly accessTokenTtlSeconds?: number;
  /** Кожен SQL-запит — для лічильника N+1 (spec, крит. 10). */
  readonly onQuery?: (query: string) => void;
}

export interface App {
  readonly server: Server;
  close(): Promise<void>;
}

/** Помилка конфігурації: процес не стартує (spec «Збої»: падати одразу). */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') {
    throw new ConfigError(`Потрібна змінна середовища ${name}`);
  }
  return value;
}

async function resources(
  env: NodeJS.ProcessEnv,
  options: ComposeOptions,
): Promise<{ storage: Storage; auth: AuthProvider }> {
  const kind = env.STORAGE ?? 'memory';
  if (kind === 'memory') {
    const auth = await createMemoryAuth(
      options.accessTokenTtlSeconds === undefined
        ? {}
        : { accessTokenTtlSeconds: options.accessTokenTtlSeconds },
    );
    return { storage: createMemoryStorage(), auth };
  }
  if (kind === 'postgres') {
    const url = required(env, 'DATABASE_URL');
    // Supavisor transaction mode (порт 6543) не підтримує prepared statements (ADR-0015).
    const prepare =
      (env.DATABASE_PREPARE ?? (url.includes(':6543/') ? 'false' : 'true')) === 'true';
    const auth = createSupabaseAuth({
      url: required(env, 'SUPABASE_URL'),
      apiKey: required(env, 'SUPABASE_ANON_KEY'),
    });
    const storage = await createPostgresStorage({
      url,
      prepare,
      ...(options.onQuery === undefined ? {} : { onQuery: options.onQuery }),
    });
    return { storage, auth };
  }
  throw new ConfigError(`STORAGE=${kind} не підтримується; доступно: memory, postgres`);
}

export async function composeApp(options: ComposeOptions = {}): Promise<App> {
  const env = options.env ?? process.env;
  const { storage, auth } = await resources(env, options);

  const server = buildServer({
    system: createSystemInfo(env, () => storage.ping()),
    trips: createTripService({ repo: storage.trips }),
    auth,
    idempotency: createIdempotency({ store: storage.idempotency }),
    ...(env.LOG_LEVEL === undefined ? {} : { logLevel: env.LOG_LEVEL }),
    ...(options.logStream === undefined ? {} : { logStream: options.logStream }),
  });

  return {
    server,
    async close() {
      await server.close();
      await storage.close();
    },
  };
}
