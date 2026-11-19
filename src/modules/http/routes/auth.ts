/**
 * `/auth/*` — реєстрація, логін, оновлення токена, вихід (contract.md, розд. 1; ADR-0017).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { type AuthProvider, invalidToken } from '../../auth/index.ts';
import { credentialsBody, refreshBody } from '../schemas.ts';

interface Credentials {
  readonly email: string;
  readonly password: string;
}

/** `Authorization: Bearer <token>` → токен; інакше `401`. */
export function bearerToken(request: FastifyRequest): string {
  const match = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization ?? '');
  if (match?.[1] === undefined) throw invalidToken();
  return match[1];
}

export function registerAuthRoutes(app: FastifyInstance, auth: AuthProvider): void {
  app.post<{ Body: Credentials }>(
    '/auth/signup',
    { schema: { body: credentialsBody } },
    async (request, reply) => {
      const { email, password } = request.body;
      return reply.code(201).send(await auth.signup(email.toLowerCase(), password));
    },
  );

  app.post<{ Body: Credentials }>('/auth/login', { schema: { body: credentialsBody } }, (request) =>
    auth.login(request.body.email.toLowerCase(), request.body.password),
  );

  app.post<{ Body: { refreshToken: string } }>(
    '/auth/refresh',
    { schema: { body: refreshBody } },
    (request) => auth.refresh(request.body.refreshToken),
  );

  app.post('/auth/logout', async (request, reply) => {
    await auth.logout(bearerToken(request));
    return reply.code(204).send();
  });
}
