# spec-fix-01: Лаба 3 — уточнення після рев'ю дизайну

Статус: чернетка. Питання AI — [`ai/lab3/011a`](../../../ai/lab3/) (В1, В4, В6),
відповіді автора — `012`, п. 1, 4, 6; `[AI]` — пропозиція AI без явної відповіді автора.

## Що і навіщо

Доповнює [spec.md](spec.md). Рев'ю дизайну (`011a`): у `balances/index.ts:55` права
частина `totals.get(participantId) ?? ZERO` недосяжна — ключі `totals` рівно
`participantIds`, тож 100% гілок (крит. 2, 3) без зміни `src/` не досягти (unit + API на
`memory`: `BRH:21`, `BRF:23`; рядок 42 досяжний — бракує тесту). Ще spec не каже, чи
крит. 2 — поріг, і в яких модулях ставиться `Stryker disable` крит. 14.

## Уточнення

1. **До крит. 2 і 3 (012, п. 1).** Відсоток гілок — у метриці вбудованого покриття Node:
   `BRH`/`BRF` lcov і стовпець `branch %` таблиці звіту. Над рядком `amount: … ?? ZERO`
   ставиться `/* node:coverage ignore next */` і коментар із причиною; Node зараховує цю
   гілку покритою (сирий `BRDA` лишається 0). Інші гілки — так само, лише доведено
   недосяжні `[AI]`; досяжну непокриту (як рядок 42) покриває тест. Кожен такий коментар —
   рядок у `reports/mutation-analysis.md`: файл:рядок, гілка, чому недосяжна `[AI]`.
2. **До крит. 2 (012, п. 4).** `npm run test:unit` лише друкує покриття `balances` від
   самих unit-тестів, порогу не має. Поріг 100% на `balances` — поріг крит. 3 у check
   (`npm run coverage`); саме він падає в сценарії `npm run demo` крит. 5.
3. **До крит. 14 (012, п. 6).** `// Stryker disable next-line <мутатор>: <причина>` для
   еквівалентних мутантів — у всіх чотирьох модулях крит. 13 (`money`, `balances`,
   `trips/domain`, `trips/service`), не лише в `balances`; кожен такий коментар має рядок
   у `reports/mutation-analysis.md`.

## Критерії прийняття

- П. 1: `npm run coverage` — `balances` 100% гілок; у `src/modules/balances/index.ts` над
  `amount: totals.get(participantId) ?? ZERO` — `/* node:coverage ignore next */` і
  причина; над `totals.get(id) ?? ZERO` у `shift` такого коментаря немає.
- П. 2: `test:unit` у `package.json` — без `--test-coverage-{lines,branches,functions}`;
  вивід `npm run test:unit` — таблиця з `balances` 100% рядків і гілок.
- П. 2: у звіті сценарію крит. 5 (`npm run demo`) `test:unit` проходить, check падає на
  `npm run coverage` через `balances`.
- П. 1, 3: `git grep -n -e "node:coverage" -e "Stryker disable" -- src` — кожне входження
  має рядок у `reports/mutation-analysis.md`; `Stryker disable` — лише у файлах крит. 13.

## Обмеження

- Ті самі, що в spec.md.
- `src/` у лабі 3 змінюється лише фіксами багів (spec, «Обмеження») і коментарями
  п. 1 і 3; інша зміна — через нову spec-fix `[AI]`.
- Код за цією spec-fix — лише після коміту її прийняття (ai-workflow 0.5).
