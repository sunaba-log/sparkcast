import base from './vitest.config.mts';
// 実モデル評価専用。通常の評価（*.test.ts）とは分け、明示したときだけ実行する
export default { ...base, test: { ...base.test, include: ['evaluations/ai_security/*.eval.ts'] } };
