/**
 * Адаптер Supabase Auth проти імітації HTTP API (без мережі й Docker): поведінка на
 * відповідях, яких локальний Supabase з нашим config.toml не дає (spec-fix-03, п. 2).
 */
import assert from 'node:assert/strict';
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';

import { createSupabaseAuth } from '../../src/modules/auth/index.ts';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let handler: Handler = (_req, res) => res.end();
const server = createServer((req, res) => {
  handler(req, res);
});
let url = '';

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address !== 'object') throw new Error('немає адреси');
  url = `http://127.0.0.1:${String(address.port)}`;
});
after(
  () =>
    new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    }),
);

const json =
  (status: number, body: unknown): Handler =>
  (_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  };

describe('auth: адаптер Supabase', () => {
  it('signup без сесії (увімкнено «Confirm email») → явна помилка конфігурації, не 2xx', async () => {
    handler = json(200, { id: 'u1', email: 'a@example.com', confirmation_sent_at: 'now' });
    const auth = createSupabaseAuth({ url, apiKey: 'sb_publishable_test' });
    await assert.rejects(auth.signup('a@example.com', 'correct-horse'), /Confirm email/);
  });

  it('signup: user_already_exists → EmailTakenError; інша 4xx → AuthRejectedError', async () => {
    const auth = createSupabaseAuth({ url, apiKey: 'sb_publishable_test' });
    handler = json(422, { error_code: 'user_already_exists' });
    await assert.rejects(auth.signup('a@example.com', 'correct-horse'), {
      name: 'EmailTakenError',
    });
    handler = json(422, { error_code: 'weak_password' });
    await assert.rejects(auth.signup('a@example.com', 'correct-horse'), {
      name: 'AuthRejectedError',
    });
  });

  it('5xx і обрив з’єднання → AuthUnavailableError (503), а не 401', async () => {
    const auth = createSupabaseAuth({ url, apiKey: 'sb_publishable_test' });
    handler = json(502, {});
    await assert.rejects(auth.login('a@example.com', 'x'), { name: 'AuthUnavailableError' });
    handler = (req) => req.socket.destroy();
    await assert.rejects(auth.login('a@example.com', 'x'), { name: 'AuthUnavailableError' });
  });

  it('apikey передається в кожен запит; паролі не йдуть у query', async () => {
    let seen: IncomingMessage | undefined;
    handler = (req, res) => {
      seen = req;
      json(400, { error_code: 'invalid_credentials' })(req, res);
    };
    const auth = createSupabaseAuth({ url, apiKey: 'sb_publishable_test' });
    await assert.rejects(auth.login('a@example.com', 'secret-pass'), { name: 'UnauthorizedError' });
    assert.equal(seen?.headers.apikey, 'sb_publishable_test');
    assert.ok(!String(seen.url).includes('secret-pass'));
  });
});
