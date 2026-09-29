/**
 * Публічна точка входу модуля `balances` (architecture.md, розд. 2).
 * Логіка — з лаби 2: `computeBalances` (ADR-0012), `suggestTransfers` (ADR-0011).
 */
import type { Money } from '../money/index.ts';

/** Баланс учасника: додатний — йому мають повернути, від'ємний — він винен. */
export interface Balance {
  readonly participantId: string;
  readonly amount: Money;
}

export interface SuggestedTransfer {
  readonly fromId: string;
  readonly toId: string;
  readonly amount: Money;
}
