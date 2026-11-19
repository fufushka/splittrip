# Архітектура SplitTrip — лаба 3 (тести)

Статус: прийнято (`014`) · Вхід: [spec.md](spec.md) (прийнято, `579129e`) і
[spec-fix-01](spec-fix-01.md) (прийнято разом із дизайном, `014`) — уточнення
крит. 2, 3, 14. Рішення автора щодо дизайну — `ai/lab3/012` (питання — `011a`).

Розвиває [архітектуру лаби 2](../lab2-api-db/architecture.md): модулі, межі (C6), шлях
запиту й HTTP API ([contract.md](../lab2-api-db/contract.md)) не змінюються. `src/`
змінюється лише коментарями `Stryker disable` (крит. 14), одним `node:coverage ignore` у
`balances` (spec-fix-01) і фіксами знайдених багів (spec, «Обмеження»).

## 1. Рівні тестів (spec, «Рівні тестів»; крит. 1, 4)

| Рівень | Файли | Залежності | Команда |
|---|---|---|---|
| Unit | `test/unit/*.test.ts` | без БД і Supabase; фейки в процесі | `npm run test:unit` |
| API на `memory` (не рівень) | `test/api/*.test.ts` | `app.inject`, memory-сховище, фейк Auth | `npm run test:api` (C11) |
| Інтеграційні | `test/api/*.test.ts`, `STORAGE=postgres` | `app.inject`, `run_<id>`, локальний Supabase Auth | `test:api:db` (C12), `npm test` |
| E2E | `test/e2e/*.test.ts` | `dist/main.js` окремим процесом, `run_<id>`, Supabase Auth, `fetch` | `npm test` |
| Smoke (C8, поза рівнями) | `test/smoke/*.test.ts` | `dist/main.js` на `memory` | `npm run smoke` |

E2E — чорна скринька: імпортує лише `node:*` і `test/e2e/client.ts`, нічого з `src/`
(конвенція; C6 сканує лише `src/`).

## 2. `npm test` — оркестратор (крит. 1, 6–8)

`npm test` = `node scripts/test-all.ts`. Спільне з `test:api:db` — у `scripts/run-db.ts`:
створити `run_<id>`, накотити `db/migrations`, видалити (`drop … with (force)`), env
інтеграційних (`STORAGE=postgres`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SIGNING_KEYS`). `scripts/test-db.ts` переходить на нього без зміни поведінки (C12).

| # | Етап | Як |
|---|---|---|
| 1 | Docker | `docker info`; немає CLI (`ENOENT`) або код ≠ 0 → код 1 ще до тестів (крит. 7) |
| 2 | Supabase | `npx supabase status -o env` (не запущено → код 1, перевірено в 011a) → `npm run db:start` (ключ підпису + `supabase start`); після прогону не зупиняється (spec, «Не входить») |
| 3 | База | `run_<id>` + міграції (`run-db.ts`, ADR-0020) |
| 4 | unit | `npm run test:unit`, разом зі звітом покриття `balances` (крит. 2) |
| 5 | інтеграційні | `npm run test:cov` з env бази прогону → `coverage/lcov.info` (розд. 4) |
| 6 | застосунок | `npm run build`; `node dist/main.js` (розд. 3); чекати `GET /ready` = 200 ≤ 20 с; процес завершився чи таймаут → провал з хвостом логу |
| 7 | E2E | `node --test --test-timeout=60000 test/e2e/*.test.ts` з `E2E_BASE_URL` |
| 8 | пороги | `node scripts/check-coverage.ts coverage/lcov.info` (крит. 3) |
| — | `finally` | зупинити застосунок (SIGTERM, за 5 с — SIGKILL), потім видалити базу (крит. 8) |

- Етапи послідовні; перший провал зупиняє решту (як `npm run check`), далі — лише
  прибирання. Код 0 — лише якщо пройшли всі етапи й прибирання (крит. 7). SIGINT/SIGTERM —
  як падіння поточного етапу.
- Дочірні процеси — `spawn` з pipe (вивід іде в консоль і збирається), `npm`/`npx` — через
  shell, як у `demo-guards.ts`. Перед етапом — `== [N/8] <етап> ==`, наприкінці — таблиця
  «етап · OK / ПОМИЛКА / пропущено · тривалість» (крит. 1).
- `npm test -- --report` ще й пише вивід у `reports/npm-test.txt`: рядок 1 —
  `# Відтворити: npm test -- --report (потрібен Docker)`, далі `# HEAD`, `# Код виходу`.

**Етап 5 — один запуск unit + інтеграційних (012, п. 2).** Покриття Node зводить процеси
лише в межах одного `node --test`. Два lcov не об'єднати: `BRDA` нумеруються індексом, а
набір гілок V8 залежить від прогону. Unit-тести виконуються вдруге (≈ 0,3 с). Підсумок
рівнів друкує репортер `scripts/level-summary.ts` за каталогом файлу (`test/unit/` → unit,
`test/api/` → «інтеграційні» або «API (memory)» за `STORAGE`). Повторний прогін на тій самій
базі неможливий: `postgres.test.ts` створює `test_fault_*` без `if not exists`.

**E2E на тій самій `run_<id>`** — крит. 6 називає одну базу. Свої користувачі не бачать
даних інтеграційних тестів (доступ власника), `test_fault` спрацьовує лише для своєї поїздки,
а `auth.users` Supabase однаково спільні для всіх прогонів.

## 3. E2E (крит. 9–12)

Застосунок стартує оркестратор (етап 6), а не тест-файл: E2E-файли йдуть паралельно без
повторного старту. Як у smoke (ADR-0004): вільний порт через `listen(0)`,
`HOST=127.0.0.1`, без `--env-file`. Env = env інтеграційних + `PORT`, `HOST`, без
`APP_VERSION` і `NODE_V8_COVERAGE`. Вивід застосунку — у `coverage/e2e-app.log`.

`test/e2e/client.ts`: `E2E_BASE_URL` (немає → помилка під час імпорту, не пропуск);
`request(method, path, { token, body, headers })` → `{ status, headers, body }`;
`newUser()` = `POST /auth/signup` 201 + `POST /auth/login` 200 через справжній Supabase Auth,
email `e2e-<uuid>@example.com`.

| Файл | Крит. | Кроки → коди за contract.md |
|---|---|---|
| `journey.test.ts` | 9 | signup 201 → login 200 → `POST /trips` 201 → 3 × participants 201 → витрати `equal` і `exact` 201 → balances 200 (≠ 0, Σ = 0) → settlements 200 → кожен запропонований `POST /transfers` 201 → balances 200, усі 0 → `close` 200, `status: closed` |
| `access.test.ts` | 10 | користувач Б: `GET /trips/:idA` 404, `POST /trips/:idA/participants` 404; А: `POST /auth/logout` 204 → `POST /auth/refresh` старим refresh-токеном 401 |
| `idempotency.test.ts` | 11 | два послідовні `POST /trips/:id/expenses` з одним `Idempotency-Key` і тілом → обидва 201, той самий `id`; `GET /trips/:id` → одна витрата |
| `version.test.ts` | 12 | `GET /version` 200, `version` = `git rev-parse HEAD` із самого тесту; git недоступний → провал, а не пропуск |

Без `APP_VERSION` крит. 12 перевіряє git, а не відлуння env. Smoke (C8) лишається: він
м'якший (без git допускає `unknown`) і працює на кожен пуш без Docker; E2E — суворий, на
повному стеку, доказ для DEFENSE §4.

## 4. Покриття (крит. 2–5)

Вбудоване покриття Node 24 (`--experimental-test-coverage`), без нових залежностей (007,
п. 3). Його пороги `--test-coverage-*` перевіряють лише суму всіх файлів, тому пороги на
файл рахує власний скрипт.

- **Пороги (крит. 3)** — `scripts/check-coverage.ts <lcov>`: для кожного `SF` бере
  `BRF`/`BRH` (і `LF`/`LH` для довідки), порівнює з таблицею в самому скрипті й друкує
  «файл · гілки % (BRH/BRF) · поріг · OK / НИЖЧЕ». Нижче порогу → код 1. Немає lcov, запису
  файлу чи `BRF = 0` → код 1 «не вдалося перевірити» (checks.md: помилка інструмента =
  провал). Рядки `BRDA` скрипт **не** читає: гілка під `node:coverage ignore` лишається в
  `BRDA` з лічильником 0, а в `BRF`/`BRH` зараховується покритою (перевірено на Node 24,
  011a). Пороги: гілки ≥ 90% на `src/modules/money/index.ts`, `trips/domain.ts`,
  `trips/service.ts`, `idempotency/index.ts`; 100% на `balances/index.ts`.
- **Що міряється (крит. 4).** `npm run test:cov` — один запуск над `test/unit` і `test/api`
  з `--test-coverage-include=src/**/*.ts` і репортерами `spec` → stdout,
  `./scripts/level-summary.ts` → stdout, `lcov` → `coverage/lcov.info`. Без env — API на
  `memory`: так у check і pre-push (`npm run coverage` = `test:cov` + `check-coverage`). З
  env бази прогону — інтеграційні: так у `npm test` (етапи 5 і 8).
- **Звіт unit (крит. 2; 012, п. 4).** `npm run test:unit` додає `--experimental-test-coverage
  --test-coverage-include=src/modules/balances/index.ts` — таблицю покриття `balances` лише
  від unit-тестів. Порогу тут немає: поріг на `balances` — у C13.
- **`balances` до 100% (крит. 2–3; spec-fix-01).** На unit + API на `memory` зараз
  `BRF 23 / BRH 21` (виміряно в 011a). Рядок 42 (`totals.get(id) ?? ZERO` у `shift`)
  досяжний — бракує unit-тесту «платник поза списком учасників». Рядок 55
  (`totals.get(participantId) ?? ZERO`) недосяжний: ключі `totals` — рівно `participantIds`.
  Над ним — спершу коментар із причиною, потім `/* node:coverage ignore next */` (він діє на
  наступний рядок).
- **Поріг падає (крит. 5, C10).** Сценарій `npm run demo` `09-coverage-threshold-rejected`:
  у тимчасовому клоні прибирається unit-тест «платник поза списком учасників». Він єдиний
  покриває рядок 42, бо через API туди не дійти: домен відхиляє невідомого платника з 422.
  `npm run check` падає на C13 (`balances 22/23 … НИЖЧЕ`), попередні кроки зелені. Docker не
  потрібен.

## 5. Мутації (крит. 13–17)

`npm run mutation` = `node scripts/mutation.ts [before|after]`: два запуски Stryker
послідовно, обидва — навіть якщо перший упав; env `STORAGE=memory`, `NO_COLOR=1`. Код
виходу ненульовий, якщо ненульовий хоч один запуск.

| Конфіг | `mutate` | `thresholds.break` | HTML (не в репо) |
|---|---|---|---|
| `stryker.balances.config.js` | `src/modules/balances/index.ts` | 100 | `coverage/mutation/balances.html` |
| `stryker.config.js` (база) | `money/index.ts`, `trips/domain.ts`, `trips/service.ts` | `null` | `coverage/mutation/domain.html` |

Поріг Stryker один на запуск, тому `break` 100% лише на `balances` (крит. 14) — окремий
запуск; його конфіг імпортує базовий і перевизначає `mutate`, `thresholds`, `htmlReporter`.
Що задає базовий конфіг:

- **Раннер.** `testRunner: 'tap'`; `tap.testFiles: ['test/unit/*.test.ts', 'test/api/*.test.ts']`
  (`postgres.test.ts` на `memory` пропускається); типові `nodeArgs` (`--test-reporter=tap -r
  {{hookFile}} {{testFile}}`) — `.ts` виконує сам Node 24, без `buildCommand` і `tsx`;
  `coverageAnalysis: 'perTest'` (покриття на тест-файл).
- **Checker (012, п. 5).** `checkers: ['typescript']`, `tsconfigFile: 'tsconfig.json'`.
  Мутант, якого відхилив би `tsc` (C5), отримує `CompileError` і в бал не входить. Без
  checker він виконався б: type stripping типів не перевіряє.
- **Вивід.** `reporters: ['clear-text', 'html']`, `clearTextReporter.allowColor: false`;
  `tempDirName: '.stryker-tmp'`, `cleanTempDir: 'always'`.

**Запасні варіанти** обирають до звіту «до», щоб «до» і «після» рахувалися однаково:

- tap-runner не працює (П1–П3) → `testRunner: 'command'`, `commandRunner.command:
  'node --test test/unit/*.test.ts test/api/*.test.ts'`, `coverageAnalysis: 'off'`;
- checker не працює з tsconfig (П5) → `tsconfig.stryker.json` (extends `tsconfig.json`) з
  потрібними перевизначеннями. Якщо й так не вийде — без checker, і питання автору: мутант
  із помилкою типів, що вижив у `balances`, тоді ні вбити, ні позначити еквівалентним.

- **Звіти (крит. 16).** З аргументом `before` / `after` скрипт пише
  `reports/mutation-<arg>.txt`: рядок 1 — `# Відтворити: npm run mutation -- <arg>`, далі
  `# HEAD`, `# Код виходу`, потім для кожного запуску `$ npx stryker run <конфіг>`, вивід і
  `[код виходу: N]` (формат `demo-guards.ts`). Звіт «до» ненульовий через `break` на
  `balances`; якщо вижилих там не виявиться, це висновок і spec-fix (010a, п. 2).
- **Аналіз (крит. 15, 17)** — `reports/mutation-analysis.md`:
  1. бал «до → після» для кожного запуску й файлу;
  2. вижилі мутанти зі звіту «до» (`Survived`, `NoCoverage`): `#` · файл:рядок · мутатор і
     зміна · чому вижив · клас (реальна прогалина / еквівалентний / прийнятний) · дія (тест
     і коміт / `Stryker disable` / лишається з причиною);
  3. топ-3 «реальна прогалина»: мутант (файл:рядок, зміна) → тест → коміт `test: …` →
     статус у звіті «після».

  Номери рядків — за звітом «до»: коментарі зсувають рядки.
- **Еквівалентні (крит. 14; spec-fix-01; 012, п. 6)** — у всіх чотирьох модулях, рядком над
  кодом: `// Stryker disable next-line <Мутатор>: еквівалентний — <причина>` (один мутатор,
  не `all`). Кожному такому коментарю відповідає рядок класу «еквівалентний» у
  `mutation-analysis.md` з тією самою причиною. Stryker показує такий мутант як `Ignored`,
  у бал він не входить. На `balances` клас «прийнятний» неможливий: інакше `break` 100% не
  пройде.

## 6. Конвеєр і перевірки (крит. 4, 19)

Hook-и в `.husky/` не змінюються: вони викликають `npm run pre-commit|pre-push`.

| Скрипт `package.json` | Зміна |
|---|---|
| `test` | новий: `node scripts/test-all.ts` |
| `test:unit` | + звіт покриття `balances` (розд. 4) |
| `test:cov` | новий: unit + API, покриття, lcov (розд. 4) |
| `coverage` | новий: `npm run test:cov && node scripts/check-coverage.ts coverage/lcov.info` |
| `mutation` | новий: `node scripts/mutation.ts` |
| `check`, `pre-push` | після `test:api` — `&& npm run coverage` |

`test:unit` і `test:api` лишаються в check окремими кроками (C11 — окрема перевірка), хоча
`coverage` проганяє ті самі файли ще раз: це ≈ 1,3 с (звіт `01-clean-clone-check` лаби 2).

checks.md 0.5: нові **C13** (пороги на файл, unit + API на `memory`; check, pre-push),
**C14** (`npm test`; вручну, звіт) і **C15** (`npm run mutation`; вручну, звіти «до»/«після»).
`npm test` і мутації в hook-и не входять: перший потребує Docker, другі тривають хвилини
(007, п. 9; 010, п. 5). C10 отримує сценарій 09, а звіти всіх сценаріїв 01–09 пишуться в
`reports/` лаби 3 (012, п. 3). C6, C8, C11, C12 не змінюються. `.stryker-tmp/` додається в
`.gitignore` і `ignores` ESLint; HTML Stryker, lcov і лог E2E лежать у `coverage/`, яку C3
уже забороняє.

## 7. Стандарти, ADR, README, DEFENSE (крит. 18–21)

DoD 0.3 (крит. 18) і checks.md 0.5 (крит. 19) приймаються окремими комітами до першого
коміту реалізації. ADR (крит. 20): Stryker і запуск тестів під ним (з checker); вбудоване
покриття з порогами на файл; оркестрація `npm test` і рівні тестів. README: рядок лаби 3 →
DEFENSE (крит. 21), нові команди, виправлений опис `test:unit`, три пакети Stryker з
«навіщо», Docker для `npm test`, `test/e2e/`, покриття в pre-push. DEFENSE §5 (пише автор)
спирається на звіти мутацій і `mutation-analysis.md`, §4 — на `npm-test.txt`.

## 8. Порядок реалізації

1. Stryker (конфіги з checker, `mutation.ts`, залежності, README) → `npm run mutation --
   before` **на тестах лаби 2** (крит. 13, 14, 16). Якщо спершу дописати unit-тести
   `balances`, вижилих там може не лишитися, і звіт «до» не буде ненульовим.
2. `mutation-analysis.md` — класифікація вижилих (крит. 15).
3. Коміти `test: …` для топ-3 (крит. 17). Решта тестів `balances`, серед них «платник поза
   списком учасників» (рядок 42), і `node:coverage ignore` над рядком 55 — після прийняття
   spec-fix-01 (крит. 2–3). `Stryker disable` для еквівалентних (крит. 14). Баг → спершу
   червоний тест, потім фікс.
4. Покриття: `test:unit`, `test:cov`, `check-coverage.ts`, `coverage` у check і pre-push,
   сценарій demo 09 (крит. 2–5). Лише коли пороги вже виконуються, інакше pre-push заблокує
   власні коміти.
5. `run-db.ts`, `test-all.ts`, `level-summary.ts`, E2E (крит. 1, 6–12).
6. `npm run mutation -- after`, `npm test -- --report`, `npm run demo`.

## 9. Розкладка файлів

```
package.json                     скрипти (розд. 6), devDependencies Stryker
stryker.config.js                Stryker: база + money, trips/domain, trips/service
stryker.balances.config.js       Stryker: balances, break 100
.gitignore, eslint.config.js     + .stryker-tmp/
README.md                        розд. 7
scripts/test-all.ts              npm test (розд. 2)
scripts/run-db.ts                run_<id> і env інтеграційних — спільне з test-db.ts
scripts/test-db.ts               C12 на run-db.ts
scripts/check-coverage.ts        C13: пороги на файл за BRF/BRH
scripts/level-summary.ts         репортер node:test: підсумок за рівнями
scripts/mutation.ts              npm run mutation, звіти before/after
scripts/demo-guards.ts           + сценарій 09; звіти 01–09 → reports/ лаби 3
test/unit/balances.test.ts       balances: повне покриття (крит. 2), з domain.test.ts
test/unit/*.test.ts              тести-підсилення (крит. 17)
test/e2e/client.ts               fetch-клієнт, newUser()
test/e2e/{journey,access,idempotency,version}.test.ts
src/modules/**                   Stryker disable, node:coverage ignore (balances:55), фікси
docs/specs/lab3-testing/reports/ npm-test.txt, mutation-{before,after}.txt,
                                 mutation-analysis.md, 01–09 (demo)
coverage/                        lcov.info, mutation/*.html, e2e-app.log — не в репо
```

## 10. Непідтверджені припущення (перевіряє перший сеанс реалізації)

- П1. tap-runner із типовими `nodeArgs` запускає `.ts` через type stripping без `tsx`, а хук
  `-r {{hookFile}}` працює в ESM-проєкті. Перевірка:
  `npx stryker run stryker.balances.config.js --dryRunOnly --logLevel debug`.
- П2. Код після інструментації Stryker 10 (`// @ts-nocheck`, перемикачі мутантів) лишається
  стираним TS, і Node його приймає. Перевірка — той самий dry run і звичайний запуск.
- П3. tap-runner правильно читає TAP `node:test` із вкладеними `describe` і `{ skip }`;
  паралельні воркери не конфліктують між собою.
- П4. Як tap-runner показує статичні мутанти, що виконуються під час імпорту (`MAX_AMOUNT`,
  `ZERO`, `IDEMPOTENCY_*`): документація каже, що він їх не розпізнає. Видно у звіті «до».
- П5. `@stryker-mutator/typescript-checker` 10.1.1 працює з `tsconfig.json`: TypeScript ~6.0
  (peer `>=3.6`, 6.0 не перевірено), імпорти `.ts` через `rewriteRelativeImportExtensions`
  при `noEmit`, `erasableSyntaxOnly`, `include` з `scripts/` і `test/`. Перевірка: на першому
  запуску checker стартує без помилок, а `CompileError` — в окремих мутантів, не в усіх.
- П6. `--test-reporter-destination=coverage/lcov.info` сам створює `coverage/`; репортер
  `./scripts/level-summary.ts` завантажується як `.ts` і отримує `data.file`.
- П7. Unit-тести не залежать від `STORAGE` і проходять в одному запуску з інтеграційними.
- П8. `npm run mutation` триває прийнятно (оцінка — 300–400 мутантів); виміряти.
