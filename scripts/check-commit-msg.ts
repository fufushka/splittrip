/**
 * C4 — повідомлення коміту (standarts/commits.md, standarts/ai-workflow.md).
 * Використання: node scripts/check-commit-msg.ts <файл-повідомлення>
 */
import { existsSync, readFileSync } from 'node:fs';

const TYPES = ['feat', 'fix', 'docs', 'test', 'refactor', 'build', 'chore', 'ci'];
const HEADER = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9-]+\\))?!?: \\S.*$`);
const UKRAINIAN = /[а-щьюяґєії]/i;
const MAX_HEADER = 72;
const AI_PROMPT = /^AI-Prompt: (.+)$/gm;
const AI_CO_AUTHOR = /^Co-Authored-By: Claude\b/m;

const file = process.argv[2];
if (file === undefined) {
  console.error('Використання: check-commit-msg.ts <файл-повідомлення>');
  process.exit(2);
}

const message = readFileSync(file, 'utf8')
  .split(/\r?\n/)
  .filter((line) => !line.startsWith('#'))
  .join('\n')
  .trim();
const [header = '', second] = message.split('\n');

// Merge- і revert-коміти формує git, їх не перевіряємо.
if (/^(Merge|Revert) /.test(header)) process.exit(0);

const problems: string[] = [];

if (!HEADER.test(header)) {
  problems.push(`заголовок не у форматі "<тип>(<scope>): <опис>", типи: ${TYPES.join(', ')}`);
}
if (header.length > MAX_HEADER) {
  problems.push(`заголовок довший за ${String(MAX_HEADER)} символів (${String(header.length)})`);
}
if (header.endsWith('.')) problems.push('заголовок закінчується крапкою');
if (!UKRAINIAN.test(header)) problems.push('опис має бути українською');
if (second !== undefined && second.trim() !== '') {
  problems.push('між заголовком і тілом потрібен порожній рядок');
}

const prompts = [...message.matchAll(AI_PROMPT)].map((match) => match[1]?.trim() ?? '');
for (const prompt of prompts) {
  if (!existsSync(prompt)) problems.push(`AI-Prompt посилається на неіснуючий файл: ${prompt}`);
}
const hasCoAuthor = AI_CO_AUTHOR.test(message);
if (prompts.length > 0 && !hasCoAuthor) {
  problems.push('коміт ШІ (є AI-Prompt) без трейлера Co-Authored-By: Claude …');
}
if (hasCoAuthor && prompts.length === 0) {
  problems.push('коміт ШІ (є Co-Authored-By: Claude) без трейлера AI-Prompt');
}

if (problems.length > 0) {
  console.error(`C4 commit-msg: "${header}"`);
  for (const problem of problems) console.error(`  ✘ ${problem}`);
  process.exit(1);
}
