import base from './vitest.config.mts';
// 実API評価専用（明示したときだけ実行）
export default { ...base, test: { ...base.test, include: ['evaluations/hackathon_audit/*.eval.ts'], testTimeout: 300000 } };
