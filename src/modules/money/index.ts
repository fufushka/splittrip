/**
 * Публічна точка входу модуля `money` (architecture.md лаби 1, розд. 2).
 * Гроші — цілі копійки (ADR-0009); поділ порівну без втрат (ADR-0010).
 */

/** Сума в мінімальних одиницях валюти — цілі копійки (ADR-0009). Баланси бувають від'ємні. */
export type Money = number & { readonly __brand: 'Money' };

/** Найбільша сума витрати чи переказу (contract.md): 10¹⁰ копійок < 2⁵³. */
export const MAX_AMOUNT = 10_000_000_000;

export const ZERO = 0 as Money;

export function money(value: number): Money {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Гроші — цілі копійки, отримано ${String(value)}`);
  }
  return value as Money;
}

export function add(a: Money, b: Money): Money {
  return money(a + b);
}

export function subtract(a: Money, b: Money): Money {
  return money(a - b);
}

export function sum(values: readonly Money[]): Money {
  return values.reduce(add, ZERO);
}

/**
 * Ділить `amount` на `parts` часток: кожна ⌊amount / parts⌋, перші `amount mod parts` — на
 * 1 копійку більші (ADR-0010). Σ часток = `amount` завжди (I1).
 */
export function allocateEqually(amount: Money, parts: number): Money[] {
  if (!Number.isSafeInteger(parts) || parts < 1) {
    throw new RangeError(`Кількість часток — ціле ≥ 1, отримано ${String(parts)}`);
  }
  const base = Math.floor(amount / parts);
  const remainder = amount - base * parts;
  return Array.from({ length: parts }, (_, i) => money(base + (i < remainder ? 1 : 0)));
}
