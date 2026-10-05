"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquare, Send } from "lucide-react";
import type { RecordingController } from "@/lib/recording/controller";
import { CHAT_MAX_LENGTH, type ChatMessage } from "@/lib/recording/protocol";

const TIME = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

// 収録中のテキストチャット（#166）。声を出さずに「音が途切れた」「次の話題へ」と伝える。
// 履歴はルームを閉じたら消え、収録には入らない。
export function RoomChat({
  controller,
  messages,
  selfPid,
  error,
  connected,
}: {
  controller: RecordingController;
  messages: ChatMessage[];
  selfPid: string;
  error: string | null;
  connected: boolean;
}) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLOListElement>(null);

  // 新しいメッセージが来たら一番下へ
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length]);

  function send() {
    if (controller.sendChat(text)) setText("");
  }

  return (
    <section className="border border-brand/20 rounded-xs bg-white/60" aria-label="チャット">
      <div className="px-4 pt-3">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-gray-700 whitespace-nowrap">
          <MessageSquare className="w-4 h-4 text-brand" /> チャット
        </h2>
        <p className="text-xs text-gray-400">録音には入りません。ルームを閉じると消えます。</p>
      </div>
      <ol ref={listRef} className="max-h-56 overflow-y-auto px-4 py-2 space-y-1.5 text-sm" aria-live="polite">
        {messages.length === 0 && <li className="text-xs text-gray-400">まだメッセージはありません。</li>}
        {messages.map((message) => (
          <li key={message.id} className="break-words">
            {/* 名前と時刻は折り返さない（長い名前は省略し、時刻が 2 行に割れないように） */}
            <span
              className={`inline-block max-w-[60%] align-bottom truncate font-semibold mr-1.5 ${message.pid === selfPid ? "text-brand" : "text-gray-800"}`}
              title={message.name}
            >
              {message.name}
            </span>
            <span className="mr-1.5 whitespace-nowrap text-[11px] text-gray-400 tabular-nums">{TIME.format(message.at)}</span>
            <span className="text-gray-800 whitespace-pre-wrap">{message.text}</span>
          </li>
        ))}
      </ol>
      <form
        className="flex gap-2 border-t border-brand/10 px-3 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <label htmlFor="room-chat-input" className="sr-only">
          チャットのメッセージ
        </label>
        <input
          id="room-chat-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // 日本語入力の変換を確定する Enter では送らない（Safari は確定の Enter でもフォームを送ることがある）
            if (event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault();
          }}
          maxLength={CHAT_MAX_LENGTH}
          placeholder={connected ? "メッセージを入力" : "再接続しています…"}
          autoComplete="off"
          className="flex-1 min-w-0 border border-gray-300 rounded-xs px-2 py-1.5 text-base sm:text-sm bg-white focus:outline-none focus:border-brand"
        />
        <button
          type="submit"
          disabled={!connected || text.trim().length === 0}
          aria-label="チャットを送信"
          className="inline-flex items-center gap-1 px-3 text-sm rounded-xs bg-brand text-white hover:bg-brand-hover disabled:opacity-40"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
      {error && <p className="px-4 pb-2 text-xs text-red-600">{error}</p>}
    </section>
  );
}
