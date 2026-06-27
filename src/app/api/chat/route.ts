import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { getSessionUser, requirePodcastAccess } from "@/server/auth";
import { getDefaultPodcastId } from "@/server/env";
import { streamChatReply } from "@/server/chat/chat-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(10_000),
      }),
    )
    .min(1)
    .max(50),
});

async function authorize() {
  const user = await getSessionUser();
  if (!user) return null;
  const podcastId = getDefaultPodcastId();
  await requirePodcastAccess(user.uid, podcastId);
  return { user, podcastId };
}

export async function POST(request: Request) {
  try {
    const auth = await authorize();
    if (!auth) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }
    const { messages } = chatSchema.parse(await request.json());

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of streamChatReply({
            podcastId: auth.podcastId,
            messages,
          })) {
            controller.enqueue(encoder.encode(chunk));
          }
        } catch (error) {
          console.error("Chat streaming failed", error);
          controller.error(error);
          return;
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: "入力内容が不正です" }, { status: 400 });
    }
    if (error instanceof Error && error.message === "FORBIDDEN") {
      return NextResponse.json({ error: "操作権限がありません" }, { status: 403 });
    }
    console.error("Failed to handle chat", error);
    return NextResponse.json(
      { error: "応答の生成に失敗しました" },
      { status: 500 },
    );
  }
}
