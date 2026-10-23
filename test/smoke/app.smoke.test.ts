/**
 * Smoke-тест зібраного застосунку (spec.md, крит. 8; spec-fix-01, п. 1; ADR-0004).
 * Запускає `dist/main.js` окремим процесом, щоб перевірити саме старт, а не виклик у пам'яті.
 */
import assert from 'node:assert/strict';
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ENTRY = fileURLToPath(new URL('../../dist/main.js', import.meta.url));
const STARTUP_TIMEOUT_MS = 10_000;

const running: ChildProcess[] = [];

after(() => {
  for (const child of running) child.kill();
});

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address !== null && typeof address === 'object') resolve(address.port);
        else reject(new Error('Не вдалося отримати вільний порт'));
      });
    });
  });
}

/** Запускає застосунок і чекає, доки `/health` не відповість. Повертає базовий URL. */
async function startApp(env: Record<string, string> = {}): Promise<string> {
  const port = await freePort();
  const child = spawn(process.execPath, [ENTRY], {
    env: { ...process.env, ...env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: 'ignore',
  });
  running.push(child);

  const baseUrl = `http://127.0.0.1:${String(port)}`;
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Застосунок завершився з кодом ${String(child.exitCode)}`);
    }
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return baseUrl;
    } catch {
      // Сервер ще не слухає порт.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Застосунок не відповів за ${String(STARTUP_TIMEOUT_MS)} мс`);
}

function gitHead(): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
}

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url);
  return { status: res.status, body: await res.json() };
}

describe('smoke: зібраний застосунок', () => {
  it('зібраний вхід dist/main.js існує', () => {
    assert.ok(existsSync(ENTRY), `Немає ${ENTRY} — спершу make build`);
  });

  it('стартує й відповідає на /health', async () => {
    const baseUrl = await startApp();
    assert.deepEqual(await getJson(`${baseUrl}/health`), { status: 200, body: { status: 'ok' } });
  });

  it('/version повертає sha поточного коміту', async () => {
    const baseUrl = await startApp();
    const { status, body } = await getJson(`${baseUrl}/version`);
    assert.equal(status, 200);
    const { version } = body as { version: string };
    assert.match(version, /^([0-9a-f]{40}|unknown)$/);
    const head = gitHead();
    if (head !== undefined) assert.equal(version, head);
  });

  it('/version повертає APP_VERSION, якщо її задано', async () => {
    const sha = 'a'.repeat(40);
    const baseUrl = await startApp({ APP_VERSION: sha });
    assert.deepEqual(await getJson(`${baseUrl}/version`), { status: 200, body: { version: sha } });
  });

  it('/version повертає unknown без git, а застосунок усе одно стартує', async () => {
    const baseUrl = await startApp({
      GIT_DIR: fileURLToPath(new URL('./no-such-git-dir', import.meta.url)),
    });
    const { body } = await getJson(`${baseUrl}/version`);
    assert.deepEqual(body, { version: 'unknown' });
  });
});
