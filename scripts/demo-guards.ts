/**
 * Відтворювана демонстрація конвеєра (spec.md, крит. 5, 7, 10): у тимчасовому клоні HEAD
 * запускає `make install` + `make check`, робить брудний коміт, коміт із поганим повідомленням,
 * пуші зі зламаною збіркою та smoke і порушення меж модулів. Реальний вивід кожного
 * сценарію пише в docs/specs/lab1-foundation/reports/. Робочу копію не змінює.
 */
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPORTS = join(process.cwd(), 'docs/specs/lab1-foundation/reports');
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

function edit(file: string, change: (text: string) => string): void {
  writeFileSync(file, change(readFileSync(file, 'utf8')));
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
    `# Відтворити: make demo (сценарій «${title}»)`,
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
// Старі звіти прибираємо, щоб у reports/ лишався вивід лише цього запуску.
rmSync(REPORTS, { recursive: true, force: true });
mkdirSync(REPORTS, { recursive: true });

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
  report('01-clean-clone-check', 'чистий клон: make install && make check', false, [
    run('make install', repo),
    run('git config core.hooksPath', repo),
    run('make check', repo),
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
  // тож падає саме `make build` (крит. 7, C7).
  reset();
  writeFileSync(file('scripts/outside.ts'), 'export const outside = 1;\n');
  edit(file('src/main.ts'), (t) =>
    t
      .replace(
        "import { buildServer } from './modules/http/index.ts';",
        "import { outside } from '../scripts/outside.ts';\nimport { buildServer } from './modules/http/index.ts';",
      )
      .replace('const app =', 'void outside;\n\nconst app ='),
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
    [run('make boundaries', repo)],
  );
} finally {
  rmSync(root, { recursive: true, force: true, maxRetries: 3 });
}
