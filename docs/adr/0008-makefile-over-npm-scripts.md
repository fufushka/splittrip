---
status: запропоновано
date: 2026-09-29
decision-makers: Dima Pustolyakov
---

# 0008. Makefile як тонка обгортка над npm scripts

## Контекст і проблема

Курс вимагає відтворення через `make …` (spec.md, крит. 5), а в Node-проєкті природна
точка запуску — `npm run`. Автор працює на Windows, де `make` за замовчуванням немає
(spec-fix-01, п. 6).

## Чинники рішення

- Одне джерело правди для команд.
- Однаковий результат з hook-а, з `make` і з `npm run`.
- Робота в Git Bash, cmd і PowerShell.

## Розглянуті варіанти

- Makefile викликає `npm run <скрипт>`; логіка — у `package.json`
- Makefile з повною логікою команд
- Лише npm scripts, без Makefile

## Рішення

Обрано «Makefile поверх npm scripts»: кожна ціль (`install`, `check`, `format-check`, `lint`,
`hygiene`, `typecheck`, `boundaries`, `build`, `smoke`, `ai-trace`) — один рядок
`npm run …`. Рецепти не використовують синтаксис конкретної оболонки, тож працюють усюди,
де є GNU make.

### Наслідки

- Добре: логіка в одному місці; `make` — вимога курсу, `npm run` — звично для Node.
- Погано: на Windows потрібно встановити `make` (`choco install make` або
  `winget install ezwinports.make`) — описано в README.

### Підтвердження

Кожен рецепт у Makefile — лише `npm run …`; `make check` на чистому клоні проходить.

## Плюси й мінуси варіантів

### Makefile поверх npm scripts

- Добре: одне джерело правди, кросплатформність.
- Погано: два файли з переліком команд.

### Makefile з повною логікою

- Добре: усе видно в одному файлі.
- Погано: синтаксис оболонки ламається між Windows і Unix; дублювання з npm scripts.

### Лише npm scripts

- Добре: нічого встановлювати.
- Погано: порушує вимогу курсу `make …`.

## Додаткова інформація

Промпти: `ai/lab1/004`, `ai/lab1/005`. Пов'язані: ADR-0007.
