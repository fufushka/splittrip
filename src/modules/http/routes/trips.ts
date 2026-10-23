/**
 * `/trips*` — сценарії поїздки (contract.md, розд. 1). Роути знають лише HTTP: схеми, коди,
 * заголовки; правила й доступ — у `TripService`. Усі маршрути вимагають JWT; `POST` —
 * з необов'язковим `Idempotency-Key` (ADR-0019).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { AuthProvider } from '../../auth/index.ts';
import { setCurrentUser } from '../../context/index.ts';
import type { Idempotency } from '../../idempotency/index.ts';
import {
  type ExpenseInput,
  type SplitInput,
  type Trip,
  type TripHeader,
  type TripService,
  money,
} from '../../trips/index.ts';
import {
  createTripBody,
  expenseBody,
  idParams,
  idempotencyHeaders,
  listTripsQuery,
  participantBody,
  transferBody,
} from '../schemas.ts';
import { bearerToken } from './auth.ts';

export interface TripRouteDeps {
  readonly trips: TripService;
  readonly auth: AuthProvider;
  readonly idempotency: Idempotency;
}

const DEFAULT_LIMIT = 20;

interface ExpenseBody {
  readonly payerId: string;
  readonly amount: number;
  readonly description?: string;
  readonly split:
    | { readonly mode: 'equal'; readonly participantIds: string[] }
    | {
        readonly mode: 'exact';
        readonly shares: { readonly participantId: string; readonly amount: number }[];
      };
}

interface TransferBody {
  readonly fromId: string;
  readonly toId: string;
  readonly amount: number;
}

interface TripParams {
  tripId: string;
}

function headerJson(trip: TripHeader) {
  return {
    id: trip.id,
    name: trip.name,
    currency: trip.currency,
    status: trip.status,
    closedAt: trip.closedAt,
    createdAt: trip.createdAt,
  };
}

function tripJson(trip: Trip) {
  return {
    ...headerJson(trip),
    participants: trip.participants,
    expenses: trip.expenses,
    transfers: trip.transfers,
  };
}

function expenseInput(body: ExpenseBody): ExpenseInput {
  const split: SplitInput =
    body.split.mode === 'equal'
      ? { mode: 'equal', participantIds: body.split.participantIds }
      : {
          mode: 'exact',
          shares: body.split.shares.map((s) => ({
            participantId: s.participantId,
            amount: money(s.amount),
          })),
        };
  return {
    payerId: body.payerId,
    amount: money(body.amount),
    description: body.description ?? '',
    split,
  };
}

const withIdempotency = { headers: idempotencyHeaders };

export function registerTripRoutes(app: FastifyInstance, deps: TripRouteDeps): void {
  const { trips, auth, idempotency } = deps;

  // Інкапсульований контекст: hook-и діють лише на /trips*.
  void app.register((scope, _options, done) => {
    // JWT → ініціатор у контексті запиту (ADR-0016, ADR-0017).
    scope.addHook('onRequest', async (request) => {
      setCurrentUser(await auth.verify(bearerToken(request)));
    });

    const pending = new WeakMap<FastifyRequest, string>();

    scope.addHook('preHandler', async (request, reply) => {
      const key = request.headers['idempotency-key'];
      if (request.method !== 'POST' || typeof key !== 'string') return;
      const result = await idempotency.begin(key, {
        method: request.method,
        url: request.url,
        body: request.body,
      });
      if (result.kind === 'replay') {
        const { status, body } = result.response;
        return reply
          .code(status)
          .header('idempotent-replayed', 'true')
          .type(status >= 400 ? 'application/problem+json' : 'application/json')
          .send(body);
      }
      pending.set(request, key);
    });

    scope.addHook('onSend', async (request, reply, payload) => {
      const key = pending.get(request);
      if (key !== undefined) {
        pending.delete(request);
        const body = typeof payload === 'string' ? payload : '';
        await idempotency.finish(key, { status: reply.statusCode, body });
      }
      return payload;
    });

    scope.post<{ Body: { name: string; currency: string } }>(
      '/trips',
      { schema: { body: createTripBody, ...withIdempotency } },
      async (request, reply) => reply.code(201).send(tripJson(await trips.create(request.body))),
    );

    scope.get<{ Querystring: { limit?: string; cursor?: string } }>(
      '/trips',
      { schema: { querystring: listTripsQuery } },
      async (request) => {
        const limit =
          request.query.limit === undefined ? DEFAULT_LIMIT : Number(request.query.limit);
        const { cursor } = request.query;
        // Беремо на 1 більше, щоб знати, чи є наступна сторінка, без окремого COUNT.
        const page = await trips.list({
          limit: limit + 1,
          ...(cursor === undefined ? {} : { cursor }),
        });
        const items = page.slice(0, limit);
        const last = items.at(-1);
        return {
          items: items.map(headerJson),
          nextCursor: page.length > limit && last !== undefined ? last.id : null,
        };
      },
    );

    scope.get<{ Params: TripParams }>(
      '/trips/:tripId',
      { schema: { params: idParams('tripId') } },
      async (request) => tripJson(await trips.get(request.params.tripId)),
    );

    scope.delete<{ Params: TripParams }>(
      '/trips/:tripId',
      { schema: { params: idParams('tripId') } },
      async (request, reply) => {
        await trips.remove(request.params.tripId);
        return reply.code(204).send();
      },
    );

    scope.post<{ Params: TripParams; Body: { name: string } }>(
      '/trips/:tripId/participants',
      { schema: { params: idParams('tripId'), body: participantBody, ...withIdempotency } },
      async (request, reply) =>
        reply.code(201).send(await trips.addParticipant(request.params.tripId, request.body.name)),
    );

    scope.delete<{ Params: TripParams & { participantId: string } }>(
      '/trips/:tripId/participants/:participantId',
      { schema: { params: idParams('tripId', 'participantId') } },
      async (request, reply) => {
        await trips.removeParticipant(request.params.tripId, request.params.participantId);
        return reply.code(204).send();
      },
    );

    scope.post<{ Params: TripParams; Body: ExpenseBody }>(
      '/trips/:tripId/expenses',
      { schema: { params: idParams('tripId'), body: expenseBody, ...withIdempotency } },
      async (request, reply) =>
        reply
          .code(201)
          .send(await trips.addExpense(request.params.tripId, expenseInput(request.body))),
    );

    scope.put<{ Params: TripParams & { expenseId: string }; Body: ExpenseBody }>(
      '/trips/:tripId/expenses/:expenseId',
      { schema: { params: idParams('tripId', 'expenseId'), body: expenseBody } },
      (request) =>
        trips.replaceExpense(
          request.params.tripId,
          request.params.expenseId,
          expenseInput(request.body),
        ),
    );

    scope.delete<{ Params: TripParams & { expenseId: string } }>(
      '/trips/:tripId/expenses/:expenseId',
      { schema: { params: idParams('tripId', 'expenseId') } },
      async (request, reply) => {
        await trips.removeExpense(request.params.tripId, request.params.expenseId);
        return reply.code(204).send();
      },
    );

    scope.post<{ Params: TripParams; Body: TransferBody }>(
      '/trips/:tripId/transfers',
      { schema: { params: idParams('tripId'), body: transferBody, ...withIdempotency } },
      async (request, reply) => {
        const { fromId, toId, amount } = request.body;
        const transfer = await trips.addTransfer(request.params.tripId, {
          fromId,
          toId,
          amount: money(amount),
        });
        return reply.code(201).send(transfer);
      },
    );

    scope.delete<{ Params: TripParams & { transferId: string } }>(
      '/trips/:tripId/transfers/:transferId',
      { schema: { params: idParams('tripId', 'transferId') } },
      async (request, reply) => {
        await trips.removeTransfer(request.params.tripId, request.params.transferId);
        return reply.code(204).send();
      },
    );

    scope.get<{ Params: TripParams }>(
      '/trips/:tripId/balances',
      { schema: { params: idParams('tripId') } },
      async (request) => ({ balances: await trips.balances(request.params.tripId) }),
    );

    scope.get<{ Params: TripParams }>(
      '/trips/:tripId/settlements',
      { schema: { params: idParams('tripId') } },
      async (request) => ({ transfers: await trips.settlements(request.params.tripId) }),
    );

    scope.post<{ Params: TripParams }>(
      '/trips/:tripId/close',
      { schema: { params: idParams('tripId'), ...withIdempotency } },
      async (request) => tripJson(await trips.close(request.params.tripId)),
    );

    done();
  });
}
