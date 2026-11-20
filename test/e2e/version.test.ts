/**
 * E2E, версія (spec лаби 3, крит. 12; architecture.md, розд. 3): `GET /version` зібраного
 * застосунку, запущеного без `APP_VERSION`, повертає sha `git rev-parse HEAD`. На відміну від
 * smoke (C8), без git тест падає, а не допускає `unknown`.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';

import { request } from './client.ts';

describe('E2E: версія', () => {
  it('GET /version → 200, version = git rev-parse HEAD', async () => {
    // git недоступний → execFileSync кидає помилку → тест падає, а не пропускається.
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const res = await request('GET', '/version');
    assert.equal(res.status, 200);
    assert.equal((res.body as { version: string }).version, head);
  });
});
