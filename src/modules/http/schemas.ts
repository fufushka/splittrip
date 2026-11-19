/**
 * JSON-схеми запитів (contract.md, розд. 1). Валідація форми — тут (→ 400); бізнес-правила —
 * у `trips` (→ 409 / 422). Ajv без приведення типів: `"amount": true` — не 1 копійка.
 * Без `const` і `default` (spec-fix-04 лаби 1: схема не підміняє дані).
 */
import { MAX_AMOUNT } from '../trips/index.ts';

const uuid = { type: 'string', format: 'uuid' } as const;
const name = { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' } as const;
const amount = { type: 'integer', minimum: 1, maximum: MAX_AMOUNT } as const;

export const idParams = (...keys: string[]) =>
  ({
    type: 'object',
    required: keys,
    properties: Object.fromEntries(keys.map((k) => [k, uuid])),
  }) as const;

/** Необов'язковий `Idempotency-Key` для `POST /trips*` (ADR-0019). */
export const idempotencyHeaders = {
  type: 'object',
  properties: { 'idempotency-key': { type: 'string', minLength: 1, maxLength: 255 } },
} as const;

export const credentialsBody = {
  type: 'object',
  additionalProperties: false,
  required: ['email', 'password'],
  properties: {
    email: { type: 'string', format: 'email', maxLength: 254 },
    password: { type: 'string', minLength: 8, maxLength: 72 },
  },
} as const;

export const refreshBody = {
  type: 'object',
  additionalProperties: false,
  required: ['refreshToken'],
  properties: { refreshToken: { type: 'string', minLength: 1, maxLength: 1024 } },
} as const;

export const createTripBody = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'currency'],
  properties: {
    name,
    // ISO 4217 — перелік валют з ICU рантайму (contract.md, `[AI]`).
    currency: { type: 'string', enum: Intl.supportedValuesOf('currency') },
  },
} as const;

/** `limit` — рядок (без приведення типів у Ajv), 1–100; перетворює роут. */
export const listTripsQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: { type: 'string', pattern: '^(100|[1-9][0-9]?)$' },
    cursor: uuid,
  },
} as const;

export const participantBody = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: { name },
} as const;

export const expenseBody = {
  type: 'object',
  additionalProperties: false,
  required: ['payerId', 'amount', 'split'],
  properties: {
    payerId: uuid,
    amount,
    description: { type: 'string', maxLength: 200 },
    split: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['mode', 'participantIds'],
          properties: {
            mode: { enum: ['equal'] },
            participantIds: { type: 'array', minItems: 1, maxItems: 100, items: uuid },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['mode', 'shares'],
          properties: {
            mode: { enum: ['exact'] },
            shares: {
              type: 'array',
              minItems: 1,
              maxItems: 100,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['participantId', 'amount'],
                properties: { participantId: uuid, amount },
              },
            },
          },
        },
      ],
    },
  },
} as const;

export const transferBody = {
  type: 'object',
  additionalProperties: false,
  required: ['fromId', 'toId', 'amount'],
  properties: { fromId: uuid, toId: uuid, amount },
} as const;
