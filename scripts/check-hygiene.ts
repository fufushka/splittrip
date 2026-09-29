/**
 * C3 — чистота репозиторію (standarts/repository.md, standarts/checks.md).
 * Перевіряє індекс git, тобто саме те, що потрапить у коміт.
 */
import { execFileSync } from 'node:child_process';
import { basename, extname } from 'node:path';

/** Дозволені файли без розширення (standarts/repository.md). */
const ALLOWED_EXTENSIONLESS = new Set([
  'Makefile',
  'LICENSE',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  '.husky/pre-commit',
  '.husky/commit-msg',
  '.husky/pre-push',
]);

const FORBIDDEN_PATHS: readonly [RegExp, string][] = [
  [/(^|\/)node_modules\//, 'встановлені залежності'],
  [/^(dist|coverage)\//, 'артефакт збірки'],
  [/\.tsbuildinfo$/, 'артефакт збірки'],
  [/\.log$/, 'лог'],
  [/(^|\/)\.env(\.(?!example$)[^/]+)?$/, 'файл із секретами'],
  [/\.(pem|key|p12|pfx)$/, 'ключ або сертифікат'],
  [/(^|\/)(\.DS_Store|Thumbs\.db)$/, 'файл ОС'],
  [/^\.(idea|vscode)\//, 'файл IDE'],
];

/** Шаблони секретів у вмісті; базовий рівень — див. ADR-0007. */
const SECRET_PATTERNS: readonly [string, string][] = [
  ['-----BEGIN ([A-Z]+ )?PRIVATE KEY-----', 'приватний ключ'],
  ['AKIA[0-9A-Z]{16}', 'ключ AWS'],
  ['gh[pousr]_[A-Za-z0-9]{36}', 'токен GitHub'],
  ['sk-ant-[A-Za-z0-9_-]{20,}', 'ключ Anthropic'],
  ['sk-[A-Za-z0-9]{32,}', 'ключ API'],
];

function git(args: readonly string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function trackedFiles(): string[] {
  return git(['ls-files', '--cached', '-z']).split('\0').filter(Boolean);
}

function secretHits(pattern: string): string[] {
  try {
    // -e обов'язковий: шаблон може починатися з «-».
    return git(['grep', '--cached', '-I', '-n', '-E', '-e', pattern]).split('\n').filter(Boolean);
  } catch (error) {
    // Код 1 — збігів немає; будь-який інший — помилка перевірки, а не «чисто».
    if ((error as { status?: number }).status === 1) return [];
    throw error;
  }
}

const problems: string[] = [];

for (const file of trackedFiles()) {
  const forbidden = FORBIDDEN_PATHS.find(([re]) => re.test(file));
  if (forbidden) problems.push(`${file}: ${forbidden[1]} не комітиться`);

  if (extname(basename(file)) === '' && !ALLOWED_EXTENSIONLESS.has(file)) {
    problems.push(`${file}: файл без розширення не з дозволеного списку`);
  }
}

for (const [pattern, label] of SECRET_PATTERNS) {
  for (const hit of secretHits(pattern)) {
    problems.push(`${hit.split(':').slice(0, 2).join(':')}: схоже на ${label}`);
  }
}

if (problems.length > 0) {
  console.error('C3 hygiene: репозиторій не чистий');
  for (const problem of problems) console.error(`  ✘ ${problem}`);
  process.exit(1);
}
console.log('C3 hygiene: репозиторій чистий');
