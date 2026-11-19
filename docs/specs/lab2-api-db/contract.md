# Контракт: Лаба 2 — API, помилки, схема БД і запити

Частина [spec.md](spec.md), винесена через обмеження в 1 сторінку (`ai/lab2/007`). Має ту
саму силу, що й spec: зміна — лише через spec-fix. `[AI]` — пропозиція AI, прийнята автором
разом зі spec.

## 1. API (усі `/trips*` — `Authorization: Bearer <JWT>`, інакше `401`)

| Запит | Успіх | Помилки (крім 401/404 поїздки) |
|---|---|---|
| `POST /auth/signup` `{email, password}` → користувач і токени | 201 | 400, 409 email зайнятий |
| `POST /auth/login` `{email, password}` → токени | 200 | 400, 401 |
| `POST /auth/refresh` `{refreshToken}` · `POST /auth/logout` (Bearer) | 200 · 204 | 401 |
| `POST /trips` `{name, currency}` | 201 | 400 |
| `GET /trips?limit&cursor` — лише свої, новіші першими | 200 | 400 |
| `GET /trips/:id` — з учасниками, витратами й частками, переказами | 200 | — |
| `DELETE /trips/:id` (005) — будь-який статус, каскадно `[AI]` | 204 | — |
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
`description` 0–200 симв. `[AI]`; `limit` 1–100, типово 20 `[AI]`; пароль 8–72 симв.
`[AI]`. Логін: невідомий email і хибний пароль — однакова відповідь `401`.

**Помилки** — один глобальний обробник, `application/problem+json`: `type`, `title`, `status`,
`code`, `detail`, `requestId`. `400` форма запиту · `401` JWT · `404` немає або чуже · `409`
стан (I4, I5, закриття з ненульовими балансами) · `422` правило домену (I1, I3, від = кому) ·
`503` БД чи Supabase Auth недоступні / таймаут, з `Retry-After` · `500` без внутрішніх
деталей.
**Ідемпотентність:** `Idempotency-Key` на кожному `POST /trips*`; повтор → та сама відповідь; той
самий ключ з іншим тілом → `422`; ключ ще в обробці → `409`; TTL 24 год `[AI]`.

## 2. Схема БД (UUIDv7 генерує застосунок; суми `bigint > 0`)

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
