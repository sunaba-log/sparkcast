import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { policyApiContext, PolicyApiError } from "@/server/policy/api-context";
import {
  loadPolicyReview,
  policyInputs,
  savePolicyReview,
  policyContentRef,
} from "@/server/policy/repository";
import { suggestPolicyEdits } from "@/server/policy/suggestions";
import { moveToPublishConfirmationIfAllRejected } from "@/server/policy/review-gate";
import type { PolicyEditProposal } from "@/types/episode";

import { isLocalUiDemoEnabled } from "@/server/env";
import { UI_DEMO_POLICY_FINDINGS } from "@/server/ui-demo";
import { groupPolicyFindings } from "@/lib/policy/proposals";

const proposalSchema = z.object({
  id: z.string().min(1).max(10000),
  findingIds: z.array(z.string().max(200)).min(1),
  start: z.number().finite().nonnegative(),
  end: z.number().finite().positive(),
  action: z.enum(["cut", "silence", "replace"]),
  status: z.enum(["pending", "approved", "rejected"]),
  script: z.string().max(4000),
  assetId: z.string().uuid().nullable(),
  rangeConfirmed: z.boolean(),
});
const schema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("suggest"),
    version: z.number().int().positive(),
  }),
  z.object({
    operation: z.literal("save"),
    version: z.number().int().positive(),
    proposals: z.array(proposalSchema).max(1000),
  }),
]);
function failure(error: unknown) {
  if (error instanceof PolicyApiError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  if (error instanceof ZodError || error instanceof SyntaxError)
    return NextResponse.json({ error: "入力内容が不正です" }, { status: 400 });
  return NextResponse.json(
    {
      error:
        error instanceof Error ? error.message : "判断を保存できませんでした",
    },
    { status: 409 },
  );
}
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (isLocalUiDemoEnabled()) {
      const { id } = await params;
      return NextResponse.json({
        version: 1,
        sourceGeneration: "demo",
        transcriptRevision: "demo",
        words: [],
        proposals: groupPolicyFindings(
          id === "3" ? UI_DEMO_POLICY_FINDINGS : [],
        ),
      });
    }
    const { podcastId, episodeId } = await policyApiContext((await params).id);
    const review = await loadPolicyReview(podcastId, episodeId);
    const root = policyContentRef(podcastId, episodeId);
    const lockedPlanId = (
      await root.collection("policy_reviews").doc("current").get()
    ).data()?.lockedPlanId;
    const plan = lockedPlanId
      ? (
          await root.collection("audio_edit_plans").doc(lockedPlanId).get()
        ).data()
      : null;
    return NextResponse.json(
      {
        ...review,
        dispatchRetryPlanId:
          plan?.status === "queued" && plan?.dispatchError
            ? lockedPlanId
            : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (isLocalUiDemoEnabled()) {
      const { id } = await params;
      if (id !== "3")
        throw new PolicyApiError("エピソードが見つかりません", 404);
      const input = schema.parse(await request.json());
      const defaults = groupPolicyFindings(UI_DEMO_POLICY_FINDINGS);
      const proposals =
        input.operation === "suggest"
          ? defaults
          : input.proposals.map((p) => ({
              ...defaults.find((item) => item.id === p.id),
              ...p,
            }));
      return NextResponse.json({
        version: input.version + 1,
        sourceGeneration: "demo",
        transcriptRevision: "demo",
        words: [],
        proposals,
        status: proposals.every((p) => p.status === "rejected")
          ? "awaiting_publish_confirmation"
          : "awaiting_approval",
      });
    }
    const { podcastId, episodeId, user } = await policyApiContext(
      (await params).id,
      true,
    );
    const input = schema.parse(await request.json());
    const review = await loadPolicyReview(podcastId, episodeId);
    if (review.version !== input.version)
      throw new Error("内容が更新されています。再読み込みしてください。");
    let proposals: PolicyEditProposal[];
    if (input.operation === "suggest") {
      if (review.proposals.some((p) => p.status !== "pending" || p.assetId))
        throw new Error("判断済みの提案は再生成できません。");
      const { findings, words } = await policyInputs(podcastId, episodeId);
      proposals = await suggestPolicyEdits(findings, words);
    } else {
      if (input.proposals.length !== review.proposals.length)
        throw new Error("指摘の対応が変わっています。");
      proposals = input.proposals.map((p) => {
        const old = review.proposals.find((item) => item.id === p.id);
        if (
          !old ||
          JSON.stringify([...p.findingIds].sort()) !==
            JSON.stringify([...old.findingIds].sort())
        )
          throw new Error("指摘の対応が変わっています。");
        return { ...old, ...p };
      });
    }
    const saved = await savePolicyReview(
      podcastId,
      episodeId,
      input.version,
      proposals,
      user.uid,
    );
    const status =
      input.operation === "save" &&
      (await moveToPublishConfirmationIfAllRejected(podcastId, episodeId))
        ? "awaiting_publish_confirmation"
        : "awaiting_approval";
    return NextResponse.json({ ...saved, status });
  } catch (error) {
    return failure(error);
  }
}
