/**
 * C9 — слід ШІ: для кожного промпту в ai/ — коміти з трейлером AI-Prompt на нього
 * (spec-fix-01, п. 2). Виводить Markdown у stdout.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const AI_DIR = 'ai';

function git(args: readonly string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function promptFiles(): string[] {
  return readdirSync(AI_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((dir) =>
      readdirSync(join(AI_DIR, dir.name))
        .filter((name) => name.endsWith('.md'))
        .map((name) => `${AI_DIR}/${dir.name}/${name}`),
    )
    .sort();
}

const lines = [
  `# Слід ШІ (HEAD ${git(['rev-parse', '--short', 'HEAD']).trim()})`,
  '',
  'Відтворити: `make ai-trace`. Коміти без трейлера `AI-Prompt` автор зробив сам.',
  '',
];
for (const prompt of promptFiles()) {
  const commits = git([
    'log',
    '--reverse',
    '--format=- %h %s',
    '--fixed-strings',
    `--grep=AI-Prompt: ${prompt}`,
  ]).trim();
  lines.push(`## ${prompt}`, '', commits === '' ? '- (комітів немає)' : commits, '');
}
console.log(lines.join('\n'));
