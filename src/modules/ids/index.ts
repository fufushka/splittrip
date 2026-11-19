/**
 * Публічна точка входу модуля `ids` — ідентифікатори UUIDv7 (RFC 9562).
 * Генерує застосунок, а не БД (contract.md, розд. 2): id відомий до запису, тож повтор
 * `mutate` під час ретраю дає той самий результат (ADR-0018). Без `node:*` — Web Crypto.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 12 біт `rand_a` — лічильник у межах однієї мілісекунди (RFC 9562, розд. 6.2, метод 1). */
const COUNTER_MAX = 0xfff;

let lastMs = -1;
let counter = 0;

/**
 * UUIDv7: 48 біт часу в мілісекундах, версія, 12-бітний лічильник, варіант, випадкові біти.
 * Монотонний у межах процесу: id, створені в ту саму мілісекунду, зростають — порядок
 * «новіші першими» й курсор `GET /trips` на цьому тримаються (spec-fix-01, п. 3).
 */
export function uuidv7(now: number = Date.now()): string {
  let ms = Math.max(now, lastMs);
  if (ms === lastMs) {
    counter++;
    if (counter > COUNTER_MAX) {
      // Лічильник вичерпано: позичаємо наступну мілісекунду, порядок не порушується.
      ms++;
      counter = 0;
    }
  } else {
    // Нова мілісекунда: випадковий старт у нижній половині, щоб лишався запас для приросту.
    counter = (globalThis.crypto.getRandomValues(new Uint16Array(1))[0] ?? 0) & 0x7ff;
  }
  lastMs = ms;

  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let time = ms;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = time % 256;
    time = Math.floor(time / 256);
  }
  bytes[6] = 0x70 | (counter >> 8);
  bytes[7] = counter & 0xff;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

export function isUuid(value: string): boolean {
  return UUID.test(value);
}
