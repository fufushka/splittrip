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
- **GNU make**. На Linux і macOS він зазвичай уже є. На Windows поставте його одним зі
  способів і перезапустіть термінал:
  - `winget install ezwinports.make` — без прав адміністратора;
  - `choco install make` — у терміналі адміністратора.
- **git** — hook-и й визначення версії.

## Запуск

```sh
git clone https://github.com/fufushka/splittrip.git
cd splittrip
make install   # npm ci + автоматичне підключення git-hook-ів
make check     # усі перевірки: формат, лінт, чистота, типи, межі, збірка, smoke
```

`make check` на чистому клоні має пройти без інших кроків.

| Команда | Що робить |
|---|---|
| `make install` | Встановлює залежності з lock-файлу й підключає hook-и |
| `make check` | Запускає C1–C3 і C5–C8 ([standarts/checks.md](standarts/checks.md)) |
| `make format` | Форматує код |
| `make smoke` | Збирає застосунок і запускає smoke-тест |
| `make ai-trace` | Показує коміти для кожного промпту в `ai/` |
| `npm run dev` | Запускає сервер із сирців у режимі спостереження |
| `npm start` | Запускає зібраний сервер (`PORT`, `HOST`, `APP_VERSION`) |

Ендпоінти: `GET /health` → `{"status":"ok"}`, `GET /version` → `{"version":"<sha>"}`
або `{"version":"unknown"}`.

## Git-hook-и

Hook-и підключаються під час `make install`. Кожен лише викликає ціль `make`.

| Hook | Ціль | Блокує, якщо |
|---|---|---|
| pre-commit | `make pre-commit` | формат, лінт (лише доданих файлів) або чистота репо не проходять |
| commit-msg | `make commit-msg` | повідомлення не за [standarts/commits.md](standarts/commits.md) |
| pre-push | `make pre-push` | типи, межі модулів, збірка або smoke не проходять |

## Залежності

| Пакет | Навіщо |
|---|---|
| `fastify` | HTTP-сервер зі схемами валідації й логером ([ADR-0003](docs/adr/0003-fastify-http.md)) |
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
src/main.ts            composition root
src/modules/<модуль>/  money, balances, trips, system, http; вхід — index.ts
test/smoke/            smoke-тест зібраного застосунку
scripts/               власні перевірки C3, C4, C9
standarts/             інженерні стандарти проєкту
docs/adr/              архітектурні рішення (MADR)
docs/specs/labN-*/     spec, spec-fix, архітектура, аудит, DEFENSE і звіти лаби
ai/labN/               дослівні промпти до ШІ
```
