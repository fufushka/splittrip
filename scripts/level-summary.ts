/**
 * Репортер `node:test` для `npm run test:cov` (spec лаби 3, крит. 1; architecture.md лаби 3,
 * розд. 2 і 4): unit і API йдуть одним запуском, бо покриття Node зводиться лише в його
 * межах, а підсумок друкується окремо за рівнями — за каталогом тест-файлу. `test/api/` —
 * «інтеграційні» з `STORAGE=postgres` (`npm test`), інакше «API (memory)» (check).
 * Лічить, як сам Node: без `suite`; skip і todo — «пропущено»; файл, що впав до тестів, —
 * один тест, що впав.
 */
import { relative, sep } from 'node:path';
import type { TestEvent } from 'node:test/reporters';

interface Level {
  readonly dir: string;
  readonly label: string;
  tests: number;
  passed: number;
  failed: number;
  skipped: number;
}

export default async function* levelSummary(
  source: AsyncIterable<TestEvent>,
): AsyncGenerator<string, void> {
  const levels: Level[] = [
    { dir: 'test/unit/', label: 'unit', tests: 0, passed: 0, failed: 0, skipped: 0 },
    {
      dir: 'test/api/',
      label: process.env.STORAGE === 'postgres' ? 'інтеграційні' : 'API (memory)',
      tests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
    },
  ];

  for await (const event of source) {
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    const { data } = event;
    if (data.details.type === 'suite' || data.file === undefined) continue;
    const file = relative(process.cwd(), data.file).split(sep).join('/');
    const level = levels.find(({ dir }) => file.startsWith(dir));
    if (level === undefined) continue;

    level.tests += 1;
    if (data.skip !== undefined || data.todo !== undefined) level.skipped += 1;
    else if (event.type === 'test:fail') level.failed += 1;
    else level.passed += 1;
  }

  const width = Math.max(...levels.map(({ label }) => label.length));
  yield '\nПідсумок за рівнями:\n';
  for (const { label, tests, passed, failed, skipped } of levels) {
    yield `  ${label.padEnd(width)} · тестів ${String(tests)} · пройшло ${String(passed)} · ` +
      `впало ${String(failed)} · пропущено ${String(skipped)}\n`;
  }
}
