/**
 * Чисті операції над агрегатом: стан → новий стан або доменна помилка. Без I/O, часу й
 * випадковості — їх передає сервіс аргументами, тож повтор під час ретраю безпечний
 * (ADR-0018). Інваріанти I1–I6 — architecture.md лаби 1, розд. 4.
 */
import { computeBalances, suggestTransfers } from '../balances/index.ts';
import type { Balance, SuggestedTransfer } from '../balances/index.ts';
import { type Money, allocateEqually, sum } from '../money/index.ts';
import { ConflictError, DomainRuleError, NotFoundError } from './errors.ts';
import type { Expense, ExpenseShare, Participant, Transfer, Trip } from './model.ts';

export type SplitInput =
  | { readonly mode: 'equal'; readonly participantIds: readonly string[] }
  | {
      readonly mode: 'exact';
      readonly shares: readonly { readonly participantId: string; readonly amount: Money }[];
    };

export interface ExpenseInput {
  readonly payerId: string;
  readonly amount: Money;
  readonly description: string;
  readonly split: SplitInput;
}

export interface TransferInput {
  readonly fromId: string;
  readonly toId: string;
  readonly amount: Money;
}

function assertOpen(trip: Trip): void {
  if (trip.status === 'closed') {
    throw new ConflictError('trip_closed', 'Закрита поїздка не змінюється (I4)');
  }
}

function participant(trip: Trip, id: string, role: string): Participant {
  const found = trip.participants.find((p) => p.id === id);
  if (found === undefined) {
    throw new DomainRuleError('unknown_participant', `${role} ${id} — не учасник поїздки (I3)`);
  }
  return found;
}

function assertUnique(ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length) {
    throw new DomainRuleError('duplicate_participant', 'Учасник у поділі — не більше одного разу');
  }
}

export function addParticipant(trip: Trip, id: string, name: string): Trip {
  assertOpen(trip);
  const position = Math.max(0, ...trip.participants.map((p) => p.position)) + 1;
  return { ...trip, participants: [...trip.participants, { id, name, position }] };
}

export function removeParticipant(trip: Trip, participantId: string): Trip {
  assertOpen(trip);
  if (!trip.participants.some((p) => p.id === participantId)) {
    throw new NotFoundError('participant_not_found', `Учасника ${participantId} немає`);
  }
  const mentioned =
    trip.expenses.some(
      (e) => e.payerId === participantId || e.shares.some((s) => s.participantId === participantId),
    ) || trip.transfers.some((t) => t.fromId === participantId || t.toId === participantId);
  if (mentioned) {
    throw new ConflictError('participant_in_use', 'Учасник згаданий у витраті чи переказі (I5)');
  }
  return { ...trip, participants: trip.participants.filter((p) => p.id !== participantId) };
}

function buildShares(trip: Trip, input: ExpenseInput): ExpenseShare[] {
  const { split } = input;
  if (split.mode === 'equal') {
    assertUnique(split.participantIds);
    // Залишкові копійки — першим за порядком додавання, не за порядком у запиті (ADR-0010).
    const ordered = split.participantIds
      .map((id) => participant(trip, id, 'Учасник поділу'))
      .sort((a, b) => a.position - b.position);
    const amounts = allocateEqually(input.amount, ordered.length);
    return ordered.map((p, i) => ({ participantId: p.id, amount: amounts[i] ?? input.amount }));
  }
  assertUnique(split.shares.map((s) => s.participantId));
  const position = new Map(
    split.shares.map((s) => [
      s.participantId,
      participant(trip, s.participantId, 'Учасник поділу').position,
    ]),
  );
  if (sum(split.shares.map((s) => s.amount)) !== input.amount) {
    throw new DomainRuleError('shares_sum_mismatch', 'Σ часток має дорівнювати сумі витрати (I1)');
  }
  // Частки — за порядком додавання учасників, як і при поділі порівну: так їх повертає й БД.
  return split.shares
    .map((s) => ({ participantId: s.participantId, amount: s.amount }))
    .sort((a, b) => (position.get(a.participantId) ?? 0) - (position.get(b.participantId) ?? 0));
}

function buildExpense(trip: Trip, id: string, input: ExpenseInput): Expense {
  participant(trip, input.payerId, 'Платник');
  return {
    id,
    payerId: input.payerId,
    amount: input.amount,
    splitMode: input.split.mode,
    description: input.description,
    shares: buildShares(trip, input),
  };
}

export function addExpense(trip: Trip, id: string, input: ExpenseInput): Trip {
  assertOpen(trip);
  return { ...trip, expenses: [...trip.expenses, buildExpense(trip, id, input)] };
}

function assertExpense(trip: Trip, expenseId: string): void {
  if (!trip.expenses.some((e) => e.id === expenseId)) {
    throw new NotFoundError('expense_not_found', `Витрати ${expenseId} немає`);
  }
}

export function replaceExpense(trip: Trip, expenseId: string, input: ExpenseInput): Trip {
  assertOpen(trip);
  assertExpense(trip, expenseId);
  const next = buildExpense(trip, expenseId, input);
  return { ...trip, expenses: trip.expenses.map((e) => (e.id === expenseId ? next : e)) };
}

export function removeExpense(trip: Trip, expenseId: string): Trip {
  assertOpen(trip);
  assertExpense(trip, expenseId);
  return { ...trip, expenses: trip.expenses.filter((e) => e.id !== expenseId) };
}

export function addTransfer(trip: Trip, id: string, input: TransferInput): Trip {
  assertOpen(trip);
  if (input.fromId === input.toId) {
    throw new DomainRuleError('same_participant', 'Відправник і отримувач — різні учасники');
  }
  participant(trip, input.fromId, 'Відправник');
  participant(trip, input.toId, 'Отримувач');
  const transfer: Transfer = { id, fromId: input.fromId, toId: input.toId, amount: input.amount };
  return { ...trip, transfers: [...trip.transfers, transfer] };
}

export function removeTransfer(trip: Trip, transferId: string): Trip {
  assertOpen(trip);
  if (!trip.transfers.some((t) => t.id === transferId)) {
    throw new NotFoundError('transfer_not_found', `Переказу ${transferId} немає`);
  }
  return { ...trip, transfers: trip.transfers.filter((t) => t.id !== transferId) };
}

export function balancesOf(trip: Trip): Balance[] {
  return computeBalances(
    [...trip.participants].sort((a, b) => a.position - b.position).map((p) => p.id),
    trip.expenses,
    trip.transfers,
  );
}

export function settlementsOf(trip: Trip): SuggestedTransfer[] {
  return suggestTransfers(balancesOf(trip));
}

export function closeTrip(trip: Trip, now: Date): Trip {
  assertOpen(trip);
  if (balancesOf(trip).some((b) => b.amount !== 0)) {
    throw new ConflictError('balances_not_settled', 'Закрити можна лише за нульових балансів');
  }
  return { ...trip, status: 'closed', closedAt: now };
}
