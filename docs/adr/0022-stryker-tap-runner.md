---
status: прийнято
date: 2026-11-20
decision-makers: Dima Pustolyakov
---

# 0022. Мутаційне тестування — Stryker з tap-runner і typescript-checker, два запуски

## Контекст і проблема

Лаба 3 вимагає мутаційного тестування зі звітом і класифікацією вижилих мутантів (spec,
крит. 13–17). Зі списку умови (Stryker / PIT / mutmut / cosmic-ray) для TypeScript підходить
лише Stryker (PIT — Java, mutmut і cosmic-ray — Python; `ai/lab3/005a`, п. 5). Наші тести —
`node:test`, `.ts` виконує сам Node 24 (type stripping) без збірки (ADR-0001, ADR-0004), а
Stryker не має раннера саме для `node:test`.

## Чинники рішення

- Мутанти ганяються проти unit- і API-тестів на `memory`, без Docker (крит. 13).
- `break` 100% лише на `balances` (крит. 14), а поріг у Stryker один на запуск.
- Вижилі мають класифікуватися вручну (крит. 15) — менше хибних «вижилих», менше роботи.
- Мінімум нових залежностей і без окремої збірки тестів.

## Розглянуті варіанти

- `@stryker-mutator/tap-runner` (TAP із `node --test-reporter=tap`), покриття на тест-файл
- `command`-runner: `node --test …` на кожен мутант, без аналізу покриття
- `buildCommand: tsc` — спершу зібрати тести в JS, як радить гайд Stryker для Node

## Рішення

Обрано **tap-runner** (`coverageAnalysis: 'perTest'`) і **`@stryker-mutator/typescript-checker`**
(`ai/lab3/012`, п. 5): мутанти, які `tsc` відхилив би, отримують `CompileError` і не
вважаються вижилими. Два конфіги й два послідовні запуски в `npm run mutation`
(`scripts/mutation.ts`): `stryker.balances.config.js` з `break: 100` і базовий
`stryker.config.js` для `money`, `trips/domain`, `trips/service` без `break`. Еквівалентні
мутанти — `// Stryker disable next-line <мутатор>: <причина>` у всіх чотирьох модулях
(`ai/lab3/012`, п. 6). Запасний варіант, якщо tap-runner не запрацює з type stripping, —
`command`-runner із `coverageAnalysis: 'off'`.

### Наслідки

- Добре: для кожного мутанта виконуються лише тест-файли, що покривають його рядок; видно
  статус `NoCoverage`, що допомагає класифікації.
- Добре: поріг `break` — рідний механізм Stryker, а не наш скрипт.
- Погано: +3 dev-залежності (`core`, `tap-runner`, `typescript-checker`); checker сповільнює
  запуск.
- Погано: не підтверджено, що хук tap-runner (`-r {{hookFile}}`) і інструментований код
  працюють із type stripping Node 24 в ESM (architecture.md лаби 3, П1–П3) — перший сеанс
  реалізації це перевіряє; за провалу — запасний варіант і оновлення цього ADR до прийняття.
- Погано: два запуски — бал рахується окремо для `balances` і для решти.

### Підтвердження

C15: `npm run mutation -- before|after` пише `reports/mutation-<arg>.txt` з командою й кодом
виходу; `npx stryker run stryker.balances.config.js --dryRunOnly` проходить.

## Плюси й мінуси варіантів

### tap-runner

- Добре: офіційний плагін для TAP-виводу `node:test`; покриття на тест-файл.
- Погано: сумісність із type stripping не задокументована; статичні мутанти не розпізнає.

### command-runner

- Добре: найменший ризик інтеграції — лише команда.
- Погано: кожен мутант ганяє весь набір; не видно, який тест убив мутанта, і `NoCoverage`.

### buildCommand: tsc

- Добре: шлях, описаний у гайді Stryker.
- Погано: тести зараз ніхто не збирає (`tsconfig.build.json` бере лише `src`) — окрема
  збірка лише для мутацій.

## Додаткова інформація

Промпти: `ai/lab3/007` (п. 4), `010` (п. 5–6), `012` (п. 5–6). Spec лаби 3, крит. 13–17;
spec-fix-01 (п. про `Stryker disable`). Пов'язані: ADR-0004, ADR-0023.
