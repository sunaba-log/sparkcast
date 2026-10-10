import "server-only";

import type { AdminUser } from "@/server/admin/users-repository";
import type { PreRegisteredEmail } from "@/server/admin/pre-registered-emails-repository";
import type { Podcast } from "@/server/podcasts/data-repository";
import type { TopicProposal } from "@/types/episode";
import type { DirectorIntervention, PolicyFinding } from "@/types/episode";
import type { PodcastSummary } from "@/types/podcast";

export const UI_DEMO_PODCAST: Podcast = {
  id: 1,
  title: "SparkCast デモチャンネル",
  description: "ローカルで各画面を確認するためのサンプルチャンネルです。",
  coverImageUrl: "/images/default-podcast-cover.png",
  rssFeedPath: "https://example.com/demo-podcast.xml",
  castMembers: "山田 花子, 鈴木 太郎",
  audioAuditPolicy: {
    version: "demo",
    enabled: true,
    confidentialTerms: ["社外秘", "未公開プロジェクト"],
    allowedTerms: ["SparkCast"],
  },
};

export const UI_DEMO_PODCASTS: PodcastSummary[] = [
  { ...UI_DEMO_PODCAST, role: "owner" },
  {
    id: 2,
    title: "技術トレンド便り",
    description: "編集者として参加しているサンプルチャンネルです。",
    coverImageUrl: null,
    rssFeedPath: null,
    role: "editor",
  },
];

export const UI_DEMO_TOPIC_PROPOSALS: TopicProposal[] = [
  {
    id: "demo-proposal-1",
    podcastId: 1,
    targetPeriod: "2026-10-06",
    generatedAt: "2026-10-06T09:00:00+09:00",
    relatedNews: [
      {
        title: "生成AIを活用する音声コンテンツの最新動向",
        url: "https://example.com/ai-audio",
        summary: "音声コンテンツ制作でのAI活用が広がっています。",
        sourceReason: "番組テーマのAIとクリエイティブに関連します。",
      },
      {
        title: "リモートチームのコミュニケーション調査",
        url: "https://example.com/remote-work",
        summary: "分散チームでの対話設計に関する調査結果です。",
        sourceReason: "過去回のリモートワーク回と接続できます。",
      },
    ],
    suggestedTopics: [
      {
        title: "AI時代のポッドキャストらしさ",
        description: "自動化が進んでも残したい、人が語る価値について話します。",
        suggestedPoints: ["編集を任せる基準", "リスナーとの距離感", "声の個性"],
        relatedPastEpisodes: [1],
      },
      {
        title: "少人数チームのリモート雑談",
        description: "偶発的な会話をどう設計するかを考えます。",
        suggestedPoints: ["同期と非同期の使い分け", "雑談の場づくり"],
        relatedPastEpisodes: [3],
      },
    ],
  },
];

export const UI_DEMO_DIRECTOR_INTERVENTIONS: DirectorIntervention[] = [
  {
    id: "demo-intervention-1",
    insertAt: 82.4,
    sourceText: "生成AIがあれば、番組制作はすべて自動化できると思います。",
    speaker: "山田 花子",
    severity: 4,
    category: "表現の正確性",
    correctionScript:
      "生成AIは制作を支援できますが、番組の企画や最終的な表現には人の判断が欠かせません。",
    status: "pending",
  },
  {
    id: "demo-intervention-2",
    insertAt: 244.8,
    sourceText: "このサービスなら必ずリスナー数が増えます。",
    speaker: "鈴木 太郎",
    severity: 3,
    category: "断定表現",
    correctionScript:
      "このサービスは、番組の改善に役立つ選択肢の一つになるかもしれません。",
    status: "approved",
  },
];

export const UI_DEMO_POLICY_FINDINGS: PolicyFinding[] = [
  {
    id: "demo-policy-1",
    chunkId: "demo-chunk-12",
    category: "pii",
    source: "presidio",
    start: 126.2,
    end: 128.6,
    text: "連絡先は 090-1234-5678 です。",
    entityType: "PHONE_NUMBER",
    action: "silence",
    status: "pending",
  },
  {
    id: "demo-policy-2",
    chunkId: "demo-chunk-31",
    category: "confidential_information",
    source: "jev",
    start: 306.1,
    end: 309.4,
    text: "未公開プロジェクトのリリース日は来月です。",
    entityType: null,
    action: "silence",
    status: "pending",
  },
];

export const UI_DEMO_USERS: Array<AdminUser & { isAdmin: boolean }> = [
  {
    uid: "ui_demo_admin",
    email: "demo-admin@example.com",
    displayName: "デモ管理者",
    approvalStatus: "active",
    createdAt: "2026-09-01T09:00:00+09:00",
    isAdmin: true,
  },
  {
    uid: "ui_demo_pending",
    email: "pending@example.com",
    displayName: "承認待ちユーザー",
    approvalStatus: "pending_approval",
    createdAt: "2026-10-03T14:30:00+09:00",
    isAdmin: false,
  },
];

export const UI_DEMO_PRE_REGISTERED_EMAILS: PreRegisteredEmail[] = [
  { email: "creator@example.com", createdAt: "2026-09-15T10:00:00+09:00" },
  { email: "editor@example.com", createdAt: "2026-10-01T10:00:00+09:00" },
];
