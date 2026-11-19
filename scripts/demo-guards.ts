/**
 * Відтворювана демонстрація конвеєра (лаба 1, крит. 5, 7, 10; лаба 2, крит. 3, 4; C11): у тимчасовому клоні HEAD
 * запускає `npm ci` + `npm run check`, робить брудний коміт, коміт із поганим повідомленням,
 * пуші зі зламаною збіркою та smoke і порушення меж модулів. Реальний вивід кожного
 * сценарію пише в docs/specs/lab2-api-db/reports/. Робочу копію не змінює.
 */
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPORTS = join(process.cwd(), 'docs/specs/lab2-api-db/reports');
const ENV = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };

interface Result {
  readonly command: string;
  readonly code: number;
  readonly output: string;
}

function run(command: string, cwd: string): Result {
  const res = spawnSync(command, { cwd, shell: true, encoding: 'utf8', env: ENV });
  return { command, code: res.status ?? -1, output: `${res.stdout}${res.stderr}`.trim() };
}

function must(command: string, cwd: string): void {
  const res = run(command, cwd);
  if (res.code !== 0)
    throw new Error(`«${command}» завершилась з кодом ${String(res.code)}\n${res.output}`);
}

/** Підміна, що нічого не змінила, — помилка сценарію, а не «успіх» (код міг змінитися). */
function edit(file: string, change: (text: string) => string): void {
  const before = readFileSync(file, 'utf8');
  const after = change(before);
  if (after === before) throw new Error(`Сценарій не застосовано: ${file} не змінився`);
  writeFileSync(file, after);
}

function report(
  name: string,
  title: string,
  expectFail: boolean,
  results: readonly Result[],
): void {
  const failed = results.some((r) => r.code !== 0);
  const verdict = expectFail === failed ? 'OK' : 'НЕОЧІКУВАНО';
  const body = [
    `# Відтворити: npm run demo (сценарій «${title}»)`,
    `# Очікування: ${expectFail ? 'відмова' : 'успіх'}; результат: ${verdict}`,
    `# HEAD: ${head}`,
    '',
    ...results.flatMap((r) => [`$ ${r.command}`, r.output, `[код виходу: ${String(r.code)}]`, '']),
  ].join('\n');
  writeFileSync(join(REPORTS, `${name}.txt`), body);
  console.log(`${verdict.padEnd(12)} ${name}`);
  if (verdict !== 'OK') process.exitCode = 1;
}

const head = run('git rev-parse HEAD', process.cwd()).output;
const root = mkdtempSync(join(tmpdir(), 'splittrip-demo-'));
const repo = join(root, 'repo');
const remote = join(root, 'remote.git');
// Прибираємо лише власні старі звіти (01–08): у reports/ лаби 2 лежать і звіти інших
// команд (report:db, cloud-run), яких demo не відтворює.
mkdirSync(REPORTS, { recursive: true });
for (const name of readdirSync(REPORTS)) {
  if (/^0[1-8][a-z]?-.*\.txt$/.test(name)) rmSync(join(REPORTS, name));
}

try {
  console.log(`Клон HEAD ${head} у ${repo}`);
  must(`git clone --quiet "${process.cwd()}" "${repo}"`, root);
  must(`git init --quiet --bare "${remote}"`, root);
  const reset = (): void => {
    must(`git reset --quiet --hard ${head}`, repo);
    must('git clean -fdq', repo);
  };
  const file = (path: string): string => join(repo, path);

  // 1. Чистий клон: одна команда запускає всі перевірки (крит. 5, 6).
  report('01-clean-clone-check', 'чистий клон: npm ci && npm run check', false, [
    run('npm ci', repo),
    run('git config core.hooksPath', repo),
    run('npm run check', repo),
  ]);

  // 2. Брудний коміт: порушення формату й лінту (крит. 7, C1, C2).
  reset();
  writeFileSync(file('src/modules/money/dirty.ts'), 'var   unused = 1\nexport const x=1\n');
  must('git add src/modules/money/dirty.ts', repo);
  report('02-dirty-commit-rejected', 'коміт із порушенням стилю й лінту', true, [
    run('git commit -m "feat(money): демо брудного коміту"', repo),
  ]);

  // 2b. Формат правильний, але лінт — ні: відмову дає саме ESLint (C2).
  reset();
  writeFileSync(file('src/modules/money/lint.ts'), 'export var legacy = 1;\n');
  must('git add src/modules/money/lint.ts', repo);
  report('02b-lint-commit-rejected', 'коміт із порушенням лінту за правильного формату', true, [
    run('git commit -m "feat(money): демо порушення лінту"', repo),
  ]);

  // 2c. Секрети й файли поза списком: відмову дає перевірка чистоти репо (C3).
  reset();
  writeFileSync(file('.env'), 'API_TOKEN=demo\n');
  writeFileSync(file('NOTES'), 'файл без розширення\n');
  // Заголовок ключа збираємо з частин, інакше C3 справедливо заблокує коміт цього скрипта.
  const fakeKeyHeader = ['-----BEGIN RSA', 'PRIVATE KEY-----'].join(' ');
  writeFileSync(file('docs/key.txt'), `${fakeKeyHeader}\ndemo\n`);
  must('git add -f .env NOTES docs/key.txt', repo);
  report(
    '02c-hygiene-commit-rejected',
    'коміт із .env, приватним ключем і файлом поза списком',
    true,
    [run('git commit -m "chore: демо брудного репозиторію"', repo)],
  );

  // 3. Повідомлення коміту не за стандартом (C4).
  reset();
  report('03-bad-commit-message-rejected', 'коміт із повідомленням не за стандартом', true, [
    run('git commit --allow-empty -m "update stuff."', repo),
  ]);

  // 4. Пуш із помилкою типів: код проходить pre-commit, але не проходить tsc (крит. 7, C5).
  reset();
  appendFileSync(
    file('src/modules/money/index.ts'),
    "\nexport const broken: number = 'не число';\n",
  );
  must('git add src/modules/money/index.ts', repo);
  const typeError = run('git commit -m "feat(money): демо помилки типів"', repo);
  report('04-type-error-push-rejected', 'пуш із помилкою типів', true, [
    typeError,
    run(`git push "${remote}" HEAD:refs/heads/demo-types`, repo),
  ]);

  // 4b. Пуш зі зламаною збіркою: типи й межі цілі, але src імпортує файл поза rootDir,
  // тож падає саме `npm run build` (крит. 7, C7).
  reset();
  writeFileSync(file('scripts/outside.ts'), 'export const outside = 1;\n');
  edit(file('src/main.ts'), (t) =>
    t
      .replace(
        "import { composeApp } from './compose.ts';",
        "import { outside } from '../scripts/outside.ts';\nimport { composeApp } from './compose.ts';",
      )
      .replace(
        '  const app = await composeApp();',
        '  void outside;\n  const app = await composeApp();',
      ),
  );
  must('git add scripts/outside.ts src/main.ts', repo);
  const brokenBuild = run('git commit -m "feat: демо зламаної збірки"', repo);
  report('04b-broken-build-push-rejected', 'пуш зі зламаною збіркою', true, [
    brokenBuild,
    run(`git push "${remote}" HEAD:refs/heads/demo-build`, repo),
  ]);

  // 5. Пуш зі зламаним smoke: збірка ціла, але /health відповідає не за spec (крит. 7, C8).
  reset();
  edit(file('src/modules/http/index.ts'), (t) =>
    t.replace("({ status: 'ok' })", "({ status: 'down' })"),
  );
  must('git add src/modules/http/index.ts', repo);
  const brokenSmoke = run('git commit -m "feat(http): демо зламаного smoke"', repo);
  report('05-broken-smoke-push-rejected', 'пуш зі зламаним smoke-тестом', true, [
    brokenSmoke,
    run(`git push "${remote}" HEAD:refs/heads/demo-smoke`, repo),
  ]);

  // 6. Межі модулів: обхід index.ts, заборонений напрям, цикл, модуль поза архітектурою (крит. 10).
  reset();
  mkdirSync(file('src/modules/trips/internal'), { recursive: true });
  writeFileSync(file('src/modules/trips/internal/secret.ts'), 'export const secret = 1;\n');
  appendFileSync(
    file('src/modules/money/index.ts'),
    "import type { Balance } from '../balances/index.ts';\n" +
      "export { secret } from '../trips/internal/secret.ts';\n" +
      'export type Cycle = Balance;\n',
  );
  mkdirSync(file('src/modules/users'), { recursive: true });
  writeFileSync(
    file('src/modules/users/index.ts'),
    "import type { Money } from '../money/index.ts';\nexport type UserMoney = Money;\n",
  );
  report(
    '06-boundaries-violations',
    'обхід index.ts, напрям, цикл, модуль поза архітектурою',
    true,
    [run('npm run boundaries', repo)],
  );

  // 6b. Межі шарів лаби 2 (крит. 3): SQL-драйвер у роутах, AsyncLocalStorage і fastify у
  // сервісі, jose у сховищі — кожне має валити C6.
  reset();
  appendFileSync(
    file('src/modules/http/routes/trips.ts'),
    "import postgres from 'postgres';\nexport const leakedSql = postgres;\n",
  );
  appendFileSync(
    file('src/modules/trips/service.ts'),
    "import { AsyncLocalStorage } from 'node:async_hooks';\n" +
      "import Fastify from 'fastify';\n" +
      'export const leaked = [AsyncLocalStorage, Fastify];\n',
  );
  appendFileSync(
    file('src/modules/storage/index.ts'),
    "import { decodeJwt } from 'jose';\nexport const leakedJwt = decodeJwt;\n",
  );
  report('06b-layer-violations', 'SQL у роутах, ALS і fastify у сервісі, jose у сховищі', true, [
    run('npm run boundaries', repo),
  ]);

  // 7. try/catch у сервісі замість одного глобального обробника (крит. 4, C2).
  reset();
  edit(file('src/modules/trips/service.ts'), (t) =>
    t.replace(
      'const get = async (tripId: string): Promise<Trip> => owned(await repo.findById(tripId), tripId);',
      'const get = async (tripId: string): Promise<Trip> => {\n' +
        '    try {\n      return owned(await repo.findById(tripId), tripId);\n' +
        "    } catch {\n      throw new NotFoundError('trip_not_found', tripId);\n    }\n  };",
    ),
  );
  must('git add src/modules/trips/service.ts', repo);
  report('07-try-in-service-commit-rejected', 'try/catch у сервісі trips', true, [
    run('git commit -m "feat(trips): демо try у сервісі"', repo),
  ]);

  // 8. Пуш зі зламаним сценарієм API: прибрано перевірку власника — типи, лінт, межі й smoke
  // цілі, падають лише API-тести (C11).
  reset();
  edit(file('src/modules/trips/service.ts'), (t) =>
    t.replace('if (trip?.ownerId !== currentUser()) {', 'if (trip === null) {'),
  );
  must('git add src/modules/trips/service.ts', repo);
  const brokenApi = run('git commit -m "feat(trips): демо без перевірки власника"', repo);
  report('08-broken-api-push-rejected', 'пуш без перевірки власника поїздки', true, [
    brokenApi,
    run(`git push "${remote}" HEAD:refs/heads/demo-api`, repo),
  ]);
} finally {
  rmSync(root, { recursive: true, force: true, maxRetries: 3 });
}
