// 検証1・2・4（UI/API 側）：承認・公開の状態遷移、編集後データの再混入、他番組IDへの差し替え。
// [エミュレータ] ローカル PostgreSQL 16（apps/ui/migrations 適用）＋ Firestore エミュレータ。
// 差し替え：ログイン利用者（getSessionUser）、GCS（メタデータ・署名URL）、音声処理サービス、Cloud Run ジョブ起動（記録のみ）。
// 実際のジョブ起動・公開・外部送信は行わない。実行：evaluations/hackathon_audit/run-ui.sh
import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';

const dbUrl = process.env.EVAL_DATABASE_URL ?? '';
const enabled = /@(127\.0\.0\.1|localhost):/.test(dbUrl) && !!process.env.FIRESTORE_EMULATOR_HOST;
if (enabled) {
  process.env.DATABASE_URL = dbUrl;
  delete process.env.CLOUD_SQL_INSTANCE_CONNECTION_NAME;
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  process.env.GOOGLE_CLOUD_PROJECT = 'demo-sparkcast-audit-eval';
  process.env.GCS_UPLOAD_BUCKET = 'eval-upload';
  process.env.POLICY_AUDIO_BUCKET = 'eval-policy-audio';
  process.env.NEXT_PUBLIC_ENABLE_LOCAL_UI_DEMO = 'false';
}

const m = vi.hoisted(() => ({
  user: null as any,
  cookie: '',
  jobs: [] as any[],
  objects: new Map<string, { data: Buffer; generation: number }>(),
}));
vi.mock('@/server/auth', async (orig) => ({ ...(await orig<any>()), getSessionUser: async () => m.user }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => (m.cookie ? { value: m.cookie } : undefined) }) }));
vi.mock('@/server/episodes/automator-jobs', () => ({
  runAutomatorJob: async (input: any) => { m.jobs.push(input); return { executionName: `exec-${m.jobs.length}` }; },
}));
vi.mock('@/server/policy/media', () => ({
  processPolicyMedia: async (data: any) => ({ audioBase64: Buffer.from(`wav:${data.script ?? data.operation}`).toString('base64'), durationMs: 500, transcript: data.script ?? '' }),
}));
vi.mock('@/server/storage', () => {
  const file = (bucket: string, path: string) => ({
    getMetadata: async () => {
      const o = m.objects.get(`${bucket}/${path}`);
      if (!o) throw new Error('No such object');
      return [{ md5Hash: createHash('md5').update(o.data).digest('base64'), generation: String(o.generation) }];
    },
    download: async () => [m.objects.get(`${bucket}/${path}`)!.data],
    save: async (data: Buffer) => { m.objects.set(`${bucket}/${path}`, { data, generation: Date.now() }); },
    getSignedUrl: async () => [`https://signed.invalid/${bucket}/${path}`],
  });
  return {
    getStorage: () => ({ bucket: (b: string) => ({ file: (p: string) => file(b, p) }) }),
    createAudioPreviewUrl: async (p: string) => `https://signed.invalid/preview/${p}`,
    createAudioUploadUrl: async () => 'https://signed.invalid/upload',
  };
});

import { getDbPool, closeDbPool } from '@/server/db-pool';
import { getAdminFirestore } from '@/server/firebase-admin';
import * as applyRoute from '@/app/api/episodes/[id]/apply-interventions/route';
import * as retryRoute from '@/app/api/episodes/[id]/retry-audit/route';
import * as originalRoute from '@/app/api/episodes/[id]/confirm-original-publish/route';
import * as reviewRoute from '@/app/api/episodes/[id]/policy-review/route';
import * as legacyReviewRoute from '@/app/api/episodes/[id]/review-policy-findings/route';
import * as interventionsRoute from '@/app/api/episodes/[id]/interventions/route';
import * as findingsRoute from '@/app/api/episodes/[id]/policy-findings/route';
import * as audioRoute from '@/app/api/episodes/[id]/policy-audio/route';
import * as sourceRoute from '@/app/api/episodes/[id]/source-audio/route';
import * as transcriptRoute from '@/app/api/episodes/[id]/transcript/route';
import { listMinutesKnowledge } from '@/server/chat/knowledge';

const SECRET = 'スイレン742';
const A = { uid: 'eval_alice', email: 'alice@example.invalid' };
const B = { uid: 'eval_bob', email: 'bob@example.invalid' };
const ids = { PA: 0, PB: 0, EA: 0, EB: 0 };
const RESULTS: any[] = [];
const user = (u: typeof A) => ({ ...u, displayName: null, registered: true, approvalStatus: 'active', isAdmin: false, canRecord: true });
const md5hex = (b: Buffer) => createHash('md5').update(b).digest('hex');

async function seed(opts: { interventions?: boolean; findings?: boolean } = {}) {
  const { interventions = true, findings = true } = opts;
  const pool = await getDbPool();
  await pool.query(`DELETE FROM episodes WHERE podcast_id IN (SELECT podcast_id FROM podcast_ownerships WHERE user_id LIKE 'eval_%')`);
  await pool.query(`DELETE FROM podcast_ownerships WHERE user_id LIKE 'eval_%'`);
  await pool.query(`DELETE FROM users WHERE user_id LIKE 'eval_%'`);
  for (const u of [A, B]) await pool.query(`INSERT INTO users (user_id, email, approval_status) VALUES ($1,$2,'active')`, [u.uid, u.email]);
  ids.PA = (await pool.query(`INSERT INTO podcasts (title) VALUES ('EVAL A') RETURNING podcast_id`)).rows[0].podcast_id;
  ids.PB = (await pool.query(`INSERT INTO podcasts (title) VALUES ('EVAL B') RETURNING podcast_id`)).rows[0].podcast_id;
  await pool.query(`INSERT INTO podcast_ownerships VALUES ($1,$2,'owner'),($3,$4,'owner')`, [ids.PA, A.uid, ids.PB, B.uid]);
  await pool.query(`UPDATE users SET default_podcast_id=$2 WHERE user_id=$1`, [A.uid, ids.PA]);
  await pool.query(`UPDATE users SET default_podcast_id=$2 WHERE user_id=$1`, [B.uid, ids.PB]);
  const fs = getAdminFirestore();
  await fs.recursiveDelete(fs.collection('podcasts'));
  m.objects.clear();
  for (const [p, key, tag] of [[ids.PA, 'EA', 'A'], [ids.PB, 'EB', 'B']] as const) {
    const eid = (await pool.query(`INSERT INTO episodes (podcast_id, title, status) VALUES ($1,$2,'awaiting_approval') RETURNING episode_id`, [p, `${tag} episode`])).rows[0].episode_id;
    (ids as any)[key] = eid;
    const path = `podcasts/${p}/episodes/${eid}/source/${tag}.mp3`;
    await pool.query(`UPDATE episodes SET source_audio_path=$3 WHERE podcast_id=$1 AND episode_id=$2`, [p, eid, path]);
    const audio = Buffer.from(`synthetic-audio-${tag}`);
    m.objects.set(`eval-upload/${path}`, { data: audio, generation: 1 });
    const root = fs.collection('podcasts').doc(String(p)).collection('episodes_contents').doc(String(eid));
    await root.set({ minutes: `${tag}_MINUTES 案件コードは${SECRET}です。`, transcript_summary: `${tag}_SUMMARY`, transcript_meta: { source_md5: md5hex(audio) } });
    await root.collection('transcripts').doc('seg_00001').set({
      chunk_id: 'seg_00001', start_time: 0, end_time: 3, speaker: '話者A', text: `${tag}_TRANSCRIPT 案件コードは${SECRET}です。`,
      words: [{ text: '案件コードは', start: 0, end: 1 }, { text: SECRET, start: 1, end: 2 }, { text: 'です。', start: 2, end: 3 }],
    });
    if (findings)
      await root.collection('policy_findings').doc(`f_${tag}`).set({
        chunk_id: 'seg_00001', category: 'confidential_information', source: 'presidio', start_ms: 1000, end_ms: 2000,
        text: `案件コードは${SECRET}です。`, evidence_text: SECRET, range_precision: 'word', status: 'pending',
      });
    if (interventions)
      await root.collection('director_interventions').doc(`i_${tag}`).set({
        chunk_id: 'seg_00001', insert_timestamp_ms: 3000, target_speaker: '話者A', correction_script: `${tag}の訂正です。`,
        audit_metrics: { score: 4, choice: 'numerical_data' }, status: 'pending',
      });
  }
  m.jobs.length = 0;
}

const call = async (route: any, method: 'GET' | 'POST', id: number, body?: unknown, query = '') => {
  const req = new Request(`http://localhost/api/episodes/${id}${query}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  const res = await route[method](req, { params: Promise.resolve({ id: String(id) }) });
  let json: any = null;
  try { json = await res.clone().json(); } catch { /* redirect */ }
  return { status: res.status, json, location: res.headers.get('location') };
};
const status = async (p: number, e: number) => (await (await getDbPool()).query(`SELECT status FROM episodes WHERE podcast_id=$1 AND episode_id=$2`, [p, e])).rows[0]?.status;
async function snapshot(p: number) {
  const docs: Record<string, unknown> = {};
  const walk = async (ref: FirebaseFirestore.DocumentReference) => {
    const s = await ref.get(); if (s.exists) docs[ref.path] = s.data();
    for (const c of await ref.listCollections()) for (const d of (await c.get()).docs) await walk(d.ref);
  };
  await walk(getAdminFirestore().collection('podcasts').doc(String(p)));
  const rows = (await (await getDbPool()).query(`SELECT episode_id, status, title, description FROM episodes WHERE podcast_id=$1 ORDER BY episode_id`, [p])).rows;
  return JSON.stringify({ docs, rows });
}
async function openReview(id = ids.EA) {
  const r = await call(reviewRoute, 'GET', id);
  return r.json;
}
const record = (row: any) => { RESULTS.push(row); console.log(JSON.stringify(row)); };

describe.skipIf(!enabled)('hackathon audit: UI/API boundary (emulator)', () => {
  beforeEach(async () => { await seed(); m.user = user(A); m.cookie = ''; });
  afterAll(async () => {
    const out = process.env.EVIDENCE_DIR;
    if (out) (await import('node:fs')).writeFileSync(`${out}/ui-boundary-observations.json`, JSON.stringify(RESULTS, null, 1));
    await closeDbPool();
  });

  // ---- 修正後（I-01〜I-05）の確認。修正前の観測は evidence/before/ui-boundary-observations.json ----
  const setStatus = (st: string, staleHours = 0) => getDbPool().then((pool) => pool.query(`UPDATE episodes SET status=$3, updated_at=now() - ($4 || ' hours')::interval WHERE podcast_id=$1 AND episode_id=$2`, [ids.PA, ids.EA, st, String(staleHours)]));
  const rejectIntervention = () => call(interventionsRoute, 'POST', ids.EA, { interventions: [{ id: 'i_A', correctionScript: 'Aの訂正です。', status: 'rejected' }] });
  const saveProposals = async (statusValue: 'approved' | 'rejected') => {
    const review = await openReview();
    return call(reviewRoute, 'POST', ids.EA, { operation: 'save', version: review.version, proposals: review.proposals.map((p: any) => ({ ...p, status: statusValue, action: 'cut', rangeConfirmed: true })) });
  };

  test('V1-UI-01 (I-03) retry-audit only from failed / awaiting states or a stuck job', async () => {
    const out: Record<string, unknown> = {};
    for (const [st, stale] of [['failed', 0], ['awaiting_approval', 0], ['awaiting_publish_confirmation', 0], ['completed', 0], ['editing', 0], ['auditing', 0], ['editing', 8]] as const) {
      await setStatus(st, stale);
      m.jobs.length = 0;
      const r = await call(retryRoute, 'POST', ids.EA);
      out[`${st}${stale ? `(${stale}h stale)` : ''}`] = { http: r.status, after: await status(ids.PA, ids.EA), jobs: m.jobs.length };
    }
    record({ case: 'V1-UI-01', result: out });
    const ok = (k: string) => (out[k] as any).http === 200 && (out[k] as any).jobs === 1;
    const refused = (k: string, st: string) => (out[k] as any).http === 409 && (out[k] as any).jobs === 0 && (out[k] as any).after === st;
    expect(ok('failed') && ok('awaiting_approval') && ok('awaiting_publish_confirmation') && ok('editing(8h stale)')).toBe(true);
    expect(refused('completed', 'completed') && refused('editing', 'editing') && refused('auditing', 'auditing')).toBe(true);
  });

  test('V1-UI-08 (I-01) rejecting every item reaches publish confirmation and publishes the original once', async () => {
    const r1 = await saveProposals('rejected');
    const r2 = await rejectIntervention();
    const st = await status(ids.PA, ids.EA);
    const p = await call(originalRoute, 'POST', ids.EA);
    record({ case: 'V1-UI-08', saveProposals: [r1.status, r1.json?.status], rejectIntervention: [r2.status, r2.json?.status], status: st, publish: p.status, jobs: m.jobs });
    expect(st).toBe('awaiting_publish_confirmation');
    expect(p.status).toBe(200);
    expect(m.jobs).toEqual([expect.objectContaining({ publishOriginal: true })]);
  });

  test('V1-UI-02 (I-05) legacy route cannot reach original publication while an intervention is undecided', async () => {
    const r1 = await call(legacyReviewRoute, 'POST', ids.EA, { findings: [{ id: 'f_A', status: 'rejected' }] });
    const s1 = await status(ids.PA, ids.EA);
    const p = await call(originalRoute, 'POST', ids.EA);
    await setStatus('awaiting_publish_confirmation'); // 状態を直接変えても、公開直前の判定で止まる
    const forced = await call(originalRoute, 'POST', ids.EA);
    record({ case: 'V1-UI-02', legacy: [r1.status, r1.json?.status], statusAfter: s1, publish: p.status, publishWithForcedStatus: [forced.status, forced.json?.error], jobs: m.jobs.length });
    expect(s1).toBe('awaiting_approval');
    expect([p.status, forced.status]).toEqual([409, 409]);
    expect(m.jobs.length).toBe(0);
  });

  test('V1-UI-03 (I-04) the order of decisions does not matter', async () => {
    const r1 = await rejectIntervention();
    const r2 = await saveProposals('rejected');
    record({ case: 'V1-UI-03', interventionsFirst: r1.json?.status, thenProposals: r2.json?.status });
    expect(r1.json?.status).toBe('awaiting_approval');
    expect(r2.json?.status).toBe('awaiting_publish_confirmation');
  });

  test('V1-UI-04 (I-04) fact-check interventions only: rejecting all leads to publish confirmation', async () => {
    await seed({ findings: false });
    m.user = user(A);
    await openReview();
    const r = await rejectIntervention();
    const p = await call(originalRoute, 'POST', ids.EA);
    record({ case: 'V1-UI-04', reject: r.json?.status, publish: p.status, jobs: m.jobs.map((j) => j.publishOriginal) });
    expect(r.json?.status).toBe('awaiting_publish_confirmation');
    expect(p.status).toBe(200);
  });

  test('V1-UI-09 (I-04) fact-check-only approval from the interventions panel creates the frozen edit plan', async () => {
    await seed({ findings: false });
    m.user = user(A);
    delete process.env.AUDIO_EDITOR_URL;
    await openReview();
    const payload = { interventions: [{ id: 'i_A', correctionScript: 'Aの訂正です。', status: 'approved' }] };
    const r = await call(applyRoute, 'POST', ids.EA, payload);
    const plan = r.json?.planId ? (await getAdminFirestore().collection('podcasts').doc(String(ids.PA)).collection('episodes_contents').doc(String(ids.EA)).collection('audio_edit_plans').doc(r.json.planId).get()).data() : null;
    record({ case: 'V1-UI-09', http: r.status, status: await status(ids.PA, ids.EA), corrections: plan?.corrections, jobs: m.jobs.map((j) => j.editPlanId) });
    expect(r.status).toBe(200);
    expect(plan?.corrections).toEqual([{ startMs: 3000, script: 'Aの訂正です。' }]);
    expect(m.jobs).toEqual([expect.objectContaining({ editPlanId: r.json.planId })]);
  });

  test('V1-UI-10 normal operations: approve with edits, and partial decisions stop the panel request', async () => {
    const partial = await call(applyRoute, 'POST', ids.EA, { interventions: [] });
    await call(interventionsRoute, 'POST', ids.EA, { interventions: [{ id: 'i_A', correctionScript: 'Aの訂正です。', status: 'approved' }] });
    const saved = await saveProposals('approved');
    const apply = await call(applyRoute, 'POST', ids.EA, { planVersion: saved.json.version });
    record({ case: 'V1-UI-10', panelWithoutDecisions: partial.status, saved: [saved.status, saved.json?.status], apply: apply.status, status: await status(ids.PA, ids.EA), jobs: m.jobs.length });
    expect(partial.status).toBe(409);
    expect(apply.status).toBe(200);
    expect(m.jobs.length).toBe(1);
  });

  test('V1-UI-05 edit cannot start while items are undecided or with a stale version (no job, no state change)', async () => {
    const review = await openReview();
    const pending = await call(applyRoute, 'POST', ids.EA, { planVersion: review.version });
    await call(interventionsRoute, 'POST', ids.EA, { interventions: [{ id: 'i_A', correctionScript: 'Aの訂正です。', status: 'approved' }] });
    const stillPending = await call(applyRoute, 'POST', ids.EA, { planVersion: review.version });
    const approved = review.proposals.map((p: any) => ({ ...p, status: 'approved', action: 'cut', rangeConfirmed: true }));
    const saved = await call(reviewRoute, 'POST', ids.EA, { operation: 'save', version: review.version, proposals: approved });
    const stale = await call(applyRoute, 'POST', ids.EA, { planVersion: review.version });
    const after = await status(ids.PA, ids.EA);
    record({ case: 'V1-UI-05', interventionsPending: pending.status, proposalsPending: stillPending.status, saved: saved.status, staleVersion: [stale.status, stale.json?.error], status: after, jobs: m.jobs.length });
    expect(m.jobs.length).toBe(0);
    expect(after).toBe('awaiting_approval');
  });

  test('V1-UI-06 double submission of the same approval dispatches one job', async () => {
    await call(interventionsRoute, 'POST', ids.EA, { interventions: [{ id: 'i_A', correctionScript: 'Aの訂正です。', status: 'approved' }] });
    const review = await openReview();
    const approved = review.proposals.map((p: any) => ({ ...p, status: 'approved', action: 'cut', rangeConfirmed: true }));
    const saved = await call(reviewRoute, 'POST', ids.EA, { operation: 'save', version: review.version, proposals: approved });
    const [r1, r2] = await Promise.all([1, 2].map(() => call(applyRoute, 'POST', ids.EA, { planVersion: saved.json.version })));
    const plans = await getAdminFirestore().collection('podcasts').doc(String(ids.PA)).collection('episodes_contents').doc(String(ids.EA)).collection('audio_edit_plans').get();
    record({ case: 'V1-UI-06', http: [r1.status, r2.status].sort(), jobs: m.jobs.length, plans: plans.size, status: await status(ids.PA, ids.EA) });
    expect(m.jobs.length).toBe(1);
    expect(plans.size).toBe(1);
  });

  test('V1-UI-07 source audio replaced after audit blocks review and edit', async () => {
    const path = `eval-upload/podcasts/${ids.PA}/episodes/${ids.EA}/source/A.mp3`;
    m.objects.set(path, { data: Buffer.from('replaced-audio'), generation: 2 });
    const r = await call(reviewRoute, 'GET', ids.EA);
    const a = await call(applyRoute, 'POST', ids.EA, { planVersion: 1 });
    record({ case: 'V1-UI-07', reviewGet: [r.status, r.json?.error], apply: [a.status, a.json?.error], jobs: m.jobs.length, status: await status(ids.PA, ids.EA) });
    expect(r.status).toBe(409);
    expect(m.jobs.length).toBe(0);
  });

  test('V2-UI-01 an approved correction script edited to contain the secret enters the frozen edit plan unchanged', async () => {
    const i = await call(interventionsRoute, 'POST', ids.EA, { interventions: [{ id: 'i_A', correctionScript: `訂正します。案件コード${SECRET}は誤りです。`, status: 'approved' }] });
    const review = await openReview();
    const approved = review.proposals.map((p: any) => ({ ...p, status: 'approved', action: 'cut', rangeConfirmed: true }));
    const saved = await call(reviewRoute, 'POST', ids.EA, { operation: 'save', version: review.version, proposals: approved });
    const apply = await call(applyRoute, 'POST', ids.EA, { planVersion: saved.json.version });
    const plan = (await getAdminFirestore().collection('podcasts').doc(String(ids.PA)).collection('episodes_contents').doc(String(ids.EA)).collection('audio_edit_plans').doc(apply.json.planId).get()).data();
    record({ case: 'V2-UI-01', interventionSave: i.status, apply: apply.status, correctionContainsSecret: JSON.stringify(plan?.corrections).includes(SECRET), jobs: m.jobs.length });
    expect(JSON.stringify(plan?.corrections)).toContain(SECRET);
  });

  test('V2-UI-02 replacement script containing the secret is checked by the media service, not by the API', async () => {
    const review = await openReview();
    const r = await call(audioRoute, 'POST', ids.EA, { operation: 'synthesize', version: review.version, proposalId: review.proposals[0].id, script: `言い換え：${SECRET}` });
    record({ case: 'V2-UI-02', http: r.status, note: 'API はスクリプトを検査せず音声処理サービス（verify_text）に委ねる。本テストでは処理サービスを差し替えたため、検査は実行されていない' });
    expect(r.status).toBe(200);
  });

  test('V2-UI-03 after an edit is published, chat knowledge still reads the original transcripts (deleted secret re-enters RAG)', async () => {
    const root = getAdminFirestore().collection('podcasts').doc(String(ids.PA)).collection('episodes_contents').doc(String(ids.EA));
    await (await getDbPool()).query(`UPDATE episodes SET status='completed' WHERE podcast_id=$1 AND episode_id=$2`, [ids.PA, ids.EA]);
    await root.set({ minutes: 'A_EDITED_MINUTES 案件コードは（削除）です。', transcript_summary: 'A_EDITED_SUMMARY', active_edit_plan_id: 'plan-1' }, { merge: true });
    await root.collection('rendition_transcripts').doc('seg_00001').set({ chunk_id: 'seg_00001', start_time: 0, end_time: 2, speaker: '話者A', text: '案件コードはです。' });
    const knowledge = JSON.stringify(await listMinutesKnowledge(ids.PA));
    const transcript = await call(transcriptRoute, 'GET', ids.EA);
    record({ case: 'V2-UI-03', ragContainsSecret: knowledge.includes(SECRET), episodeTranscriptApiContainsSecret: JSON.stringify(transcript.json).includes(SECRET) });
    expect(knowledge).toContain(SECRET);
  });

  test('V4-01 user A cannot read or change podcast B data by swapping episode/asset/plan IDs (no side effects)', async () => {
    const fsB = getAdminFirestore().collection('podcasts').doc(String(ids.PB)).collection('episodes_contents').doc(String(ids.EB));
    await fsB.collection('replacement_audio_assets').doc('11111111-1111-4111-8111-111111111111').set({ id: '11111111-1111-4111-8111-111111111111', proposalId: 'x', script: 'B', objectPath: `policy/${ids.PB}/${ids.EB}/assets/b.wav` });
    await fsB.collection('audio_edit_plans').doc('22222222-2222-4222-8222-222222222222').set({ status: 'queued', sourcePath: 'x' });
    const before = await snapshot(ids.PB);
    const results: Record<string, number> = {};
    for (const cookie of ['', String(ids.PB)]) {
      m.cookie = cookie;
      const E = ids.EB;
      const tag = cookie ? 'cookie=PB' : 'cookie=none';
      results[`${tag} GET policy-findings`] = (await call(findingsRoute, 'GET', E)).status;
      results[`${tag} GET policy-review`] = (await call(reviewRoute, 'GET', E)).status;
      results[`${tag} POST policy-review save`] = (await call(reviewRoute, 'POST', E, { operation: 'save', version: 1, proposals: [] })).status;
      results[`${tag} POST policy-review suggest`] = (await call(reviewRoute, 'POST', E, { operation: 'suggest', version: 1 })).status;
      results[`${tag} GET interventions`] = (await call(interventionsRoute, 'GET', E)).status;
      results[`${tag} POST interventions`] = (await call(interventionsRoute, 'POST', E, { interventions: [{ id: 'i_B', correctionScript: 'x', status: 'approved' }] })).status;
      results[`${tag} GET policy-audio (B asset)`] = (await call(audioRoute, 'GET', E, undefined, '?assetId=11111111-1111-4111-8111-111111111111')).status;
      results[`${tag} GET policy-audio (B asset via A episode)`] = (await call(audioRoute, 'GET', ids.EA, undefined, '?assetId=11111111-1111-4111-8111-111111111111')).status;
      results[`${tag} POST policy-audio synthesize`] = (await call(audioRoute, 'POST', E, { operation: 'synthesize', version: 1, proposalId: 'x', script: 'x' })).status;
      results[`${tag} POST apply-interventions`] = (await call(applyRoute, 'POST', E, { planVersion: 1 })).status;
      results[`${tag} POST apply-interventions retry B plan`] = (await call(applyRoute, 'POST', E, { retryPlanId: '22222222-2222-4222-8222-222222222222' })).status;
      results[`${tag} POST review-policy-findings`] = (await call(legacyReviewRoute, 'POST', E, { findings: [{ id: 'f_B', status: 'rejected' }] })).status;
      results[`${tag} POST retry-audit`] = (await call(retryRoute, 'POST', E)).status;
      results[`${tag} POST confirm-original-publish`] = (await call(originalRoute, 'POST', E)).status;
      results[`${tag} GET source-audio`] = (await call(sourceRoute, 'GET', E)).status;
      results[`${tag} GET transcript`] = (await call(transcriptRoute, 'GET', E)).status;
    }
    const after = await snapshot(ids.PB);
    const jobsForB = m.jobs.filter((j) => j.podcastId === ids.PB || String(j.gcsTriggerObjectName ?? '').includes(`podcasts/${ids.PB}/`));
    record({ case: 'V4-01', results, podcastBUnchanged: before === after, jobsForB: jobsForB.length, jobsTotal: m.jobs.length });
    expect(Object.values(results).every((s) => s >= 400)).toBe(true);
    expect(before).toBe(after);
    expect(jobsForB.length).toBe(0);
  });
});
