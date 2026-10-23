/**
 * Доменні помилки з машинним `code` (ADR-0021). HTTP-коди їм призначає лише `http`.
 */

export class TripError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Сутності немає або вона чужа — для клієнта це однаково (ai/lab2/005, п. 2). */
export class NotFoundError extends TripError {
  override readonly name = 'NotFoundError';
}

/** Дію заборонено поточним станом: закрита поїздка, згаданий учасник, борги (I4, I5). */
export class ConflictError extends TripError {
  override readonly name = 'ConflictError';
}

/** Дані суперечать правилу домену: Σ часток ≠ сума, чужий учасник, від = кому (I1, I3). */
export class DomainRuleError extends TripError {
  override readonly name = 'DomainRuleError';
}

/**
 * Помилка контракту порту: джерело даних тимчасово недоступне або не встигло відповісти.
 * Кидають реалізації портів у `storage`; клієнт отримує `503` + `Retry-After` (spec «Збої»).
 */
export class SourceUnavailableError extends Error {
  override readonly name = 'SourceUnavailableError';
  readonly code = 'source_unavailable';
}
