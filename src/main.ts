/**
 * Точка входу процесу: складає застосунок (compose.ts) і запускає сервер.
 */
import { composeApp } from './compose.ts';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';

const app = await composeApp();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close();
  });
}

await app.server.listen({ port, host });
