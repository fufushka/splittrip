/**
 * `npm test` — усі рівні тестів однією командою (spec лаби 3, крит. 1, 6–8; ADR-0024; C14).
 * Етапи — architecture.md лаби 3, розд. 2: Docker → Supabase → база `run_<id>` → unit →
 * інтеграційні з покриттям → збірка й старт застосунку → E2E → пороги покриття. Перший
 * провал зупиняє решту; застосунок і базу `finally` прибирає після будь-якого результату.
 * `npm test -- --report` ще й пише вивід у docs/specs/lab3-testing/reports/npm-test.txt.
 */
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { type RunDatabase, openRunDatabase } from './run-db.ts';

const REPORT = 'docs/specs/lab3-testing/reports/npm-test.txt';
const APP_LOG = 'coverage/e2e-app.log';
const READY_TIMEOUT_MS = 20_000;
const STOP_TIMEOUT_MS = 5_000;
const LOG_TAIL_LINES = 20;

type Status = 'OK' | 'ПОМИЛКА' | 'пропущено';

interface Stage {
  readonly title: string;
  status: Status;
  ms?: number;
}

const stages: Stage[] = [];
const stage = (title: string): Stage => {
  const created: Stage = { title, status: 'пропущено' };
  stages.push(created);
  return created;
};
const docker = stage('Docker');
const supabase = stage('Supabase');
const database = stage('база');
const unit = stage('unit');
const integration = stage('інтеграційні');
const application = stage('застосунок');
const e2e = stage('E2E');
const thresholds = stage('пороги');
const cleanup: Stage = { title: 'прибирання', status: 'пропущено' };

const withReport = process.argv.includes('--report');
const head = withReport
  ? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  : '';

/** Увесь вивід (свій і дочірніх процесів) — у консоль і в звіт `--report`. */
const transcript: string[] = [];
function print(text: string, stream: NodeJS.WriteStream = process.stdout): void {
  stream.write(text);
  transcript.push(text);
}
const say = (text: string): void => {
  print(`${text}\n`);
};
const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** SIGINT/SIGTERM — як падіння поточного етапу: далі лише прибирання. */
const interrupt = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    interrupt.abort(new Error(`перервано сигналом ${signal}`));
  });
}
const interrupted = new Promise<never>((_resolve, reject) => {
  interrupt.signal.addEventListener(
    'abort',
    () => {
      reject(interrupt.signal.reason as Error);
    },
    { once: true },
  );
});
interrupted.catch(() => undefined);

interface ExecOptions {
  readonly env?: NodeJS.ProcessEnv;
  /** `npm`/`npx` — через shell, як у demo-guards.ts. */
  readonly shell?: boolean;
  /** `false` — вивід не показується й не збирається (у `supabase status -o env` — ключі). */
  readonly echo?: boolean;
}

/** Дочірній процес із pipe: вивід — у консоль і в звіт; результат — код виходу. */
function exec(
  command: string,
  args: readonly string[],
  options: ExecOptions = {},
): Promise<number> {
  const echo = options.echo ?? true;
  if (echo) say(`$ ${[command === process.execPath ? 'node' : command, ...args].join(' ')}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env ?? process.env,
      shell: options.shell ?? false,
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: interrupt.signal,
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (echo) print(chunk);
    });
    child.stderr.on('data', (chunk: string) => {
      if (echo) print(chunk, process.stderr);
    });
    child.once('error', (error) => {
      child.stdout.destroy();
      child.stderr.destroy();
      reject(error);
    });
    child.once('close', (code) => {
      resolve(code ?? 1);
    });
  });
}

async function must(
  command: string,
  args: readonly string[],
  options: ExecOptions = {},
): Promise<void> {
  const code = await exec(command, args, options);
  if (code !== 0) throw new Error(`код виходу ${String(code)}`);
}

/** Етап: заголовок `== [N/8] … ==`, статус і тривалість для підсумкової таблиці (крит. 1). */
async function run<T>(current: Stage, body: () => Promise<T>): Promise<T> {
  say(`== [${String(stages.indexOf(current) + 1)}/${String(stages.length)}] ${current.title} ==`);
  const started = performance.now();
  try {
    interrupt.signal.throwIfAborted();
    const result = await Promise.race([body(), interrupted]);
    current.status = 'OK';
    return result;
  } catch (error) {
    current.status = 'ПОМИЛКА';
    say(`${current.title}: ПОМИЛКА — ${reason(error)}`);
    throw error;
  } finally {
    current.ms = performance.now() - started;
  }
}

/** Ресурси для прибирання: з'являються всередині етапів 3 і 6. */
const resources: { db?: RunDatabase; app?: ChildProcess } = {};

/** Вільний порт через `listen(0)`, як у smoke (ADR-0004). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address !== null && typeof address === 'object') resolve(address.port);
        else reject(new Error('не вдалося отримати вільний порт'));
      });
    });
  });
}

function logTail(): string {
  const lines = readFileSync(APP_LOG, 'utf8').trimEnd().split(/\r?\n/).slice(-LOG_TAIL_LINES);
  return [`хвіст ${APP_LOG}:`, ...lines].join('\n');
}

/**
 * `node dist/main.js` (architecture.md, розд. 3): env інтеграційних + `PORT`, `HOST`, без
 * `APP_VERSION` (крит. 12 перевіряє git, а не відлуння env) і `NODE_V8_COVERAGE`, без
 * `--env-file`; вивід — у coverage/e2e-app.log. Чекає `GET /ready` = 200; повертає базовий URL.
 */
async function startApp(env: NodeJS.ProcessEnv): Promise<string> {
  const port = await freePort();
  const appEnv: NodeJS.ProcessEnv = { ...env, PORT: String(port), HOST: '127.0.0.1' };
  delete appEnv.APP_VERSION;
  delete appEnv.NODE_V8_COVERAGE;
  mkdirSync(dirname(APP_LOG), { recursive: true });
  say(`$ node dist/main.js (HOST=127.0.0.1 PORT=${String(port)}, вивід → ${APP_LOG})`);
  const log = openSync(APP_LOG, 'w');
  let app: ChildProcess;
  try {
    app = spawn(process.execPath, ['dist/main.js'], { env: appEnv, stdio: ['ignore', log, log] });
  } finally {
    closeSync(log);
  }
  resources.app = app;
  app.on('error', () => undefined);
  if (app.pid === undefined) throw new Error('не вдалося запустити node dist/main.js');

  const url = `http://127.0.0.1:${String(port)}`;
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (app.exitCode !== null || app.signalCode !== null) {
      const code = String(app.exitCode ?? app.signalCode);
      throw new Error(`застосунок завершився (${code}) до GET /ready 200\n${logTail()}`);
    }
    const status = await fetch(`${url}/ready`, {
      signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
    }).then(
      async (res) => {
        await res.arrayBuffer();
        return res.status;
      },
      () => undefined, // Сервер ще не слухає порт.
    );
    if (status === 200) {
      say(`застосунок готовий: ${url} (GET /ready 200)`);
      return url;
    }
    await delay(100);
  }
  throw new Error(
    `GET /ready не відповів 200 за ${String(READY_TIMEOUT_MS / 1000)} с\n${logTail()}`,
  );
}

/** SIGTERM; якщо за 5 с не завершився — SIGKILL. `false` — процес уже завершився сам. */
async function stopApp(app: ChildProcess): Promise<boolean> {
  if (app.pid === undefined || app.exitCode !== null || app.signalCode !== null) return false;
  const exited = new Promise((resolve) => app.once('exit', resolve));
  app.kill('SIGTERM');
  const timer = setTimeout(() => app.kill('SIGKILL'), STOP_TIMEOUT_MS);
  await exited;
  clearTimeout(timer);
  return true;
}

const duration = (ms: number | undefined): string =>
  ms === undefined ? '—' : `${(ms / 1000).toFixed(1).replace('.', ',')} с`;

function summary(): void {
  const rows = [
    ['етап', 'результат', 'тривалість'],
    ...stages.map((s, i) => [`${String(i + 1)}. ${s.title}`, s.status, duration(s.ms)]),
    [cleanup.title, cleanup.status, duration(cleanup.ms)],
  ];
  const width = (column: number): number =>
    Math.max(...rows.map((row) => row[column]?.length ?? 0));
  say('== підсумок ==');
  for (const [title = '', status = '', time = ''] of rows) {
    say(`${title.padEnd(width(0))}  ${status.padEnd(width(1))}  ${time}`);
  }
}

function writeReport(code: number): void {
  const output = transcript.join('').split(/\r?\n/).join('\n').trim();
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(
    REPORT,
    [
      '# Відтворити: npm test -- --report (потрібен Docker)',
      `# HEAD: ${head}`,
      `# Код виходу: ${String(code)}`,
      '',
      output,
      '',
    ].join('\n'),
  );
  console.log(`npm test: звіт → ${REPORT}`);
}

let failed = false;
try {
  await run(docker, async () => {
    const code = await exec('docker', ['info']).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      throw new Error('Docker CLI не знайдено (docker: ENOENT)', { cause: error });
    });
    if (code !== 0) throw new Error(`docker info: код виходу ${String(code)} — Docker не запущено`);
  });

  await run(supabase, async () => {
    say('$ npx supabase status -o env (вивід не показується: ключі)');
    const code = await exec('npx supabase status -o env', [], { shell: true, echo: false });
    if (code === 0) {
      say('Supabase уже запущено');
      return;
    }
    say('Supabase не запущено → npm run db:start');
    await must('npm run db:start', [], { shell: true });
  });

  const db = await run(database, async () => {
    const opened = openRunDatabase();
    resources.db = opened;
    await opened.create();
    say(`npm test: база ${opened.name}`);
    await opened.migrate();
    return opened;
  });
  const integrationEnv: NodeJS.ProcessEnv = { ...process.env, ...db.env };

  await run(unit, () => must('npm run test:unit', [], { shell: true }));

  await run(integration, () => must('npm run test:cov', [], { shell: true, env: integrationEnv }));

  const baseUrl = await run(application, async () => {
    await must('npm run build', [], { shell: true });
    return startApp(integrationEnv);
  });

  await run(e2e, () =>
    must(process.execPath, ['--test', '--test-timeout=60000', 'test/e2e/*.test.ts'], {
      env: { ...process.env, E2E_BASE_URL: baseUrl },
    }),
  );

  await run(thresholds, () =>
    must(process.execPath, ['scripts/check-coverage.ts', 'coverage/lcov.info']),
  );
} catch {
  failed = true;
} finally {
  say('== прибирання ==');
  const started = performance.now();
  cleanup.status = 'OK';
  if (resources.app !== undefined) {
    say((await stopApp(resources.app)) ? 'застосунок зупинено' : 'застосунок уже завершився');
  }
  if (resources.db !== undefined) {
    try {
      await resources.db.drop();
      say(`npm test: базу ${resources.db.name} видалено`);
    } catch (error) {
      cleanup.status = 'ПОМИЛКА';
      say(`прибирання: ПОМИЛКА — базу ${resources.db.name} не видалено: ${reason(error)}`);
    }
  }
  if (resources.app === undefined && resources.db === undefined) say('нічого прибирати');
  cleanup.ms = performance.now() - started;
}

const exitCode = failed || cleanup.status !== 'OK' ? 1 : 0;
summary();
if (withReport) writeReport(exitCode);
process.exitCode = exitCode;
