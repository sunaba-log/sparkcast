import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { getAdminFirestore } from "@/server/firebase-admin";
import { getDbPool } from "@/server/db";
import { getStorage } from "@/server/storage";
import { getUploadBucket } from "@/server/env";
import {
  listPolicyFindings,
  listDirectorInterventions,
} from "@/server/episodes/data-repository";
import {
  groupPolicyFindings,
  validateProposalCoverage,
} from "@/lib/policy/proposals";
import type {
  PolicyEditProposal,
  PolicyReview,
  ReplacementAudioAsset,
} from "@/types/episode";

export function policyContentRef(podcastId: number, episodeId: number) {
  return getAdminFirestore()
    .collection("podcasts")
    .doc(String(podcastId))
    .collection("episodes_contents")
    .doc(String(episodeId));
}
export function policyAudioBucket() {
  const name = process.env.POLICY_AUDIO_BUCKET;
  if (!name) throw new Error("POLICY_AUDIO_BUCKET が設定されていません。");
  return getStorage().bucket(name);
}
export async function policySource(podcastId: number, episodeId: number) {
  const { rows } = await (
    await getDbPool()
  ).query<{ source_audio_path: string | null }>(
    "SELECT source_audio_path FROM episodes WHERE podcast_id = $1 AND episode_id = $2",
    [podcastId, episodeId],
  );
  const path = rows[0]?.source_audio_path;
  if (
    !path ||
    !path.startsWith(`podcasts/${podcastId}/episodes/${episodeId}/source/`)
  )
    throw new Error("原音声が見つかりません。");
  const content = await policyContentRef(podcastId, episodeId).get();
  const auditedHash = content.data()?.transcript_meta?.source_md5;
  const [metadata] = await getStorage()
    .bucket(getUploadBucket())
    .file(path)
    .getMetadata();
  if (
    auditedHash &&
    metadata.md5Hash &&
    Buffer.from(metadata.md5Hash, "base64").toString("hex") !== auditedHash
  )
    throw new Error("監査後に原音声が変更されています。再監査してください。");
  return { path, generation: String(metadata.generation) };
}
export async function policyInputs(podcastId: number, episodeId: number) {
  const [findings, transcripts, source] = await Promise.all([
    listPolicyFindings(podcastId, episodeId),
    policyContentRef(podcastId, episodeId)
      .collection("transcripts")
      .orderBy("chunk_id")
      .get(),
    policySource(podcastId, episodeId),
  ]);
  const segments = transcripts.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
  const words = transcripts.docs
    .flatMap((doc) =>
      (doc.data().words ?? []).map((w: Record<string, unknown>, i: number) => ({
        wordId: `${doc.id}:w${String(i).padStart(4, "0")}`,
        text: String(w.text ?? ""),
        timingConfident: w.timing_confident !== false,
        start: Number(w.start),
        end: Number(w.end),
      })),
    )
    .filter(
      (word) =>
        word.timingConfident &&
        Number.isFinite(word.start) &&
        word.end > word.start,
    );
  const transcriptRevision = createHash("sha256")
    .update(
      JSON.stringify({
        segments,
        findings: findings.map((finding) =>
          Object.fromEntries(
            Object.entries(finding).filter(
              ([key]) => key !== "status" && key !== "action",
            ),
          ),
        ),
      }),
    )
    .digest("hex");
  return { findings, words, source, transcriptRevision };
}
function compactReview(review: PolicyReview) {
  return {
    version: review.version,
    sourceGeneration: review.sourceGeneration,
    transcriptRevision: review.transcriptRevision,
    proposals: review.proposals.map((proposal) =>
      Object.fromEntries(
        Object.entries(proposal).filter(([key]) => key !== "findings"),
      ),
    ),
  };
}
function hydrateReview(
  review: PolicyReview,
  inputs: Awaited<ReturnType<typeof policyInputs>>,
): PolicyReview {
  return {
    ...review,
    words: inputs.words,
    proposals: review.proposals.map((proposal) => ({
      ...proposal,
      findings: inputs.findings.filter((finding) =>
        proposal.findingIds.includes(finding.id),
      ),
    })),
  };
}
export async function loadPolicyReview(
  podcastId: number,
  episodeId: number,
): Promise<PolicyReview> {
  const inputs = await policyInputs(podcastId, episodeId);
  const ref = policyContentRef(podcastId, episodeId)
    .collection("policy_reviews")
    .doc("current");
  return getAdminFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const old = snap.data() as PolicyReview | undefined;
    if (
      old?.transcriptRevision === inputs.transcriptRevision &&
      old.sourceGeneration === inputs.source.generation
    )
      return hydrateReview(old, inputs);
    const review: PolicyReview = {
      version: (old?.version ?? 0) + 1,
      sourceGeneration: inputs.source.generation,
      transcriptRevision: inputs.transcriptRevision,
      proposals: groupPolicyFindings(inputs.findings),
      words: inputs.words,
    };
    tx.set(ref, compactReview(review));
    return review;
  });
}
export async function savePolicyReview(
  podcastId: number,
  episodeId: number,
  version: number,
  proposals: PolicyEditProposal[],
  userId: string,
): Promise<PolicyReview> {
  const inputs = await policyInputs(podcastId, episodeId);
  if (inputs.findings.length > 450)
    throw new Error(
      "指摘が450件を超えています。エピソードを分けて再監査してください。",
    );
  validateProposalCoverage(proposals, inputs.findings);
  const root = policyContentRef(podcastId, episodeId);
  const ref = root.collection("policy_reviews").doc("current");
  const assets = await Promise.all(
    proposals
      .filter((p) => p.status === "approved" && p.action === "replace")
      .map(async (p) => ({
        proposal: p,
        asset: (
          await root
            .collection("replacement_audio_assets")
            .doc(p.assetId!)
            .get()
        ).data() as ReplacementAudioAsset | undefined,
      })),
  );
  for (const { proposal, asset } of assets) {
    if (
      !asset ||
      asset.proposalId !== proposal.id ||
      asset.script !== proposal.script ||
      (
        asset as ReplacementAudioAsset & {
          sourceGeneration?: string;
          transcriptRevision?: string;
        }
      ).sourceGeneration !== inputs.source.generation ||
      (asset as ReplacementAudioAsset & { transcriptRevision?: string })
        .transcriptRevision !== inputs.transcriptRevision
    )
      throw new Error("代替音声が現在の台詞に対応していません。");
  }
  return getAdminFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const old = snap.data() as PolicyReview | undefined;
    if (
      snap.data()?.lockedPlanId ||
      !old ||
      old.version !== version ||
      old.sourceGeneration !== inputs.source.generation ||
      old.transcriptRevision !== inputs.transcriptRevision
    )
      throw new Error("内容が更新されています。再読み込みしてください。");
    const review = hydrateReview(
      { ...old, version: old.version + 1, proposals },
      inputs,
    );
    tx.set(ref, { ...compactReview(review), reviewedBy: userId });
    for (const proposal of proposals)
      for (const id of proposal.findingIds) {
        tx.update(root.collection("policy_findings").doc(id), {
          status: proposal.status,
          action: proposal.action,
        });
      }
    return review;
  });
}
export async function createPolicyEditPlan(
  podcastId: number,
  episodeId: number,
  version: number,
) {
  const ref = policyContentRef(podcastId, episodeId)
    .collection("policy_reviews")
    .doc("current");
  const review = (await ref.get()).data() as PolicyReview | undefined;
  const inputs = await policyInputs(podcastId, episodeId);
  if (
    !review ||
    review.sourceGeneration !== inputs.source.generation ||
    review.transcriptRevision !== inputs.transcriptRevision
  )
    throw new Error("原音声・監査が更新されています。再確認してください。");
  if (
    review.version !== version ||
    review.proposals.some((p) => p.status === "pending")
  )
    throw new Error("判断を保存してから編集を開始してください。");
  validateProposalCoverage(review.proposals, inputs.findings);
  const approved = review.proposals.filter((p) => p.status === "approved");
  const assets = await Promise.all(
    approved
      .filter((p) => p.action === "replace")
      .map(async (p) => {
        const asset = (
          await policyContentRef(podcastId, episodeId)
            .collection("replacement_audio_assets")
            .doc(p.assetId!)
            .get()
        ).data() as ReplacementAudioAsset | undefined;
        if (
          !asset ||
          asset.proposalId !== p.id ||
          asset.script !== p.script ||
          (asset as ReplacementAudioAsset & { sourceGeneration?: string })
            .sourceGeneration !== inputs.source.generation ||
          (asset as ReplacementAudioAsset & { transcriptRevision?: string })
            .transcriptRevision !== inputs.transcriptRevision
        )
          throw new Error("代替音声を再確認してください。");
        if (!asset.sha256 || !/^[a-f0-9]{64}$/.test(asset.sha256))
          throw new Error("音声アセットのハッシュが不正です。");
        return asset as ReplacementAudioAsset & { sha256: string };
      }),
  );
  const interventions = await listDirectorInterventions(podcastId, episodeId);
  if (interventions.some((i) => i.status === "pending"))
    throw new Error("訂正介入を先に判断してください。");
  const corrections = interventions.filter((i) => i.status === "approved");
  if (!approved.length && !corrections.length)
    throw new Error("承認した編集案がありません。");
  if (
    corrections.some((i) =>
      approved.some((p) => p.start < i.insertAt && i.insertAt < p.end),
    )
  )
    throw new Error(
      "訂正介入の位置が削除・置換範囲内にあります。判断を調整してください。",
    );
  const id = randomUUID();
  const plan = {
    id,
    status: "queued",
    version,
    sourcePath: inputs.source.path,
    sourceGeneration: inputs.source.generation,
    transcriptRevision: inputs.transcriptRevision,
    corrections: corrections
      .filter((i) => !i.action || i.action === "insert" || i.action === "replace")
      .map((i) => ({
        startMs: Math.round(i.insertAt * 1000),
        script: i.correctionScript,
      })),
    operations: [
      ...approved.map((p) => ({
        startMs: Math.round(p.start * 1000),
        endMs: Math.round(p.end * 1000),
        action: p.action,
        assetPath: assets.find((a) => a.id === p.assetId)?.objectPath ?? null,
        assetHash: assets.find((a) => a.id === p.assetId)?.sha256 ?? null,
        replacementTranscript:
          assets.find((a) => a.id === p.assetId)?.transcript ?? "",
      })),
      ...corrections
        .filter((i) => i.action === "cut" || i.action === "silence")
        .map((i) => ({
          startMs: Math.round((i.start ?? i.insertAt) * 1000),
          endMs: Math.round((i.end ?? i.insertAt) * 1000),
          action: i.action as "cut" | "silence",
          assetPath: null,
          assetHash: null,
          replacementTranscript: "",
        })),
    ],
    createdAt: new Date().toISOString(),
  };
  await getAdminFirestore().runTransaction(async (tx) => {
    const latest = (await tx.get(ref)).data() as PolicyReview | undefined;
    if (latest?.version !== version)
      throw new Error("判断が更新されています。再確認してください。");
    tx.create(
      policyContentRef(podcastId, episodeId)
        .collection("audio_edit_plans")
        .doc(id),
      plan,
    );
    tx.update(ref, { lockedPlanId: id });
  });
  return plan;
}
