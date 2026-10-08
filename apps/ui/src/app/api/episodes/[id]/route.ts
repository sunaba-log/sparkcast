import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { getSessionUser } from "@/server/auth";
import { requireSelectedPodcastForApi } from "@/server/podcasts/selection";
import {
  deleteEpisodeRecord,
  findEpisode,
  setEpisodePublished,
  updateEpisodeGeneratedContent,
  updateEpisodeMetadata,
} from "@/server/episodes/data-repository";
import { runAutomatorJob } from "@/server/episodes/automator-jobs";

const updateSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(10_000).optional(),
  minutes: z.string().max(200_000).optional(),
  promotions: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        message: z.string().max(10_000),
      }),
    )
    .optional(),
  isPublished: z.boolean().optional(),
});

async function authorize() {
  const user = await getSessionUser();
  if (!user) return null;
  const podcastId = await requireSelectedPodcastForApi(user);
  return { user, podcastId };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authorize();
    if (!auth) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }
    const episodeId = Number((await context.params).id);
    const episode = await findEpisode(auth.podcastId, episodeId);
    if (!episode) {
      return NextResponse.json({ error: "見つかりません" }, { status: 404 });
    }
    return NextResponse.json(episode);
  } catch (error) {
    if (error instanceof Error && error.message === "NO_PODCAST_SELECTED") {
      return NextResponse.json(
        { error: "チャンネルが選択されていません" },
        { status: 400 },
      );
    }
    if (error instanceof Error && error.message === "FORBIDDEN") {
      return NextResponse.json({ error: "操作権限がありません" }, { status: 403 });
    }
    console.error("Failed to load episode", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authorize();
    if (!auth) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }
    const episodeId = Number((await context.params).id);
    if (!Number.isInteger(episodeId) || episodeId <= 0) {
      return NextResponse.json({ error: "episode IDが不正です" }, { status: 400 });
    }
    if (!(await findEpisode(auth.podcastId, episodeId))) {
      return NextResponse.json({ error: "見つかりません" }, { status: 404 });
    }
    const input = updateSchema.parse(await request.json());

    if (input.title !== undefined || input.description !== undefined) {
      await updateEpisodeMetadata(
        auth.podcastId,
        episodeId,
        input.title,
        input.description,
      );
    }

    if (input.minutes !== undefined || input.promotions !== undefined) {
      await updateEpisodeGeneratedContent({
        podcastId: auth.podcastId,
        episodeId,
        minutes: input.minutes,
        promotions: input.promotions,
        updatedBy: auth.user.uid,
      });
    }

    if (input.isPublished !== undefined) {
      await setEpisodePublished(auth.podcastId, episodeId, input.isPublished);
      await runAutomatorJob({
        action: "sync_rss",
        podcastId: auth.podcastId,
      }).catch((err) => {
        console.warn("Failed to trigger sync_rss after publish update:", err);
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: "入力内容が不正です" }, { status: 400 });
    }
    if (error instanceof Error && error.message === "NO_PODCAST_SELECTED") {
      return NextResponse.json(
        { error: "チャンネルが選択されていません" },
        { status: 400 },
      );
    }
    if (error instanceof Error && error.message === "FORBIDDEN") {
      return NextResponse.json({ error: "操作権限がありません" }, { status: 403 });
    }
    console.error("Failed to update episode", error);
    return NextResponse.json({ error: "保存に失敗しました" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authorize();
    if (!auth) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }
    const episodeId = Number((await context.params).id);
    if (!Number.isInteger(episodeId) || episodeId <= 0) {
      return NextResponse.json({ error: "episode IDが不正です" }, { status: 400 });
    }
    const deleted = await deleteEpisodeRecord(auth.podcastId, episodeId);
    if (!deleted) {
      return NextResponse.json({ error: "見つかりません" }, { status: 404 });
    }
    await runAutomatorJob({
      action: "sync_rss",
      podcastId: auth.podcastId,
    }).catch((err) => {
      console.warn("Failed to trigger sync_rss after delete:", err);
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "NO_PODCAST_SELECTED") {
      return NextResponse.json(
        { error: "チャンネルが選択されていません" },
        { status: 400 },
      );
    }
    if (error instanceof Error && error.message === "FORBIDDEN") {
      return NextResponse.json({ error: "操作権限がありません" }, { status: 403 });
    }
    console.error("Failed to delete episode", error);
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }
}
