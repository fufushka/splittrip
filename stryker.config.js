// Мутаційне тестування, базовий запуск: money, trips/domain, trips/service без порогу break
// (spec лаби 3, крит. 13; ADR-0022; architecture.md лаби 3, розд. 5). Запуск — `npm run mutation`.
export default {
  mutate: [
    'src/modules/money/index.ts',
    'src/modules/trips/domain.ts',
    'src/modules/trips/service.ts',
  ],
  // `.ts` виконує сам Node 24 (type stripping), без buildCommand і tsx; nodeArgs типові:
  // `--test-reporter=tap -r {{hookFile}} {{testFile}}`. postgres.test.ts на memory пропускається.
  testRunner: 'tap',
  tap: { testFiles: ['test/unit/*.test.ts', 'test/api/*.test.ts'] },
  coverageAnalysis: 'perTest',
  // Мутант, якого відхилив би tsc (C5), — CompileError і в бал не входить.
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',
  reporters: ['clear-text', 'html'],
  // Вивід без кольору: NO_COLOR логер Stryker 10 не вимикає, лише allowConsoleColors.
  allowConsoleColors: false,
  clearTextReporter: { allowColor: false },
  htmlReporter: { fileName: 'coverage/mutation/domain.html' },
  thresholds: { break: null },
  tempDirName: '.stryker-tmp',
  cleanTempDir: 'always',
};
