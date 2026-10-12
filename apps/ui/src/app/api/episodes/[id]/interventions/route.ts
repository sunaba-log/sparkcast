import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth";
import {
  findEpisode,
  listDirectorInterventions,
  updateDirectorInterventions,
} from "@/server/episodes/data-repository";
import { requireSelectedPodcastForApi } from "@/server/podcasts/selection";
import { isLocalUiDemoEnabled } from "@/server/env";
import { UI_DEMO_DIRECTOR_INTERVENTIONS } from "@/server/ui-demo";

import { z } from "zod";
import { policyApiContext, PolicyApiError } from "@/server/policy/api-context";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    if (isLocalUiDemoEnabled()) {
      const { id } = await context.params;
      return NextResponse.json(
        {
          interventions: id === "3" ? UI_DEMO_DIRECTOR_INTERVENTIONS : [],
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const user = await getSessionUser();
    if (!user)
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    const podcastId = await requireSelectedPodcastForApi(user);
    const episodeId = Number((await context.params).id);
    if (
      !Number.isInteger(episodeId) ||
      episodeId <= 0 ||
      !(await findEpisode(podcastId, episodeId))
    ) {
      return NextResponse.json(
        { error: "エピソードが見つかりません" },
        { status: 404 },
      );
    }
    const interventions = await listDirectorInterventions(podcastId, episodeId);
    return NextResponse.json(
      { interventions },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof Error && error.message === "NO_PODCAST_SELECTED") {
      return NextResponse.json(
        { error: "チャンネルを選択してください" },
        { status: 400 },
      );
    }
    console.error("Failed to load director interventions", error);
    return NextResponse.json(
      { error: "監査結果を取得できませんでした" },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const input = z
      .object({
        interventions: z
          .array(
            z.object({
              id: z.string().min(1).max(200),
              correctionScript: z.string().min(1).max(10000),
              status: z.enum(["approved", "rejected"]),
              action: z.enum(["insert", "cut", "silence", "replace"]).optional(),
              start: z.number().min(0).optional(),
              end: z.number().min(0).optional(),
            }),
          )
          .min(1),
      })
      .parse(await request.json());
    if (isLocalUiDemoEnabled()) return NextResponse.json({ ok: true });
    const { podcastId, episodeId, user } = await policyApiContext(
      (await context.params).id,
      true,
    );
    const existing = await listDirectorInterventions(podcastId, episodeId);
    const ids = new Set(input.interventions.map((i) => i.id));
    if (
      ids.size !== input.interventions.length ||
      ids.size !== existing.length ||
      existing.some((i) => !ids.has(i.id))
    ) {
      return NextResponse.json(
        { error: "すべての訂正介入を判断してください" },
        { status: 400 },
      );
    }
    await updateDirectorInterventions({
      podcastId,
      episodeId,
      interventions: input.interventions,
      updatedBy: user.uid,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "判断を保存できません",
      },
      { status: error instanceof PolicyApiError ? error.status : 400 },
    );
  }
}
