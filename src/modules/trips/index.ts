/**
 * Публічна точка входу модуля `trips` — агрегат поїздки (ADR-0013).
 * Типи відповідають моделі даних architecture.md, розд. 4; сценарії — з лаби 2.
 */
import type { Balance, SuggestedTransfer } from '../balances/index.ts';
import type { Money } from '../money/index.ts';

export type TripStatus = 'open' | 'closed';
export type SplitMode = 'equal' | 'exact';

export interface Participant {
  readonly id: string;
  readonly name: string;
  /** Порядок додавання; визначає розподіл залишкових копійок (ADR-0010). */
  readonly position: number;
}

export interface ExpenseShare {
  readonly participantId: string;
  readonly amount: Money;
}

export interface Expense {
  readonly id: string;
  readonly payerId: string;
  readonly amount: Money;
  readonly splitMode: SplitMode;
  readonly description: string;
  readonly shares: readonly ExpenseShare[];
}

export interface Transfer {
  readonly id: string;
  readonly fromId: string;
  readonly toId: string;
  readonly amount: Money;
}

export interface Trip {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly status: TripStatus;
  readonly closedAt: Date | null;
  readonly participants: readonly Participant[];
  readonly expenses: readonly Expense[];
  readonly transfers: readonly Transfer[];
}

/** Обчислювані дані поїздки — не зберігаються (ADR-0012). */
export interface TripSummary {
  readonly balances: readonly Balance[];
  readonly suggestedTransfers: readonly SuggestedTransfer[];
}

/** Порт сховища; реалізація-адаптер з'явиться разом зі зберіганням даних. */
export interface TripRepository {
  findById(id: string): Promise<Trip | null>;
  save(trip: Trip): Promise<void>;
}
