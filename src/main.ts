/**
 * Composition root: складає модулі й запускає сервер (architecture.md, розд. 2).
 */
import { buildServer } from './modules/http/index.ts';
import { createSystemInfo } from './modules/system/index.ts';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';

const app = buildServer({ system: createSystemInfo() });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close();
  });
}

await app.listen({ port, host });
