/**
 * C13 — пороги покриття гілок на файл (standarts/checks.md 0.5; ADR-0023; spec лаби 3,
 * крит. 3; architecture.md лаби 3, розд. 4): `node scripts/check-coverage.ts <lcov>`.
 * Для кожного файлу таблиці бере з lcov вбудованого покриття Node `BRF`/`BRH` (і `LF`/`LH`
 * для довідки). Рядки `BRDA` не читає: гілка під `node:coverage ignore` лишається там із
 * лічильником 0, а в `BRF`/`BRH` зараховується покритою (spec-fix-01, п. 1).
 * Нижче порогу → код 1; немає lcov, запису файлу чи `BRF = 0` → код 1 «не вдалося
 * перевірити» (checks.md: помилка інструмента = провал).
 */
import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

/** Мінімальне покриття гілок, % (spec лаби 3, крит. 3). */
const THRESHOLDS: readonly (readonly [string, number])[] = [
  ['src/modules/money/index.ts', 90],
  ['src/modules/balances/index.ts', 100],
  ['src/modules/trips/domain.ts', 90],
  ['src/modules/trips/service.ts', 90],
  ['src/modules/idempotency/index.ts', 90],
];

/** Запис lcov: `SF` (відносно кореня, через `/`) → вміст до `end_of_record`. */
function readRecords(text: string): Map<string, string> {
  const records = new Map<string, string>();
  for (const block of text.split('end_of_record')) {
    const sf = field(block, 'SF');
    if (sf === undefined) continue;
    records.set(relative(process.cwd(), resolve(sf)).split(sep).join('/'), block);
  }
  return records;
}

function field(block: string, key: string): string | undefined {
  return new RegExp(`^${key}:(.*)$`, 'm').exec(block)?.[1]?.trim();
}

function count(block: string, key: string): number {
  return Number(field(block, key) ?? 0);
}

function percent(hit: number, found: number): string {
  return `${((hit / found) * 100).toFixed(2)}%`;
}

function unverifiable(reason: string): never {
  console.error(`C13 coverage: не вдалося перевірити — ${reason}`);
  process.exit(1);
}

const lcovPath = process.argv[2];
if (lcovPath === undefined) unverifiable('не задано lcov: node scripts/check-coverage.ts <lcov>');
let text: string;
try {
  text = readFileSync(lcovPath, 'utf8');
} catch (error) {
  unverifiable(`немає lcov: ${(error as Error).message}`);
}

const records = readRecords(text);
const width = Math.max(...THRESHOLDS.map(([file]) => file.length));
let below = 0;
let unverified = 0;

console.log(`C13 coverage: гілки на файл за ${lcovPath}`);
for (const [file, threshold] of THRESHOLDS) {
  const name = file.padEnd(width);
  const block = records.get(file);
  if (block === undefined) {
    unverified += 1;
    console.log(`  ${name} · не вдалося перевірити: немає запису в lcov`);
    continue;
  }
  const brf = count(block, 'BRF');
  const brh = count(block, 'BRH');
  if (!(brf > 0)) {
    unverified += 1;
    console.log(`  ${name} · не вдалося перевірити: BRF = 0`);
    continue;
  }
  const ok = brh * 100 >= threshold * brf;
  if (!ok) below += 1;
  const lf = count(block, 'LF');
  const lh = count(block, 'LH');
  console.log(
    `  ${name} · гілки ${percent(brh, brf)} (${String(brh)}/${String(brf)}) · ` +
      `поріг ${String(threshold)}% · ${ok ? 'OK' : 'НИЖЧЕ'} · ` +
      `довідково: рядки ${percent(lh, lf)} (${String(lh)}/${String(lf)})`,
  );
}

if (below > 0 || unverified > 0) {
  console.error(
    `C13 coverage: нижче порогу — ${String(below)}, не вдалося перевірити — ${String(unverified)}`,
  );
  process.exit(1);
}
console.log('C13 coverage: усі пороги виконано');
