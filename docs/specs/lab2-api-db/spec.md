# spec: Лаба 2 — HTTP API і база даних SplitTrip

Статус: чернетка AI за відповідями автора [`ai/lab2/003–005`](../../../ai/lab2/); рев'ю й
прийняття — автор. `[AI]` — пропозиція AI, на яку автор ще не відповів явно.

## Що і навіщо

Реалізувати сценарії «Функціоналу продукту» (лаба 1) і видалення поїздки через HTTP API:
спершу на статичних даних у пам'яті, потім на Postgres (Supabase). Шари не змішуються, а
БД, ініціатор і `processId` доходять до будь-якого рівня без протягування параметрів.

## Обсяг

**Входить:** API нижче; Supabase Auth (перевірка JWT); Postgres через postgres.js; міграції;
транзакції, валідація, ідемпотентність, ретраї; ізольоване середовище (Docker + Supabase
CLI); прогін у хмарному Supabase через Supavisor.
**Не входить:** реєстрація/логін у нашому API (JWT видає Supabase Auth), RLS, спільний
доступ до поїздки, перейменування поїздки, кілька валют, rate limiting, CI, деплой, UI.

## Шари і контекст (004)

`http` (роути, лише HTTP) → `trips` (сервіси: сценарії й доступ) → порт `TripRepository` ←
`storage` (SQL, транзакції). `context` — AsyncLocalStorage: `{ processId, userId }`.
- Порт: `findById`, `list`, `create`, `delete`, `update(tripId, mutate)`. `update` в одній
  транзакції: `SELECT … FOR UPDATE` поїздки → агрегат → чиста `mutate(trip)` → збереження
  змін за id (005, п. 1). Під час ретраю `mutate` виконується повторно.
- `processId` = `X-Request-Id` запиту (≤ 128 симв., `[A-Za-z0-9_-]`), інакше UUIDv7; є в
  заголовку відповіді, у тілі помилки й у кожному рядку логу (pino `mixin` із `context`).
- Ініціатор = `sub` із JWT, підпис перевіряється за JWKS Supabase (`jose`) (004, 005 п. 3).
- Доступ: поїздку бачить і змінює лише власник; чужа або неіснуюча → `404` (005, п. 2).

## API (усі `/trips*` — `Authorization: Bearer <JWT>`, інакше `401`)

| Запит | Успіх | Помилки (крім 401/404 поїздки) |
|---|---|---|
| `POST /trips` `{name, currency}` | 201 | 400 |
| `GET /trips?limit&cursor` — лише свої, новіші першими | 200 | 400 |
| `GET /trips/:id` — з учасниками, витратами й частками, переказами | 200 | — |
| `DELETE /trips/:id` — будь-який статус, каскадно (005) | 204 | — |
| `POST /trips/:id/participants` `{name}` | 201 | 400, 409 закрита |
| `DELETE /trips/:id/participants/:pid` | 204 | 404, 409 закрита / згаданий |
| `POST /trips/:id/expenses` `{payerId, amount, description, split}` | 201 | 400, 409, 422 |
| `PUT /trips/:id/expenses/:eid` — повна заміна, частки перераховуються | 200 | 400, 404, 409, 422 |
| `DELETE /trips/:id/expenses/:eid` | 204 | 404, 409 |
| `POST /trips/:id/transfers` `{fromId, toId, amount}` | 201 | 400, 409, 422 |
| `DELETE /trips/:id/transfers/:tid` | 204 | 404, 409 |
| `GET /trips/:id/balances` · `GET /trips/:id/settlements` | 200 | — |
| `POST /trips/:id/close` | 200 | 409 закрита / баланси ≠ 0 |
| `GET /health` (liveness) · `GET /ready` (БД) · `GET /version` — без JWT | 200 | `/ready` 503 |

`split` = `{mode: "equal", participantIds}` | `{mode: "exact", shares: [{participantId,
amount}]}`. Суми — цілі копійки `1…10¹⁰` `[AI]`; `currency` — ISO 4217 `[AI]`; `name` 1–100,
`description` 0–200 симв. `[AI]`; `limit` 1–100, типово 20 `[AI]`.

**Помилки** — один глобальний обробник, `application/problem+json`: `type`, `title`, `status`,
`code`, `detail`, `requestId`. `400` форма запиту · `401` JWT · `404` немає або чуже · `409`
стан (I4, I5, закриття з ненульовими балансами) · `422` правило домену (I1, I3, від = кому) ·
`503` БД недоступна / таймаут, з `Retry-After` · `500` без внутрішніх деталей.
**Ідемпотентність:** `Idempotency-Key` на кожному `POST`; повтор → та сама відповідь; той
самий ключ з іншим тілом → `422`; ключ ще в обробці → `409`; TTL 24 год `[AI]`.

## Схема БД (UUIDv7 генерує застосунок; суми `bigint > 0`)

- `trips(id, owner_id, name, currency, status open|closed, closed_at, created_at)` —
  `closed_at` заданий ⇔ `closed`; індекс `(owner_id, id)`. `owner_id` без FK на `auth.users`.
- `participants(id, trip_id, name, position)` — `unique(trip_id, position)`.
- `expenses(id, trip_id, payer_id, amount, split_mode, description)`.
- `expense_shares(expense_id, participant_id, amount)` — PK пари.
- `transfers(id, trip_id, from_id, to_id, amount)` — `check(from_id <> to_id)`.
- `idempotency_keys(owner_id, key, request_hash, status, response, created_at)` — PK пари.
- Від `trips` — `ON DELETE CASCADE`; посилання на учасника — без каскаду (I5 і в БД);
  I3 — складеними FK `(trip_id, participant_id)`.

**Запити:** агрегат — 4 запити за `trip_id` незалежно від розміру (частки — `JOIN expenses`);
список — `WHERE owner_id = $1 AND id < $cursor ORDER BY id DESC LIMIT $n`; збереження —
один пакетний `INSERT`/`UPDATE`/`DELETE` на таблицю, не рядок за рядком.

## Збої

Старт: пул + `SELECT now()`, помилка → вихід ≠ 0. Ретрай транзакції на `40001`, `40P01`,
обриві з'єднання — до 3 спроб із backoff, далі `503`. `statement_timeout` 5 с, `lock_timeout`
3 с `[AI]`. Підключення: локально — напряму до бази прогону; хмара — Supavisor, transaction
mode, `prepare: false` (004).

## Критерії прийняття

1. **Статика.** `npm run test:api` проганяє кожен рядок таблиці API (успіх і кожну помилку)
   на `STORAGE=memory`; коміт етапу — раніше за перший коміт `storage`.
2. **БД.** Той самий набір на `STORAGE=postgres`: `npm run test:api:db` створює базу
   `run_<id>` у локальному Supabase, накочує `db/migrations/*.sql`, після прогону видаляє.
3. **Шари.** dependency-cruiser: `postgres` — лише в `storage`, `fastify` — лише в `http`,
   `node:async_hooks` — лише в `context`; `trips` не імпортує жодного з них. Звіт порушень.
4. **Один обробник.** ESLint забороняє `try` у `http` і `trips`; помилки → `setErrorHandler`.
5. **Без протягування.** Сервіси й репозиторії не мають параметрів БД, користувача чи
   `processId`; тест: логи роута, сервісу й `storage` в одному запиті мають один `processId`.
6. **Безпека.** Без JWT / з невалідним → `401`; поїздка іншого користувача → `404` на кожен
   ендпоінт `/trips/:id*` (тест на двох користувачах).
7. **Транзакції.** Паралельні `close` і `POST expenses` дають узгоджений стан (тест).
8. **Ідемпотентність і ретраї.** Тести: повторний `POST` → 1 рядок; підкинута `40001` →
   успіх; 3 поспіль → `503`.
9. **Збої.** Невірний `DATABASE_URL` → вихід ≠ 0 за ≤ 10 с; БД зупинено → `503` +
   `Retry-After`, `/ready` 503, `/health` 200 (звіт).
10. **N+1.** Лічильник запитів: `GET /trips/:id` з 1 і з 20 витратами — однаково (тест).
11. **Хмара.** Міграції й сценарії через Supavisor; звіт `reports/` із командою.
12. **ADR:** БД і драйвер; керування залежностями й контекст; автентифікація; транзакції й
    блокування; ідемпотентність; міграції й ізоляція; `npm run` замість Makefile (замінює
    ADR-0008). `architecture.md` лаби 2 — новий граф модулів.
13. **Стандарти:** ai-workflow 0.3, DoD 0.2 (шаблон DEFENSE §4), checks 0.3 (`npm run`),
    repository.md — заборона переписувати запушену історію. Makefile видалено.
14. **DEFENSE.md** (пише автор): топ-3 зрізані кути AI, N+1, поведінка на збоях.

## Обмеження

Ті самі, що в лабі 1, і [CLAUDE.md](../../../CLAUDE.md). Розбіжність → spec-fix, не патч.
