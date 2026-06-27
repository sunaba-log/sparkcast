import "server-only";

import type { Content } from "@google/genai";
import { getVertexAiModel } from "@/server/env";
import type { ChatMessage } from "@/types/chat";
import { embedQuery } from "@/server/chat/embeddings";
import {
  buildMinutesContext,
  buildRetrievedContext,
} from "@/server/chat/minutes-context";
import { listEpisodeKnowledge } from "@/server/chat/minutes-repository";
import { searchSimilarChunks } from "@/server/chat/vector-index";
import { getVertexAi } from "@/server/chat/vertex-client";

const RETRIEVAL_LIMIT = 8;

function buildSystemInstruction(context: string): string {
  const knowledge = context || "（配信済みの議事録はまだありません）";
  return [
    "あなたはポッドキャスト「Podcaster's DevLog」の議事録アシスタントです。",
    "以下に与えられた『配信済みエピソードの議事録』だけを根拠に、日本語で簡潔に回答してください。",
    "- 回答は議事録に基づき、参照したエピソードはタイトル（および番号）を添えて示してください。",
    "- 議事録に記載が無い内容は、その旨を伝え、推測で答えないでください。",
    "",
    "# 配信済みエピソードの議事録",
    knowledge,
  ].join("\n");
}

function toContents(messages: ChatMessage[]): Content[] {
  return messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));
}

function lastUserMessage(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") return messages[i].content;
  }
  return "";
}

/**
 * RAG（ベクトル検索）で関連議事録を集めて文脈を作る。
 * 検索が使えない / ヒット無しの場合は全エピソードの全文コンテキストにフォールバックする。
 */
async function buildContext(
  podcastId: number,
  messages: ChatMessage[],
): Promise<string> {
  const query = lastUserMessage(messages);
  if (query) {
    try {
      const queryVector = await embedQuery(query);
      const chunks = await searchSimilarChunks(
        podcastId,
        queryVector,
        RETRIEVAL_LIMIT,
      );
      const retrieved = buildRetrievedContext(chunks);
      if (retrieved) return retrieved;
    } catch (error) {
      console.warn(
        "Vector search unavailable; falling back to full minutes",
        error,
      );
    }
  }
  const knowledge = await listEpisodeKnowledge(podcastId);
  return buildMinutesContext(knowledge);
}

/**
 * 配信済みエピソードの議事録を文脈に、会話への回答をストリーミングで生成する。
 */
export async function* streamChatReply(input: {
  podcastId: number;
  messages: ChatMessage[];
}): AsyncGenerator<string> {
  const context = await buildContext(input.podcastId, input.messages);

  const stream = await getVertexAi().models.generateContentStream({
    model: getVertexAiModel(),
    contents: toContents(input.messages),
    config: {
      systemInstruction: buildSystemInstruction(context),
      temperature: 0.3,
    },
  });

  for await (const chunk of stream) {
    const text = chunk.text;
    if (text) yield text;
  }
}
