/**
 * `npm run report:db` — звіт поведінки на БД (spec, крит. 8–10): ретраї, падіння БД посеред
 * роботи, fail-fast старту, N+1, обмеження БД. Проганяє test/api/postgres.test.ts в окремій
 * базі (`npm run test:api:db`) і зберігає реальний вивід у reports/. Потрібен Docker.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const REPORT = 'docs/specs/lab2-api-db/reports/09-db-behaviour.txt';
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

const result = spawnSync(process.execPath, ['scripts/test-db.ts', 'test/api/postgres.test.ts'], {
  encoding: 'utf8',
  env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
});
const output = `${result.stdout}${result.stderr}`
  // Рядки логів застосунку (JSON) — шум для рев'ю; лишаємо вивід раннера тестів.
  .split(/\r?\n/)
  .filter((line) => !line.startsWith('{"level"'))
  .join('\n')
  .trim();

writeFileSync(
  REPORT,
  [
    '# Відтворити: npm run report:db (потрібен Docker і npm run db:start)',
    `# HEAD: ${head}`,
    `# Код виходу: ${String(result.status)}`,
    '',
    output,
    '',
  ].join('\n'),
);
console.log(`report:db → ${REPORT} (код ${String(result.status)})`);
process.exitCode = result.status ?? 1;
