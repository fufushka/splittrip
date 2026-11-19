// Межі модулів з architecture.md лаби 2, розд. 2 (ADR-0006). Номери правил — звідти.
const MODULE = '^src/modules/';
const UNKNOWN_MODULE = `${MODULE}(?!(money|balances|trips|system|http|context|auth|idempotency|storage|ids)/)`;
const EXTERNAL = [
  'core',
  'npm',
  'npm-dev',
  'npm-optional',
  'npm-peer',
  'npm-no-pkg',
  'npm-unknown',
];

/** Правило 1: модуль може залежати лише від себе й дозволених модулів. */
function onlyAllowed(name, allowed) {
  return {
    name: `direction-${name}`,
    comment: `${name} може імпортувати лише: ${allowed.join(', ') || 'нічого'} (правило 1)`,
    severity: 'error',
    from: { path: `${MODULE}${name}/` },
    to: { path: MODULE, pathNot: `${MODULE}(${[name, ...allowed].join('|')})/` },
  };
}

module.exports = {
  forbidden: [
    onlyAllowed('money', []),
    onlyAllowed('ids', []),
    onlyAllowed('balances', ['money']),
    onlyAllowed('context', []),
    onlyAllowed('trips', ['balances', 'money', 'context', 'ids']),
    onlyAllowed('idempotency', ['context']),
    onlyAllowed('auth', ['context']),
    onlyAllowed('storage', ['trips', 'idempotency', 'money', 'context', 'ids']),
    onlyAllowed('system', []),
    onlyAllowed('http', ['trips', 'auth', 'context', 'idempotency', 'system', 'ids']),
    {
      name: 'unknown-module',
      comment: 'Модулі — лише ті, що описані в architecture.md (крит. 9)',
      severity: 'error',
      from: { path: UNKNOWN_MODULE },
      to: {},
    },
    {
      name: 'to-unknown-module',
      comment: 'Модулі — лише ті, що описані в architecture.md (крит. 9)',
      severity: 'error',
      from: {},
      to: { path: UNKNOWN_MODULE },
    },
    {
      name: 'public-entry-from-module',
      comment: 'Інший модуль — лише через його index.ts (правило 2)',
      severity: 'error',
      from: { path: `${MODULE}([^/]+)/` },
      to: { path: MODULE, pathNot: [`${MODULE}$1/`, `${MODULE}[^/]+/index\\.ts$`] },
    },
    {
      name: 'public-entry-from-outside',
      comment: 'Ззовні модулів — лише через index.ts (правило 2)',
      severity: 'error',
      from: { pathNot: MODULE },
      to: { path: MODULE, pathNot: `${MODULE}[^/]+/index\\.ts$` },
    },
    {
      name: 'no-circular',
      comment: 'Циклів немає (правило 3)',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'pure-domain',
      comment: 'Доменні модулі не імпортують зовнішні пакети й node:* (правило 4)',
      severity: 'error',
      from: { path: `${MODULE}(money|balances|trips|ids)/` },
      to: { dependencyTypes: EXTERNAL },
    },
    {
      name: 'fastify-only-in-http',
      comment: 'fastify імпортує лише http (правило 3)',
      severity: 'error',
      from: { pathNot: `${MODULE}http/` },
      to: { path: 'node_modules/fastify/' },
    },
    {
      name: 'child-process-only-in-system',
      comment: 'node:child_process імпортує лише system (правило 3)',
      severity: 'error',
      from: { pathNot: `${MODULE}system/` },
      to: { dependencyTypes: ['core'], path: '^(node:)?child_process$' },
    },
    {
      name: 'postgres-only-in-storage',
      comment: 'Драйвер БД імпортує лише storage: SQL і транзакції — лише там (правило 3)',
      severity: 'error',
      from: { path: MODULE, pathNot: `${MODULE}storage/` },
      to: { path: 'node_modules/postgres/' },
    },
    {
      name: 'jose-only-in-auth',
      comment: 'jose імпортує лише auth (правило 3)',
      severity: 'error',
      from: { path: MODULE, pathNot: `${MODULE}auth/` },
      to: { path: 'node_modules/jose/' },
    },
    {
      name: 'async-hooks-only-in-context',
      comment: 'node:async_hooks імпортує лише context (правило 3)',
      severity: 'error',
      from: { path: MODULE, pathNot: `${MODULE}context/` },
      to: { dependencyTypes: ['core'], path: '^(node:)?async_hooks$' },
    },
    {
      name: 'crypto-only-in-idempotency',
      comment: 'node:crypto імпортує лише idempotency (правило 3)',
      severity: 'error',
      from: { path: MODULE, pathNot: `${MODULE}idempotency/` },
      to: { dependencyTypes: ['core'], path: '^(node:)?crypto$' },
    },
    {
      name: 'no-import-main',
      comment: 'Ніхто не імпортує main.ts (правило 1)',
      severity: 'error',
      from: {},
      to: { path: '^src/main\\.ts$' },
    },
    {
      name: 'no-orphans',
      comment: "Файл без зв'язків — ознака модуля поза architecture.md",
      severity: 'error',
      from: { orphan: true, pathNot: '^src/main\\.ts$' },
      to: {},
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-non-package-json',
      comment: 'Лише оголошені в package.json пакети (ADR-0002)',
      severity: 'error',
      from: {},
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
