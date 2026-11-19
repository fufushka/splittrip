/**
 * Точка входу процесу: складає застосунок (compose.ts) і запускає сервер. Недоступна БД чи
 * неповна конфігурація на старті — зрозуміле повідомлення й код виходу 1 (spec, крит. 9).
 */
import { composeApp } from './compose.ts';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';

try {
  const app = await composeApp();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void app.close();
    });
  }
  await app.server.listen({ port, host });
} catch (error) {
  const cause =
    error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : '';
  console.error(`splittrip: не вдалося стартувати — ${String(error)}${cause}`);
  process.exit(1);
}
