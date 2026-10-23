/**
 * Публічна точка входу модуля `money` (architecture.md, розд. 2).
 * Логіка — з лаби 2: створення `Money`, `allocateEqually` (ADR-0010).
 */

/** Сума в мінімальних одиницях валюти — цілі копійки (ADR-0009). */
export type Money = number & { readonly __brand: 'Money' };
