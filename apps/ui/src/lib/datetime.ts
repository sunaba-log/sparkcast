// 日付を日本時間で書式化する。サーバー（UTC）とブラウザで同じ文字列になるので、
// 描画の食い違い（React のハイドレーションエラー #418）が起きない。
const JST_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function jstParts(value: string | Date): {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
} | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(JST_PARTS.formatToParts(date).map((part) => [part.type, part.value]));
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute };
}

// 例: 2026-10-04（日本時間の日付）
export function formatJstDate(value: string | Date): string {
  const parts = jstParts(value);
  if (!parts) return String(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// 例: 2026/10/04 11:03
export function formatJstDateTime(value: string | Date): string {
  const parts = jstParts(value);
  if (!parts) return String(value);
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}
