# DEFENSE: Лаба 3 — тестування SplitTrip

Шлях: з ШІ. [Вимоги й критерії](https://github.com/fufushka/splittrip/blob/feature/lab3-testing/docs/specs/lab3-testing/spec.md) · [уточнення](https://github.com/fufushka/splittrip/blob/feature/lab3-testing/docs/specs/lab3-testing/spec-fix-01.md) · [слід рішень](https://github.com/fufushka/splittrip/tree/feature/lab3-testing/ai/lab3).

## 1. Що і навіщо

Я покрив критичну логіку SplitTrip unit-, інтеграційними та E2E-тестами. Покриття гілок і мутації перевіряють, чи тести виявляють помилки в розрахунках та правилах поїздки, а `npm test` відтворює повний прогін з БД і застосунком.

## 2. Топ-3 розбіжності між spec і виходом ШІ

Початкові «зелені» тести не захищали три поведінкові вимоги. Виявлення й фідбек: [питання ШІ](https://github.com/fufushka/splittrip/blob/feature/lab3-testing/ai/lab3/014a-ai-top3-questions.md) → [мої відповіді](https://github.com/fufushka/splittrip/blob/feature/lab3-testing/ai/lab3/015-top3-answers.md); підстава для виправлень — критерій 17 [spec](https://github.com/fufushka/splittrip/blob/feature/lab3-testing/docs/specs/lab3-testing/spec.md).

| Прогалина в тестах | Наслідок мутації | Тест → коміт |
|---|---|---|
| Один кредитор у сценаріях `suggestTransfers` | Заміна `creditor.amount -= amount` на `+=` лишалася непоміченою: другий кредитор не отримував належне | Кілька кредиторів, перевірка нульових залишків → [`c2e2e9b`](https://github.com/fufushka/splittrip/commit/c2e2e9b) |
| `PUT` перевіряв одну витрату | Мутант змінював **усі** витрати замість однієї | API-тест із двома витратами → [`ee63392`](https://github.com/fufushka/splittrip/commit/ee63392) |
| Перевірка незмінності закритої поїздки пропускала `DELETE /transfers/:id` | Мутант дозволяв видалити переказ після закриття | API-тест на `409 trip_closed` → [`7a037cd`](https://github.com/fufushka/splittrip/commit/7a037cd) |

## 3. Ключове рішення

[ADR-0022](https://github.com/fufushka/splittrip/blob/feature/lab3-testing/docs/adr/0022-stryker-tap-runner.md): Stryker з TAP-ранером для `node:test` і TypeScript checker. Розглядали `command`-runner (усі тести для кожного мутанта) та попередню збірку тестів у JS (додатковий крок). Два конфіги дають окремий поріг **100%** для `balances` і загальний аналіз решти модулів. Оркестрація — [ADR-0024](https://github.com/fufushka/splittrip/blob/feature/lab3-testing/docs/adr/0024-npm-test-orchestrator.md); замість `make` проєкт використовує `npm run` за [ADR-0014](https://github.com/fufushka/splittrip/blob/feature/lab3-testing/docs/adr/0014-npm-scripts-over-makefile.md).

## 4. Перевірка та відтворення

```sh
git checkout feature/lab3-testing
npm ci
npm run check           # формат, лінт, типи, межі, smoke, unit, API на memory, пороги
npm test -- --report     # Docker → Supabase → ізольована БД → unit → інтеграційні → E2E → пороги → прибирання
npm run mutation -- after  # Stryker без Docker; історичне «до» — mutation-before.txt
```

[Збережений прогін `npm test`](https://github.com/fufushka/splittrip/blob/feature/lab3-testing/docs/specs/lab3-testing/reports/npm-test.txt) на `ca177ca4`: **30/30 unit, 66/66 інтеграційних, 5/5 E2E**, код виходу 0; `balances` — 100% рядків і гілок, пороги п'яти критичних файлів виконано. [Негативний сценарій 09](https://github.com/fufushka/splittrip/blob/feature/lab3-testing/docs/specs/lab3-testing/reports/09-coverage-threshold-rejected.txt) підтверджує: вилучений тест знижує `balances` до 95,83% гілок і зупиняє `check`. `GET /version` у E2E дорівнює `git rev-parse HEAD`; у збереженому прогоні це `ca177ca4ca024e1516ce29eb1030e55513f5fa18` (пізніші коміти змінили лише документацію).

## 5. Ефективність тестів

[Мутації «до»](https://github.com/fufushka/splittrip/blob/feature/lab3-testing/docs/specs/lab3-testing/reports/mutation-before.txt) → [«після»](https://github.com/fufushka/splittrip/blob/feature/lab3-testing/docs/specs/lab3-testing/reports/mutation-after.txt): `balances` **76,67% → 100%**, загальний бал решти модулів **70,73% → 83,90%**; код виходу **1 → 0**. З 67 початкових вижилих або непокритих мутантів **31 мутанта класу «реальна прогалина»** вбито новими тестами, **3 еквівалентні** обґрунтовано вимкнено, **33 прийнятні** лишилися (переважно тексти помилок і логів, яких контракт не фіксує). Повна класифікація за файлом і рядком, включно з тестами та комітами, — в [аналізі мутацій](https://github.com/fufushka/splittrip/blob/feature/lab3-testing/docs/specs/lab3-testing/reports/mutation-analysis.md). Для недосяжної гілки `balances` застосовано документований `node:coverage ignore` за [spec-fix-01](https://github.com/fufushka/splittrip/blob/feature/lab3-testing/docs/specs/lab3-testing/spec-fix-01.md); досяжні гілки покрито тестами.
