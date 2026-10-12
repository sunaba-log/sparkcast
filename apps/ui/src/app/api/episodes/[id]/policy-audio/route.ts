import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
import { policyApiContext, PolicyApiError } from "@/server/policy/api-context";
import {
  loadPolicyReview,
  policyAudioBucket,
  policyContentRef,
  policySource,
} from "@/server/policy/repository";
import { processPolicyMedia } from "@/server/policy/media";
import { getPodcast } from "@/server/podcasts/data-repository";
import { listDirectorInterventions } from "@/server/episodes/data-repository";
import type { ReplacementAudioAsset } from "@/types/episode";

const schema = z.object({
  operation: z.enum(["synthesize", "recording", "preview"]),
  version: z.number().int().positive().optional(),
  proposalId: z.string().min(1).max(10000),
  script: z.string().max(4000),
  audioBase64: z
    .string()
    .max(16 * 1024 * 1024)
    .optional(),
  action: z.enum(["cut", "silence", "replace", "insert"]).optional(),
  start: z.number().finite().nonnegative().optional(),
  end: z.number().finite().positive().optional(),
  assetId: z.string().uuid().nullable().optional(),
});
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { podcastId, episodeId } = await policyApiContext(
      (await params).id,
      true,
    );
    if (Number(request.headers.get("content-length")) > 17 * 1024 * 1024)
      return NextResponse.json(
        { error: "録音サイズが上限を超えています" },
        { status: 413 },
      );
    const input = schema.parse(await request.json());
    const review = await loadPolicyReview(podcastId, episodeId);
    const isPolicyProposal = review.proposals.some((p) => p.id === input.proposalId);
    if (isPolicyProposal) {
      if (input.version === undefined || review.version !== input.version) {
        throw new Error("内容が更新されています。再読み込みしてください。");
      }
    } else {
      const interventions = await listDirectorInterventions(podcastId, episodeId);
      if (!interventions.some((i) => i.id === input.proposalId)) {
        throw new Error("編集案が見つかりません。");
      }
    }
    const prefix = `policy/${podcastId}/${episodeId}/`;
    const root = policyContentRef(podcastId, episodeId);
    const id = randomUUID();
    let media;
    if (input.operation === "preview") {
      if (
        input.start === undefined ||
        input.end === undefined ||
        (input.action !== "insert" && input.start >= input.end) ||
        !input.action
      )
        throw new Error("編集範囲が不正です。");
      let audioBase64: string | undefined;
      if (input.action === "replace" || input.action === "insert") {
        if (!input.assetId) throw new Error("代替音声を準備してください。");
        const asset = (
          await root
            .collection("replacement_audio_assets")
            .doc(input.assetId)
            .get()
        ).data() as ReplacementAudioAsset | undefined;
        if (
          !asset ||
          asset.proposalId !== input.proposalId ||
          asset.script !== input.script ||
          !asset.objectPath.startsWith(prefix)
        )
          throw new Error("代替音声が台詞に対応していません。");
        const [bytes] = await policyAudioBucket()
          .file(asset.objectPath)
          .download();
        audioBase64 = bytes.toString("base64");
      }
      const source = await policySource(podcastId, episodeId);
      media = await processPolicyMedia({
        operation: "preview",
        sourcePath: source.path,
        sourceGeneration: source.generation,
        action: input.action,
        startMs: Math.round(input.start * 1000),
        endMs: Math.round(input.end * 1000),
        audioBase64,
      });
    } else {
      if (input.operation === "recording" && !input.audioBase64)
        throw new Error("録音がありません。");
      if (!input.script.trim()) throw new Error("代替台詞を入力してください。");
      const podcast = await getPodcast(podcastId);
      media = await processPolicyMedia({
        operation: input.operation,
        script: input.script,
        audioBase64: input.audioBase64,
        temporaryPath: `${prefix}temporary/${id}.wav`,
        confidentialTerms: podcast?.audioAuditPolicy.confidentialTerms ?? [],
        allowedTerms: podcast?.audioAuditPolicy.allowedTerms ?? [],
      });
    }
    const objectPath = `${prefix}${input.operation === "preview" ? "previews" : "assets"}/${id}.wav`;
    const audio = Buffer.from(media.audioBase64, "base64");
    const file = policyAudioBucket().file(objectPath);
    await file.save(audio, {
      contentType: "audio/wav",
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
    });
    const [url] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + 15 * 60 * 1000,
    });
    if (input.operation === "preview")
      return NextResponse.json({ url, durationMs: media.durationMs });
    const asset: ReplacementAudioAsset = {
      id,
      proposalId: input.proposalId,
      kind: input.operation === "synthesize" ? "synthesized" : "recorded",
      script: input.script,
      transcript: media.transcript,
      durationMs: media.durationMs,
      objectPath,
    };
    await root
      .collection("replacement_audio_assets")
      .doc(id)
      .create({
        ...asset,
        sha256: createHash("sha256").update(audio).digest("hex"),
        sourceGeneration: review.sourceGeneration,
        transcriptRevision: review.transcriptRevision,
        createdAt: new Date().toISOString(),
      });
    return NextResponse.json({ asset, url });
  } catch (error) {
    const status =
      error instanceof PolicyApiError
        ? error.status
        : error instanceof ZodError || error instanceof SyntaxError
          ? 400
          : 409;
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "音声処理に失敗しました",
      },
      { status },
    );
  }
}
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { podcastId, episodeId } = await policyApiContext((await params).id);
    const id = z
      .string()
      .uuid()
      .parse(new URL(request.url).searchParams.get("assetId"));
    const asset = (
      await policyContentRef(podcastId, episodeId)
        .collection("replacement_audio_assets")
        .doc(id)
        .get()
    ).data() as ReplacementAudioAsset | undefined;
    if (
      !asset ||
      !asset.objectPath.startsWith(`policy/${podcastId}/${episodeId}/assets/`)
    )
      throw new Error("音声が見つかりません。");
    const [url] = await policyAudioBucket()
      .file(asset.objectPath)
      .getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + 15 * 60 * 1000,
      });
    return NextResponse.json(
      { asset, url },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "音声を取得できません",
      },
      { status: error instanceof PolicyApiError ? error.status : 404 },
    );
  }
}
