/**
 * Публічна точка входу модуля `trips` — агрегат поїздки (ADR-0013) і сервіси сценаріїв
 * (architecture.md лаби 2, розд. 1). Сховище — порт `TripRepository`, реалізації в `storage`.
 */
export type {
  Expense,
  ExpenseShare,
  Participant,
  SplitMode,
  Transfer,
  Trip,
  TripHeader,
  TripPage,
  TripRepository,
  TripStatus,
} from './model.ts';
export type { ExpenseInput, SplitInput, TransferInput } from './domain.ts';
export {
  ConflictError,
  DomainRuleError,
  NotFoundError,
  SourceUnavailableError,
  TripError,
} from './errors.ts';
// Для валідації сум у `http`: межа й перетворення — з `money` (ADR-0009).
export { MAX_AMOUNT, money } from '../money/index.ts';
export type { Balance, SuggestedTransfer } from '../balances/index.ts';
export { createTripService } from './service.ts';
export type { TripService, TripServiceDeps } from './service.ts';
