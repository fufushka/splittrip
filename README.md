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
| 2 — HTTP API і база даних | [DEFENSE.md](docs/specs/lab2-api-db/DEFENSE.md) |
| 3 — тестування | [DEFENSE.md](docs/specs/lab3-testing/DEFENSE.md) |

## Вимоги

- **Node.js ≥ 24** — <https://nodejs.org>.
- **git** — hook-и й визначення версії.
- **Docker** — для роботи з БД (локальний Supabase, `npm run db:start`) і для `npm test`.

## Запуск

```sh
git clone https://github.com/fufushka/splittrip.git
cd splittrip
npm ci          # залежності + автоматичне підключення git-hook-ів
npm run check   # усі перевірки: формат, лінт, чистота, типи, межі, збірка, smoke, тести, покриття
```

`npm run check` на чистому клоні має пройти без інших кроків.

| Команда | Що робить |
|---|---|
| `npm ci` | Встановлює залежності з lock-файлу й підключає hook-и |
| `npm run check` | Запускає перевірки з [standarts/checks.md](standarts/checks.md) |
| `npm run format` | Форматує код |
| `npm run smoke` | Збирає застосунок і запускає smoke-тест |
| `npm test` | Усі рівні тестів однією командою (C14, потрібен Docker); `-- --report` → `reports/npm-test.txt` лаби 3 |
| `npm run test:unit` | Unit-тести `test/unit/` (`ids`, `money`, `balances`, `idempotency`, Auth на фейку) і покриття `balances` від них |
| `npm run test:api` | API-тести всіх сценаріїв на `STORAGE=memory` (C11) |
| `npm run coverage` | Unit + API на `memory` з покриттям і пороги гілок на файл (C13) |
| `npm run mutation [-- before\|after]` | Мутації Stryker (C15); з `before`/`after` — звіт `reports/mutation-<arg>.txt` лаби 3 |
| `npm run db:start` / `db:stop` | Локальний Supabase у Docker: Postgres `54322`, API `54321` |
| `npm run db:migrate` | Міграції `db/migrations/` на `DATABASE_URL` (типово — локальний Supabase) |
| `npm run test:api:db` | Ті самі API-тести + тести БД на `STORAGE=postgres` в окремій базі `run_<id>` (C12) |
| `npm run report:db` | Звіт поведінки на БД: ретраї, збої, fail-fast, N+1 → `reports/09-db-behaviour.txt` |
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

## Тести

Рівні — [spec лаби 3](docs/specs/lab3-testing/spec.md), розд. «Рівні тестів»; рішення —
мутації [ADR-0022](docs/adr/0022-stryker-tap-runner.md), покриття
[ADR-0023](docs/adr/0023-builtin-coverage-per-file.md), `npm test`
[ADR-0024](docs/adr/0024-npm-test-orchestrator.md).

| Рівень | Що перевіряє | Тека | Команда |
|---|---|---|---|
| Unit | Модуль без справжніх БД і Supabase; фейк у процесі тесту дозволений | `test/unit/` | `npm run test:unit` |
| API на `memory` (не рівень) | `app.inject`, сховище в пам'яті, фейковий Auth | `test/api/` | `npm run test:api` (C11) |
| Інтеграційні | Ті самі тести на справжніх Postgres (`run_<id>`) і Supabase Auth | `test/api/` | `npm run test:api:db` (C12), `npm test` |
| E2E | Зібраний `dist/main.js` окремим процесом, справжні БД і Auth, `fetch` | `test/e2e/` | лише `npm test` |

```sh
npm test                    # Docker → Supabase → run_<id> → unit → інтеграційні → E2E → пороги
npm test -- --report        # те саме + вивід у docs/specs/lab3-testing/reports/npm-test.txt
npm run coverage            # пороги гілок на unit + API на memory, без Docker
npm run mutation -- before  # Stryker; звіт «до» (after — «після»)
```

- `npm test` піднімає Supabase, якщо його не запущено, і не зупиняє після прогону; базу
  `run_<id>` і застосунок прибирає й після падіння етапу. Без Docker — код ≠ 0 до тестів.
- E2E окремо не запускаються: адресу застосунку (`E2E_BASE_URL`) дає `npm test`.
- Покриття — вбудоване в Node; пороги гілок: ≥ 90% на `money`, `trips/domain`,
  `trips/service`, `idempotency` і 100% на `balances`. У check і pre-push — на unit + API на
  `memory`, у `npm test` — на unit + інтеграційних.
- Мутації — `money`, `balances` (`break` 100%), `trips/domain`, `trips/service` проти unit +
  API на `memory`, без Docker. Аналіз вижилих —
  [mutation-analysis.md](docs/specs/lab3-testing/reports/mutation-analysis.md).
- `npm test` і `npm run mutation` — вручну перед здачею, у hook-и не входять (C14, C15).

## Git-hook-и

Hook-и підключаються під час `npm ci` (скрипт `prepare`). Кожен лише викликає `npm run …` ([ADR-0014](docs/adr/0014-npm-scripts-over-makefile.md)).

| Hook | Ціль | Блокує, якщо |
|---|---|---|
| pre-commit | `npm run pre-commit` | формат, лінт (лише доданих файлів) або чистота репо не проходять |
| commit-msg | `npm run commit-msg` | повідомлення не за [standarts/commits.md](standarts/commits.md) |
| pre-push | `npm run pre-push` | типи, межі модулів, збірка, smoke, unit- чи API-тести (C11) або пороги покриття (`npm run coverage`, C13) не проходять |

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
| `@stryker-mutator/core` | Мутаційне тестування — перевірка C15, `npm run mutation` ([ADR-0022](docs/adr/0022-stryker-tap-runner.md)) |
| `@stryker-mutator/tap-runner` | Запускає тести `node:test` під Stryker через TAP-вивід, з покриттям на тест-файл |
| `@stryker-mutator/typescript-checker` | Відкидає мутанти з помилками типів (`CompileError`), щоб вони не рахувалися вижилими |

## Структура

```
src/main.ts            точка входу процесу
src/compose.ts         composition root: сховище, Auth, сервіси, сервер (ADR-0016)
src/modules/<модуль>/  вхід — index.ts; перелік і межі — architecture.md лаби 2
test/smoke/            smoke-тест зібраного застосунку
test/unit/             unit-тести: без справжніх БД і Supabase, фейки в процесі
test/api/              API-тести сценаріїв (memory, з лаби 2 — і postgres)
test/e2e/              E2E зібраного застосунку через fetch; запускає npm test
scripts/               перевірки C3, C4, C9, C13; npm test; база run_<id>; мутації; db-скрипти
standarts/             інженерні стандарти проєкту
docs/adr/              архітектурні рішення (MADR)
docs/specs/labN-*/     spec, spec-fix, архітектура, аудит, DEFENSE і звіти лаби
ai/labN/               дослівні промпти до ШІ
```
