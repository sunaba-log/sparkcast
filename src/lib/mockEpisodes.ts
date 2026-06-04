import { Episode } from "@/types/episode";

export const mockEpisodes: Episode[] = [
  {
    id: "ep-001",
    title: "AIとポッドキャストの未来について語る",
    createdAt: "2026-06-01T10:00:00Z",
    status: "completed",
    audioFileName: "episode-001.mp3",
    minutesGenerated: true,
    xPostsGenerated: true,
    seedsGenerated: true,
    minutes: `## エピソード議事録

**収録日：** 2026年6月1日

### 概要
今回はAI技術がポッドキャスト制作にどのような変革をもたらすかについて議論しました。

### 主なトピック

1. **AI音声合成の進化**
   - 最新の音声合成技術により、ほぼ人間と区別がつかない音声生成が可能に
   - ポッドキャスト制作コストの大幅削減が期待される

2. **コンテンツ自動生成**
   - 台本の自動生成から編集まで、AIがサポート
   - クリエイターがより創造的な作業に集中できる環境へ

3. **リスナーとのエンゲージメント**
   - AIによるパーソナライズされたコンテンツ推薦
   - リアルタイムフィードバック分析の活用

### まとめ
AI技術の進化により、ポッドキャスト制作の民主化が加速しています。`,
    xPostRecommendations: [
      "🎙️ 新エピソード公開！「AIとポッドキャストの未来」について熱く語りました。音声合成、コンテンツ自動生成、リスナーとのエンゲージメント強化まで、2026年のポッドキャストシーンを展望します。ぜひ聴いてみてください👇 #ポッドキャスト #AI",
      "AIがポッドキャスト制作を変えつつあります。今回のエピソードでは、現場クリエイターの視点から「どこまでAIに任せられるか」を議論。自動化と人間らしさのバランスについても触れています🤖🎧 #PodcastAI #コンテンツ制作",
      "【新着】ポッドキャスト × AI の話、しました。制作コスト、音声品質、パーソナライゼーション…リスナー目線での変化も含めて深掘りしています。週末のながら聴きにどうぞ✨ #ポッドキャスト",
    ],
    conversationSeeds: [
      "AIが生成した音声と人間の声を聴き比べたとき、どこで「違和感」を感じますか？その違和感はなくなると思いますか？",
      "ポッドキャストの「個性」はどこから生まれると思いますか？AIが制作を担った場合、その個性は維持できるでしょうか？",
      "コンテンツ制作でAIに任せたい部分と、絶対に自分でやりたい部分はどこですか？",
      "過去のエピソードを振り返ると、「あのときのリスナーの反応が意外だった」という経験はありますか？",
    ],
  },
  {
    id: "ep-002",
    title: "スタートアップ創業期のリアルな話",
    createdAt: "2026-05-28T14:30:00Z",
    status: "completed",
    audioFileName: "episode-002.mp3",
    minutesGenerated: true,
    xPostsGenerated: true,
    seedsGenerated: false,
    minutes: `## エピソード議事録

**収録日：** 2026年5月28日

### 概要
スタートアップを立ち上げた経験者をゲストに迎え、創業初期の苦労と学びについて語り合いました。

### 主なトピック

1. **資金調達の現実**
   - シードラウンドで直面した壁
   - 投資家へのピッチで重要だったこと

2. **チーム構築**
   - 最初の採用でミスしたこと
   - カルチャーフィットの重要性

3. **プロダクトマーケットフィット**
   - ピボットの決断と実行
   - 顧客の声を聞くことの大切さ

### まとめ
失敗を恐れずに動き続けることが、スタートアップ成功の鍵だと学びました。`,
    xPostRecommendations: [
      "🚀 スタートアップ創業のリアルをゲストと語り合いました。資金調達の壁、最初の採用ミス、ピボットの判断…。美化せずに本音で話しています。起業を考えている方にぜひ聴いてほしい回です👇 #スタートアップ #起業",
      "「失敗しても死なない」という言葉がすごく刺さりました。今回のゲストが創業期に経験した数々の失敗談、笑えるものから本当に辛かったものまで赤裸々に語ってもらっています。 #スタートアップ #創業",
    ],
    conversationSeeds: [],
  },
  {
    id: "ep-003",
    title: "リモートワーク3年目の本音",
    createdAt: "2026-05-20T09:00:00Z",
    status: "processing",
    audioFileName: "episode-003.mp3",
    minutesGenerated: false,
    xPostsGenerated: false,
    seedsGenerated: false,
    minutes: "",
    xPostRecommendations: [],
    conversationSeeds: [],
  },
  {
    id: "ep-004",
    title: "エンジニアのキャリアパスを考える",
    createdAt: "2026-05-15T16:00:00Z",
    status: "uploaded",
    audioFileName: "episode-004.mp3",
    minutesGenerated: false,
    xPostsGenerated: false,
    seedsGenerated: false,
    minutes: "",
    xPostRecommendations: [],
    conversationSeeds: [],
  },
  {
    id: "ep-005",
    title: "デザインとエンジニアリングの境界線",
    createdAt: "2026-05-10T11:00:00Z",
    status: "failed",
    audioFileName: "episode-005.mp3",
    minutesGenerated: false,
    xPostsGenerated: false,
    seedsGenerated: false,
    minutes: "",
    xPostRecommendations: [],
    conversationSeeds: [],
  },
];
