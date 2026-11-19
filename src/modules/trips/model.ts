/**
 * Модель агрегату поїздки (architecture.md лаби 1, розд. 4) і порт сховища (ADR-0018).
 */
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

/** Поїздка без дочірніх сутностей — для списку. */
export interface TripHeader {
  readonly id: string;
  /** `sub` власника з JWT; доступ — лише власнику (ai/lab2/005, п. 2). */
  readonly ownerId: string;
  readonly name: string;
  readonly currency: string;
  readonly status: TripStatus;
  readonly closedAt: Date | null;
  readonly createdAt: Date;
}

export interface Trip extends TripHeader {
  readonly participants: readonly Participant[];
  readonly expenses: readonly Expense[];
  readonly transfers: readonly Transfer[];
}

export interface TripPage {
  readonly limit: number;
  /** id останньої поїздки попередньої сторінки; наступна — строго старіші (UUIDv7). */
  readonly cursor?: string;
}

/**
 * Порт сховища. Реалізації — у `storage` (memory, postgres). Користувача параметром не
 * приймає (spec, крит. 5): `list` бере ініціатора з `context`, решта — за id.
 */
export interface TripRepository {
  create(trip: Trip): Promise<void>;
  findById(id: string): Promise<Trip | null>;
  /** Поїздки ініціатора, новіші першими. */
  list(page: TripPage): Promise<TripHeader[]>;
  /**
   * Одна транзакція: блокування поїздки, завантаження агрегату, `mutate`, збереження змін.
   * `mutate` — чиста функція: під час ретраю виконується повторно (ADR-0018). `null` — немає.
   */
  update(id: string, mutate: (trip: Trip | null) => Trip): Promise<Trip>;
  delete(id: string): Promise<void>;
}
