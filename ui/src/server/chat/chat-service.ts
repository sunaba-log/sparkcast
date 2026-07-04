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

const RETRIEVAL_LIMIT = 12;
const CONDENSE_HISTORY_TURNS = 6;

function buildSystemInstruction(context: string): string {
  const knowledge = context || "（配信済みの議事録はまだありません）";
  return [
    "あなたはポッドキャスト「Podcaster's DevLog」の議事録アシスタントです。",
    "以下に与えられた『配信済みエピソードの議事録・書き起こし』だけを根拠に、日本語で回答してください。",
    "",
    "# 回答の中身（重要）",
    "- 表面的な要約で終わらせず、具体的に答える。誰が何を述べたか、挙がった例・論点・結論・課題まで、議事録/書き起こしにある具体を拾って説明する。",
    "- 質問に対して十分な情報量で答える（短すぎる一言回答にしない）。ただし議事録に無いことは補わない。",
    "- 関連する複数の論点があれば整理して網羅する。",
    "",
    "# 回答スタイル（必ず守る）",
    "- 必ず読みやすい Markdown で構成し、長い一段落のベタ書きにしない。",
    "- 要点は箇条書き（`-`）にし、重要語は **太字** にする。話題の区切りには見出し（`##`）を使う。",
    "- 参照したエピソードは必ず Markdown リンク `[タイトル](/episodes/エピソードID)` で示す。",
    "  リンク文には議事録のタイトルを使い、URL の ID は見出し『## エピソード ID: タイトル』の ID を使う。",
    "- 議事録に記載が無い内容は答えず、その旨を伝える。推測しない。",
    "",
    "# 配信済みエピソードの議事録・書き起こし",
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
 * フォローアップ質問を、会話文脈を補った独立した検索クエリに書き換える。
 * 履歴が無い（初回質問）場合や失敗時は、直近のユーザー発言をそのまま使う。
 */
async function buildSearchQuery(messages: ChatMessage[]): Promise<string> {
  const last = lastUserMessage(messages);
  if (messages.length <= 1) return last;

  const history = messages
    .slice(-CONDENSE_HISTORY_TURNS)
    .map(
      (message) =>
        `${message.role === "user" ? "ユーザー" : "アシスタント"}: ${message.content}`,
    )
    .join("\n");

  try {
    const response = await getVertexAi().models.generateContent({
      model: getVertexAiModel(),
      contents: [
        {
          role: "user",
          parts: [
            {
              text: [
                "次の会話の最後のフォローアップ質問を、議事録検索に使えるよう文脈を補った独立した日本語の質問1文に書き換えてください。",
                "質問文のみを出力してください。",
                "",
                "会話:",
                history,
                "",
                "書き換え後の質問:",
              ].join("\n"),
            },
          ],
        },
      ],
      config: { temperature: 0 },
    });
    const rewritten = (response.text ?? "").trim();
    return rewritten || last;
  } catch (error) {
    console.warn("Query condense failed; using last message", error);
    return last;
  }
}

/**
 * RAG（ベクトル検索）で関連議事録を集めて文脈を作る。
 * 検索が使えない / ヒット無しの場合は全エピソードの全文コンテキストにフォールバックする。
 */
async function buildContext(
  podcastId: number,
  messages: ChatMessage[],
): Promise<string> {
  const query = await buildSearchQuery(messages);
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
