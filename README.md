# SplitTrip

Сервіс для обліку спільних витрат у подорожі. Користувач створює поїздку й додає
учасників. Для кожної витрати він вказує, хто заплатив, скільки, між ким вона ділиться і
як: порівну або конкретними сумами. SplitTrip рахує баланс кожного учасника й пропонує
перекази, після яких усі розраховуються. Коли баланси обнулено, поїздку закривають.

Правила продукту: [spec-fix-02](docs/specs/lab1-foundation/spec-fix-02.md),
[spec-fix-03](docs/specs/lab1-foundation/spec-fix-03.md). Архітектура:
[architecture.md](docs/specs/lab1-foundation/architecture.md).

## Лаби

| Лаба | Точка входу для рев'ю |
|---|---|
| 1 — фундамент і структура | [DEFENSE.md](docs/specs/lab1-foundation/DEFENSE.md) |

## Вимоги

- **Node.js ≥ 24** — <https://nodejs.org>.
- **git** — hook-и й визначення версії.
- **Docker** — лише для роботи з БД: локальний Supabase (`npm run db:start`).

## Запуск

```sh
git clone https://github.com/fufushka/splittrip.git
cd splittrip
npm ci          # залежності + автоматичне підключення git-hook-ів
npm run check   # усі перевірки: формат, лінт, чистота, типи, межі, збірка, smoke
```

`npm run check` на чистому клоні має пройти без інших кроків.

| Команда | Що робить |
|---|---|
| `npm ci` | Встановлює залежності з lock-файлу й підключає hook-и |
| `npm run check` | Запускає перевірки з [standarts/checks.md](standarts/checks.md) |
| `npm run format` | Форматує код |
| `npm run smoke` | Збирає застосунок і запускає smoke-тест |
| `npm run test:unit` | Модульні тести чистих модулів (`ids`, `money`, `balances`) |
| `npm run test:api` | API-тести всіх сценаріїв на `STORAGE=memory` (C11) |
| `npm run db:start` / `db:stop` | Локальний Supabase у Docker: Postgres `54322`, API `54321` |
| `npm run db:migrate` | Міграції `db/migrations/` на `DATABASE_URL` (типово — локальний Supabase) |
| `npm run test:api:db` | Ті самі API-тести + тести БД на `STORAGE=postgres` в окремій базі `run_<id>` (C12) |
| `npm run ai-trace` | Показує коміти для кожного промпту в `ai/` |
| `npm run demo` | Відтворює відмови перевірок, звіти — у `reports/` лаби |
| `npm run dev` | Запускає сервер із сирців у режимі спостереження |
| `npm start` | Запускає зібраний сервер (`PORT`, `HOST`, `APP_VERSION`, `STORAGE`, `LOG_LEVEL`) |

API — [contract.md](docs/specs/lab2-api-db/contract.md): `/auth/*`, `/trips*`, `/health`,
`/ready`, `/version`. `STORAGE=memory` (типово) — усе в пам'яті процесу, включно з фейковим
Auth: дані зникають після перезапуску.

## База даних

```sh
npm run db:start        # Docker: локальний Supabase; ключ підпису JWT створюється сам
npm run db:migrate      # схема в базі postgres локального Supabase
npm run test:api:db     # база run_<id> → міграції → тести → база видаляється
```

Застосунок на БД: `.env` за зразком [.env.example](.env.example) (`STORAGE=postgres`,
`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`), далі `npm run dev`. Для хмари —
`DATABASE_URL` Supavisor transaction pooler (порт 6543). Передумова хмарного проєкту:
вимкнено «Confirm email» (Authentication → Sign In / Providers → Email) — підтвердження email
поза обсягом ([spec-fix-03](docs/specs/lab2-api-db/spec-fix-03.md)).

## Git-hook-и

Hook-и підключаються під час `npm ci` (скрипт `prepare`). Кожен лише викликає `npm run …` ([ADR-0014](docs/adr/0014-npm-scripts-over-makefile.md)).

| Hook | Ціль | Блокує, якщо |
|---|---|---|
| pre-commit | `npm run pre-commit` | формат, лінт (лише доданих файлів) або чистота репо не проходять |
| commit-msg | `npm run commit-msg` | повідомлення не за [standarts/commits.md](standarts/commits.md) |
| pre-push | `npm run pre-push` | типи, межі модулів, збірка або smoke не проходять |

## Залежності

| Пакет | Навіщо |
|---|---|
| `fastify` | HTTP-сервер зі схемами валідації й логером ([ADR-0003](docs/adr/0003-fastify-http.md)) |
| `jose` | Перевірка й (у фейку) підпис JWT Supabase Auth ([ADR-0017](docs/adr/0017-supabase-auth-http-and-jwks.md)) |
| `postgres` | Драйвер Postgres: SQL tagged templates, пул, транзакції ([ADR-0015](docs/adr/0015-postgres-js-driver.md)) |
| `supabase` | CLI локального Supabase у Docker для ізольованого середовища ([ADR-0020](docs/adr/0020-sql-migrations-and-isolated-db.md)) |
| `typescript` | Статичний аналіз типів і збірка `dist/`; ~6.0 через typescript-eslint ([ADR-0001](docs/adr/0001-typescript-on-node-24.md)) |
| `@types/node` | Типи вбудованих модулів Node 24 |
| `prettier` | Форматер коду й конфігів — перевірка C1 ([ADR-0005](docs/adr/0005-prettier-eslint-tsc.md)) |
| `eslint` | Лінтер — перевірка C2 |
| `@eslint/js` | Базові правила ESLint для JavaScript |
| `typescript-eslint` | Правила лінту з інформацією про типи (забуті `await` тощо) |
| `dependency-cruiser` | Автоматичні межі модулів — перевірка C6 ([ADR-0006](docs/adr/0006-dependency-cruiser-boundaries.md)) |
| `husky` | Підключає git-hook-и під час `npm ci` ([ADR-0007](docs/adr/0007-husky-lint-staged-hooks.md)) |
| `lint-staged` | Перевіряє в pre-commit лише додані до коміту файли |

## Структура

```
src/main.ts            точка входу процесу
src/compose.ts         composition root: сховище, Auth, сервіси, сервер (ADR-0016)
src/modules/<модуль>/  вхід — index.ts; перелік і межі — architecture.md лаби 2
test/smoke/            smoke-тест зібраного застосунку
test/unit/             модульні тести чистих модулів
test/api/              API-тести сценаріїв (memory, з лаби 2 — і postgres)
scripts/               власні перевірки C3, C4, C9
standarts/             інженерні стандарти проєкту
docs/adr/              архітектурні рішення (MADR)
docs/specs/labN-*/     spec, spec-fix, архітектура, аудит, DEFENSE і звіти лаби
ai/labN/               дослівні промпти до ШІ
```
