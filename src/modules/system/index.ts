/**
 * Публічна точка входу модуля `system`: стан і версія застосунку (spec-fix-01, п. 1).
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const UNKNOWN_VERSION = 'unknown';

const COMMIT_SHA = /^[0-9a-f]{40}$/;

export interface SystemInfo {
  readonly version: string;
}

function readGitHead(): string | undefined {
  try {
    // Шукаємо репозиторій від каталогу модуля, а не від cwd процесу.
    const moduleDir = fileURLToPath(new URL('.', import.meta.url));
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: moduleDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

/** Версія: `APP_VERSION` → `git rev-parse HEAD` → `unknown`. Ніколи не кидає помилку. */
export function resolveVersion(env: NodeJS.ProcessEnv = process.env): string {
  const candidate = env.APP_VERSION ?? readGitHead();
  return candidate !== undefined && COMMIT_SHA.test(candidate) ? candidate : UNKNOWN_VERSION;
}

export function createSystemInfo(env: NodeJS.ProcessEnv = process.env): SystemInfo {
  return { version: resolveVersion(env) };
}
