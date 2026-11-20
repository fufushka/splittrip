/**
 * `npm run mutation [-- before|after]` — мутаційне тестування (spec лаби 3, крит. 13, 14, 16;
 * C15; ADR-0022; architecture.md лаби 3, розд. 5): два запуски Stryker послідовно — `balances`
 * з `break: 100`, потім `money`, `trips/domain`, `trips/service`; другий — навіть якщо перший
 * упав. Вивід іде в консоль наживо; з аргументом `before` / `after` ще й пишеться у
 * docs/specs/lab3-testing/reports/mutation-<arg>.txt. Код виходу ≠ 0, якщо ≠ 0 хоч один запуск.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPORTS = join(process.cwd(), 'docs/specs/lab3-testing/reports');
const CONFIGS = ['stryker.balances.config.js', 'stryker.config.js'] as const;
const ENV = { ...process.env, STORAGE: 'memory', NO_COLOR: '1' };

interface Result {
  readonly command: string;
  readonly code: number;
  readonly output: string;
}

/** `npx` — через shell, як у demo-guards.ts; вивід — у консоль наживо й у результат. */
function run(command: string): Promise<Result> {
  console.log(`$ ${command}`);
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const child = spawn(command, { shell: true, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk);
      chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
      chunks.push(chunk);
    });
    // Процес не запустився — провал, а не «чисто» (checks.md: помилка інструмента = провал);
    // 'close' після 'error' однаково настає з ненульовим кодом.
    child.on('error', (error) => {
      chunks.push(Buffer.from(`${error.message}\n`));
    });
    child.on('close', (code) => {
      const output = Buffer.concat(chunks).toString('utf8').trim();
      console.log(`[код виходу: ${String(code ?? -1)}]`);
      resolve({ command, code: code ?? -1, output });
    });
  });
}

const args = process.argv.slice(2);
const [mode] = args;
if (args.length > 1 || (mode !== undefined && mode !== 'before' && mode !== 'after')) {
  console.error(
    `Невідомий аргумент «${args.join(' ')}». Використання: npm run mutation [-- before|after]`,
  );
  process.exit(2);
}

const head =
  mode === undefined ? '' : execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const results: Result[] = [];
for (const config of CONFIGS) results.push(await run(`npx stryker run ${config}`));
const code = results.some((r) => r.code !== 0) ? 1 : 0;

if (mode !== undefined) {
  mkdirSync(REPORTS, { recursive: true });
  const file = join(REPORTS, `mutation-${mode}.txt`);
  const body = [
    `# Відтворити: npm run mutation -- ${mode}`,
    `# HEAD: ${head}`,
    `# Код виходу: ${String(code)}`,
    '',
    ...results.flatMap((r) => [`$ ${r.command}`, r.output, `[код виходу: ${String(r.code)}]`, '']),
  ].join('\n');
  writeFileSync(file, body);
  console.log(`Звіт: ${file}`);
}
process.exitCode = code;
