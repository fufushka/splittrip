// Мутації `balances` з порогом break 100% (spec лаби 3, крит. 14; ADR-0022): поріг Stryker
// один на запуск, тому це окремий запуск на базі stryker.config.js.
import base from './stryker.config.js';

export default {
  ...base,
  mutate: ['src/modules/balances/index.ts'],
  thresholds: { ...base.thresholds, break: 100 },
  htmlReporter: { fileName: 'coverage/mutation/balances.html' },
};
