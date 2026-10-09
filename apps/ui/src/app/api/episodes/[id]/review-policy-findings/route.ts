import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { getSessionUser } from "@/server/auth";
import {
  findEpisode,
  listPolicyFindings,
  markEpisodeAwaitingPublishConfirmation,
  updatePolicyFindings,
} from "@/server/episodes/data-repository";
import { requireSelectedPodcastForApi } from "@/server/podcasts/selection";
import { isLocalUiDemoEnabled } from "@/server/env";

const reviewSchema = z.object({
  findings: z.array(z.object({
    id: z.string().min(1).max(200),
    status: z.enum(["approved", "rejected"]),
  })).min(1),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    if (isLocalUiDemoEnabled()) {
      const { id } = await context.params;
      if (id !== "3") {
        return NextResponse.json({ error: "エピソードが見つかりません" }, { status: 404 });
      }
      const input = reviewSchema.parse(await request.json());
      return NextResponse.json({
        ok: true,
        status: input.findings.some((finding) => finding.status === "approved")
          ? "awaiting_approval"
          : "awaiting_publish_confirmation",
      });
    }
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    const podcastId = await requireSelectedPodcastForApi(user);
    const episodeId = Number((await context.params).id);
    if (!Number.isInteger(episodeId) || episodeId <= 0) {
      return NextResponse.json({ error: "エピソードが見つかりません" }, { status: 404 });
    }
    const episode = await findEpisode(podcastId, episodeId);
    if (!episode) return NextResponse.json({ error: "エピソードが見つかりません" }, { status: 404 });
    if (episode.status !== "awaiting_approval") {
      return NextResponse.json({ error: "このエピソードは承認待ちではありません" }, { status: 409 });
    }
    const input = reviewSchema.parse(await request.json());
    const existing = await listPolicyFindings(podcastId, episodeId);
    const submittedIds = new Set(input.findings.map((finding) => finding.id));
    if (
      submittedIds.size !== existing.length
      || existing.length === 0
      || existing.some((finding) => !submittedIds.has(finding.id))
    ) {
      return NextResponse.json({ error: "すべての音声校正項目を判断してください" }, { status: 400 });
    }
    await updatePolicyFindings({
      podcastId,
      episodeId,
      findings: input.findings,
      updatedBy: user.uid,
    });
    const hasApproved = input.findings.some((finding) => finding.status === "approved");
    if (!hasApproved && !(await markEpisodeAwaitingPublishConfirmation(podcastId, episodeId))) {
      return NextResponse.json({ error: "エピソードの状態が更新されたため、もう一度確認してください" }, { status: 409 });
    }
    return NextResponse.json({
      ok: true,
      status: hasApproved ? "awaiting_approval" : "awaiting_publish_confirmation",
    });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: "入力内容が不正です" }, { status: 400 });
    }
    if (error instanceof Error && error.message === "NO_PODCAST_SELECTED") {
      return NextResponse.json({ error: "チャンネルを選択してください" }, { status: 400 });
    }
    console.error("Failed to review policy findings", error);
    return NextResponse.json({ error: "音声校正の判断を保存できませんでした" }, { status: 500 });
  }
}
