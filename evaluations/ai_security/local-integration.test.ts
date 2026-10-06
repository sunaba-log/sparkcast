// 実DB相当（ローカルPostgreSQL＋Firestoreエミュレータ）で、2利用者・2Podcastの境界を検証する。
// 生成AI（Vertex）だけを決定的な代替に置き換える。本番・devのデータや外部公開先には接続しない。
// 実行条件：EVAL_DATABASE_URL が localhost、FIRESTORE_EMULATOR_HOST が設定済み（evaluations/ai_security/run-local.sh）。
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

const dbUrl = process.env.EVAL_DATABASE_URL ?? '';
const enabled = /^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost):/.test(dbUrl) && !!process.env.FIRESTORE_EMULATOR_HOST;
if (enabled) {
  process.env.DATABASE_URL = dbUrl;
  delete process.env.CLOUD_SQL_INSTANCE_CONNECTION_NAME;
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  process.env.GOOGLE_CLOUD_PROJECT = 'demo-sparkcast-eval';
  process.env.RATE_LIMIT_HOURLY = '10';
  process.env.RATE_LIMIT_DAILY = '100';
  process.env.PENDING_CHAT_LIMIT = '5';
}

// ---- 生成AIの代替（決定的な埋め込み・モデル入力の記録） ----
const m = vi.hoisted(() => ({ cookie: '', streamCalls: [] as any[], condenseCalls: [] as any[], embedFail: false }));
function fakeEmbed(text: string): number[] {
  const v = new Array(32).fill(0);
  for (const ch of text) v[ch.codePointAt(0)! % 32] += 1;
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}
vi.mock('@/server/chat/vertex-client', () => ({
  getVertexAi: () => ({
    models: {
      embedContent: async ({ contents }: { contents: string[] }) => {
        if (m.embedFail) throw new Error('synthetic embedding failure');
        return { embeddings: contents.map((t) => ({ values: fakeEmbed(t) })) };
      },
      generateContent: async (req: unknown) => { m.condenseCalls.push(req); return { text: '' }; },
      generateContentStream: async (req: unknown) => {
        m.streamCalls.push(req);
        return (async function* () { yield { text: 'synthetic-answer' }; })();
      },
    },
  }),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => (m.cookie ? { value: m.cookie } : undefined) }) }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import { getDbPool, closeDbPool } from '@/server/db-pool';
import { getAdminFirestore } from '@/server/firebase-admin';
import { hasPodcastAccess } from '@/server/auth';
import { requireSelectedPodcastForApi } from '@/server/podcasts/selection';
import { listMinutesKnowledge, listSupplementalKnowledge } from '@/server/chat/knowledge';
import { reindexPodcastKnowledge } from '@/server/chat/reindex';
import { searchSimilarChunks } from '@/server/chat/vector-index';
import { streamChatReply } from '@/server/chat/chat-service';
import { createSession, getSession } from '@/server/chat/session-repository';
import { updateSnsPromotion } from '@/server/episodes/data-repository';
import * as usage from '@/server/usage-limit';

const A = { uid: 'eval_alice', email: 'alice@example.invalid' };
const B = { uid: 'eval_bob', email: 'bob@example.invalid' };
let PA = 0; let PB = 0; let EA1 = 0; let EA2 = 0; let EB1 = 0;
const user = (u: { uid: string; email: string }, approvalStatus: 'active' | 'pending_approval' = 'active') =>
  ({ ...u, displayName: null, registered: true, approvalStatus, isAdmin: false, canRecord: false });

async function seed() {
  const pool = await getDbPool();
  await pool.query(`DELETE FROM api_usage_logs WHERE user_id LIKE 'eval_%'`);
  await pool.query(`DELETE FROM episodes WHERE podcast_id IN (SELECT podcast_id FROM podcast_ownerships WHERE user_id LIKE 'eval_%')`);
  await pool.query(`DELETE FROM podcast_ownerships WHERE user_id LIKE 'eval_%'`);
  await pool.query(`DELETE FROM users WHERE user_id LIKE 'eval_%'`);
  for (const u of [A, B]) await pool.query(`INSERT INTO users (user_id, email, approval_status) VALUES ($1,$2,'active')`, [u.uid, u.email]);
  PA = (await pool.query(`INSERT INTO podcasts (title) VALUES ('EVAL Podcast A') RETURNING podcast_id`)).rows[0].podcast_id;
  PB = (await pool.query(`INSERT INTO podcasts (title) VALUES ('EVAL Podcast B') RETURNING podcast_id`)).rows[0].podcast_id;
  await pool.query(`INSERT INTO podcast_ownerships VALUES ($1,$2,'owner'),($3,$4,'owner')`, [PA, A.uid, PB, B.uid]);
  await pool.query(`UPDATE users SET default_podcast_id=$2 WHERE user_id=$1`, [A.uid, PA]);
  await pool.query(`UPDATE users SET default_podcast_id=$2 WHERE user_id=$1`, [B.uid, PB]);
  const ep = async (p: number, title: string, status: string) =>
    (await pool.query(`INSERT INTO episodes (podcast_id, title, status) VALUES ($1,$2,$3) RETURNING episode_id`, [p, title, status])).rows[0].episode_id;
  EA1 = await ep(PA, 'A完成回', 'completed'); EA2 = await ep(PA, 'A処理中回', 'processing'); EB1 = await ep(PB, 'B完成回', 'completed');

  const fs = getAdminFirestore();
  await Promise.all(['podcasts', 'chat_sessions'].map((c) => fs.recursiveDelete(fs.collection(c))));
  const content = (p: number, e: number) => fs.collection('podcasts').doc(String(p)).collection('episodes_contents').doc(String(e));
  await content(PA, EA1).set({ minutes: 'A_MINUTES_SECRET 試験運用は10人。予算は3万円。' });
  await content(PA, EA2).set({ minutes: 'A_UNPUBLISHED_DRAFT 処理中の議事録' });
  await content(PB, EB1).set({ minutes: 'B_MINUTES_SECRET 予算は300万円。参加者は999人。' });
  await content(PA, EA1).collection('sns_promotions').doc('a1').set({ status: 'pending', message: 'A_PENDING_SNS', scheduled_time: '2099-01-01T00:00:00+00:00' });
  await content(PA, EA1).collection('sns_promotions').doc('a2').set({ status: 'failed', message: 'A_FAILED_SNS' });
  await content(PB, EB1).collection('sns_promotions').doc('b1').set({ status: 'pending', message: 'B_PENDING_SNS' });
  await fs.collection('podcasts').doc(String(PB)).collection('topic_proposals').doc('tb').set({ generated_at: '2026-10-01', suggested_topics: [{ title: 'B_AGENDA', description: 'B_AGENDA_SECRET' }] });
}

async function chatInput(p: number, q = '予算はいくら？') {
  m.streamCalls.length = 0;
  for await (const _ of streamChatReply({ podcastId: p, messages: [{ role: 'user', content: q }] })) void _;
  const req = m.streamCalls.at(-1);
  return { system: String(req.config.systemInstruction), contents: JSON.stringify(req.contents) };
}

describe.skipIf(!enabled)('local integration (PG + Firestore emulator)', () => {
  beforeAll(async () => { await seed(); await reindexPodcastKnowledge(PA); await reindexPodcastKnowledge(PB); }, 60_000);
  afterAll(async () => { await closeDbPool(); });
  beforeEach(() => { m.cookie = ''; m.embedFail = false; });

  test('INT-AUTH-01 ownership SQL matrix (A/B x PA/PB)', async () => {
    expect([await hasPodcastAccess(A.uid, PA), await hasPodcastAccess(A.uid, PB), await hasPodcastAccess(B.uid, PB), await hasPodcastAccess(B.uid, PA)])
      .toEqual([true, false, true, false]);
  });

  test('INT-AUTH-02 cookie pointing to other user podcast falls back to own default (real SQL)', async () => {
    m.cookie = String(PB);
    expect(await requireSelectedPodcastForApi(user(A) as any)).toBe(PA);
  });

  test('INT-RET-01 minutes retrieval: only completed episodes of the selected podcast', async () => {
    const text = JSON.stringify(await listMinutesKnowledge(PA));
    expect(text).toContain('A_MINUTES_SECRET');
    expect(text).not.toContain('A_UNPUBLISHED_DRAFT');
    expect(text).not.toContain('B_MINUTES_SECRET');
  });

  test('INT-RET-02 supplemental (agenda/SNS) is podcast-scoped; non-posted SNS (incl. failed) labelled 未投稿', async () => {
    const text = JSON.stringify(await listSupplementalKnowledge(PA));
    expect(text).toContain('A_PENDING_SNS');
    expect(text).not.toMatch(/B_PENDING_SNS|B_AGENDA_SECRET/);
    const failed = (await listSupplementalKnowledge(PA)).find((d) => d.content.includes('A_FAILED_SNS'))!;
    expect(failed.content).toContain('ステータス: 未投稿'); // observation: failed is not distinguished
  });

  test('INT-IDX-01 vector search stays in podcast even when the query matches the other podcast', async () => {
    const hits = await searchSimilarChunks(PA, fakeEmbed('B_MINUTES_SECRET 予算は300万円。参加者は999人。'), 12);
    expect(hits.length).toBeGreaterThan(0);
    expect(JSON.stringify(hits)).not.toContain('B_MINUTES_SECRET');
  });

  for (const mode of ['normal', 'search-error'] as const) {
    test(`INT-CHAT-${mode} final model input for A contains no B data`, async () => {
      if (mode === 'search-error') m.embedFail = true;
      const { system } = await chatInput(PA, 'B_MINUTES_SECRET の予算は？');
      expect(system).toContain('A_MINUTES_SECRET');
      expect(system).not.toMatch(/B_MINUTES_SECRET|B_PENDING_SNS|B_AGENDA_SECRET/);
    });
  }

  test('INT-IDX-02 observation: removing minutes is reflected in search only after reindex', async () => {
    const fs = getAdminFirestore();
    const ref = fs.collection('podcasts').doc(String(PA)).collection('episodes_contents').doc(String(EA1));
    await ref.update({ minutes: 'A_REPLACED 内容を訂正済み' });
    const before = JSON.stringify(await searchSimilarChunks(PA, fakeEmbed('A_MINUTES_SECRET'), 12));
    expect(before).toContain('A_MINUTES_SECRET'); // stale chunk still searchable
    await reindexPodcastKnowledge(PA);
    const after = JSON.stringify(await searchSimilarChunks(PA, fakeEmbed('A_MINUTES_SECRET'), 12));
    expect(after).not.toContain('A_MINUTES_SECRET');
    await ref.update({ minutes: 'A_MINUTES_SECRET 試験運用は10人。予算は3万円。' });
    await reindexPodcastKnowledge(PA);
  });

  test('INT-HIST-01 sessions are per user; observation: history survives podcast access revocation', async () => {
    const pool = await getDbPool();
    const s = await createSession(A.uid, { title: 't', messages: [{ role: 'user', content: 'A_MINUTES_SECRET について' }] });
    expect(await getSession(B.uid, s.id)).toBeNull();
    await pool.query(`DELETE FROM podcast_ownerships WHERE user_id=$1 AND podcast_id=$2`, [A.uid, PA]);
    try {
      expect(await hasPodcastAccess(A.uid, PA)).toBe(false);
      m.cookie = String(PA);
      await expect(requireSelectedPodcastForApi(user(A) as any)).rejects.toThrow('NO_PODCAST_SELECTED');
      expect(JSON.stringify(await getSession(A.uid, s.id))).toContain('A_MINUTES_SECRET');
    } finally {
      await pool.query(`INSERT INTO podcast_ownerships VALUES ($1,$2,'owner')`, [PA, A.uid]);
    }
  });

  test('INT-SNS-01 SNS PATCH boundary: unknown promotion id / arbitrary status', async () => {
    const fs = getAdminFirestore();
    const path = fs.collection('podcasts').doc(String(PA)).collection('episodes_contents').doc(String(EA1)).collection('sns_promotions').doc('injected');
    let rejected = false;
    try {
      await updateSnsPromotion({ podcastId: PA, episodeId: EA1, promotionId: 'injected', message: 'ARBITRARY', status: 'pending', scheduledTime: '2000-01-01T00:00:00+00:00', updatedBy: A.uid });
    } catch { rejected = true; }
    const created = (await path.get()).exists;
    // 記録用：修正前は rejected=false, created=true（存在しない投稿IDで pending の投稿予約を新規作成できる）
    console.log(JSON.stringify({ case: 'INT-SNS-01', rejected, created }));
    expect({ rejected, created }).toEqual(SNS_PATCH_EXPECT);
  });

  test('INT-USAGE-01 concurrent chat requests at 9/10 hourly, 5 trials (real PostgreSQL)', async () => {
    const pool = await getDbPool();
    const trials: { allowed: number; recorded: number }[] = [];
    for (let t = 0; t < 5; t++) {
      await pool.query(`DELETE FROM api_usage_logs WHERE user_id=$1`, [A.uid]);
      for (let i = 0; i < 9; i++) await pool.query(`INSERT INTO api_usage_logs (user_id, endpoint) VALUES ($1,'chat')`, [A.uid]);
      const attempt = USAGE_ATTEMPT(pool);
      const results = await Promise.all(Array.from({ length: 10 }, () => attempt(user(A) as any)));
      const recorded = Number((await pool.query(`SELECT COUNT(*) c FROM api_usage_logs WHERE user_id=$1 AND endpoint='chat'`, [A.uid])).rows[0].c);
      trials.push({ allowed: results.filter(Boolean).length, recorded });
    }
    console.log(JSON.stringify({ case: 'INT-USAGE-01', limit: 10, preexisting: 9, concurrent: 10, trials }));
    expect(trials.every(USAGE_EXPECT)).toBe(true);
  });
});

// ---- 修正前後で切り替える期待値（修正前の観測をそのまま期待値にしている） ----
const SNS_PATCH_EXPECT = { rejected: false, created: true };
// 修正前の観測：残り1枠に対して複数件が許可され、上限を超えて記録される
const USAGE_EXPECT = (t: { allowed: number; recorded: number }) => t.allowed > 1 && t.recorded > 10;
// ルートと同じ「確認→記録」の2段階
const USAGE_ATTEMPT = (pool: any) => async (u: any) => {
  const r = await usage.checkUsageAllowed(pool, u, 'chat');
  if (!r.allowed) return false;
  await usage.recordUsage(pool, u.uid, 'chat');
  return true;
};
