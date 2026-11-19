/**
 * Публічна точка входу модуля `balances` (architecture.md лаби 1, розд. 2).
 * Чисті обчислення: `computeBalances` (ADR-0012), `suggestTransfers` (ADR-0011).
 */
import { type Money, ZERO, add, money, subtract } from '../money/index.ts';

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

export interface ExpenseInput {
  readonly payerId: string;
  readonly amount: Money;
  readonly shares: readonly { readonly participantId: string; readonly amount: Money }[];
}

export interface TransferInput {
  readonly fromId: string;
  readonly toId: string;
  readonly amount: Money;
}

/**
 * `balance(p) = Σ сплачено p − Σ часток p + Σ переказів від p − Σ переказів до p`
 * (architecture.md лаби 1, сценарій 7). Порядок результату — порядок `participantIds`.
 */
export function computeBalances(
  participantIds: readonly string[],
  expenses: readonly ExpenseInput[],
  transfers: readonly TransferInput[],
): Balance[] {
  const totals = new Map<string, Money>(participantIds.map((id) => [id, ZERO]));
  const shift = (id: string, delta: Money, sign: 1 | -1): void => {
    const current = totals.get(id) ?? ZERO;
    totals.set(id, sign === 1 ? add(current, delta) : subtract(current, delta));
  };
  for (const expense of expenses) {
    shift(expense.payerId, expense.amount, 1);
    for (const share of expense.shares) shift(share.participantId, share.amount, -1);
  }
  for (const transfer of transfers) {
    shift(transfer.fromId, transfer.amount, 1);
    shift(transfer.toId, transfer.amount, -1);
  }
  return participantIds.map((participantId) => ({
    participantId,
    amount: totals.get(participantId) ?? ZERO,
  }));
}

/**
 * Жадібно: найбільший боржник платить найбільшому кредитору, доки всі баланси не 0;
 * за рівних сум — раніший у списку (ADR-0011). Не більше n − 1 переказу.
 */
export function suggestTransfers(balances: readonly Balance[]): SuggestedTransfer[] {
  const open = balances
    .filter((b) => b.amount !== 0)
    .map((b, order): { id: string; amount: number; order: number } => ({
      id: b.participantId,
      amount: b.amount,
      order,
    }));
  const pick = (sign: 1 | -1) =>
    open
      .filter((b) => Math.sign(b.amount) === sign)
      .sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount) || x.order - y.order)[0];

  const result: SuggestedTransfer[] = [];
  for (;;) {
    const debtor = pick(-1);
    const creditor = pick(1);
    if (debtor === undefined || creditor === undefined) break;
    const amount = Math.min(-debtor.amount, creditor.amount);
    result.push({ fromId: debtor.id, toId: creditor.id, amount: money(amount) });
    debtor.amount += amount;
    creditor.amount -= amount;
  }
  return result;
}
