// 検証2・3（実API）：UI と同じ範囲提案（suggestPolicyEdits、Gemini）を、audio 段階の handoff.json に対して実行する。
// 実行：EVAL_ALLOW_REAL_API=1 GOOGLE_CLOUD_PROJECT=sunabalog-dev EVAL_RUN_DIR=<audio段階の出力> \
//   ./apps/ui/node_modules/.bin/vitest run --config evaluations/hackathon_audit/vitest.real.config.mts
// 配線確認：EVAL_DRY_RUN=1 EVAL_RUN_DIR=<dry-runの出力> で同じコマンド（モデルを呼ばない）
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';

const DRY = process.env.EVAL_DRY_RUN === '1';
const REAL_OK = process.env.EVAL_ALLOW_REAL_API === '1' && process.env.GOOGLE_CLOUD_PROJECT === 'sunabalog-dev';
const RUN = process.env.EVAL_RUN_DIR ?? '';
const calls: any[] = [];

vi.mock('@/server/chat/vertex-client', async (orig) => {
  const real = (await orig()) as any;
  return {
    getVertexAi: () => ({
      models: {
        generateContent: async (req: any) => {
          const t0 = Date.now();
          let res: any;
          if (DRY) {
            const { findings, words } = JSON.parse(req.contents);
            const ids = words.filter((w: any) => /スイレン|742|睡蓮/.test(w.text)).map((w: any) => w.wordId);
            res = { text: JSON.stringify({ proposals: findings.map((f: any, i: number) => ({ findingIds: [f.id], wordIds: [...new Set([...(f.wordIds ?? []), ...(f.wordIds?.length ? [] : ids.length ? ids : f.contextWordIds.slice(0, 1))])], action: 'silence', reason: 'dry-run', script: '' })) }), usageMetadata: null };
          } else {
            res = await real.getVertexAi().models.generateContent(req);
          }
          calls.push({ api: 'gemini.generateContent(suggestPolicyEdits)', model: req.model, ms: Date.now() - t0, usage: res.usageMetadata ?? null });
          return res;
        },
      },
    }),
  };
});

import { suggestPolicyEdits } from '@/server/policy/suggestions';
import { getVertexAiModel } from '@/server/env';

test.skipIf(!RUN || (!DRY && !REAL_OK))('suggestPolicyEdits on real STT words', async () => {
  const { findings, words } = JSON.parse(readFileSync(`${RUN}/handoff.json`, 'utf8'));
  let proposals: any[] = [];
  let error: string | null = null;
  try { proposals = await suggestPolicyEdits(findings, words); } catch (e) { error = String(e); }
  const byId = new Map(words.map((w: any) => [w.wordId, w]));
  const rows = proposals.map((p) => ({
    findingIds: p.findingIds, action: p.action, start: p.start, end: p.end, script: p.script, reason: p.reason,
    rangeText: words.filter((w: any) => w.start >= p.start - 1e-6 && w.end <= p.end + 1e-6).map((w: any) => w.text).join(''),
  }));
  writeFileSync(`${RUN}/proposals.json`, JSON.stringify({ dryRun: DRY, model: getVertexAiModel(), error, calls, proposals: rows, wordCount: byId.size }, null, 1));
  console.log(JSON.stringify({ proposals: rows.length, error, calls: calls.length }));
  expect(true).toBe(true);
});
