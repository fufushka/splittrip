/**
 * Складання застосунку (architecture.md лаби 2, розд. 1): ресурси процесу створюються тут
 * один раз і передаються у фабрики (ADR-0016). Вибір `STORAGE` — лише тут. Окремо від
 * `main.ts`, щоб API-тести складали той самий застосунок (правило: ніхто не імпортує main).
 */
import { createMemoryAuth } from './modules/auth/index.ts';
import { type Server, buildServer } from './modules/http/index.ts';
import { createIdempotency } from './modules/idempotency/index.ts';
import { createMemoryStorage } from './modules/storage/index.ts';
import { createSystemInfo } from './modules/system/index.ts';
import { createTripService } from './modules/trips/index.ts';

export interface ComposeOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly logStream?: { write(line: string): void };
  /** Лише для фейкового Auth: час життя access-токена (тест прострочення). */
  readonly accessTokenTtlSeconds?: number;
}

export interface App {
  readonly server: Server;
  close(): Promise<void>;
}

export async function composeApp(options: ComposeOptions = {}): Promise<App> {
  const env = options.env ?? process.env;
  const kind = env.STORAGE ?? 'memory';
  if (kind !== 'memory') {
    throw new Error(`STORAGE=${kind} не підтримується; доступно: memory`);
  }

  const storage = createMemoryStorage();
  const auth = await createMemoryAuth(
    options.accessTokenTtlSeconds === undefined
      ? {}
      : { accessTokenTtlSeconds: options.accessTokenTtlSeconds },
  );

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
