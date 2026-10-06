# チャンネル別認証情報（Credentials）管理マニュアル

本マニュアルは、ポッドキャスト（チャンネル）ごとに独立した X (Twitter) API および Discord Bot トークンをセキュアに取得・適用するための仕様、現状の課題、および代替案について整理したものです。

---

## 1. 現行の基本仕様 (Specifications)

マルチチャンネル運用において、各チャンネル専用の認証情報を動的に解決する仕組みの仕様です。

### 1-1. 保存場所と命名規則
* **システム**: Google Cloud Secret Manager
* **シークレット名**: `podcast-{podcast_id}-secrets`
  * 例: ポッドキャストIDが `1` の場合、シークレット名は `podcast-1-secrets` となります。
* **データ形式**: JSON

### 1-2. JSON ペイロード構造 (スキーマ)
キー名は、従来の接頭辞（`x_` 等）の有無にかかわらず、以下のいずれの名前でも柔軟にパースされます。

```json
{
  "x_api_key": "YOUR_X_API_KEY",                // または "api_key"
  "x_api_secret": "YOUR_X_API_SECRET",            // または "api_secret"
  "x_access_token": "YOUR_X_ACCESS_TOKEN",        // または "access_token"
  "x_access_token_secret": "YOUR_X_ACCESS_TOKEN_SECRET", // または "access_token_secret"
  "discord_bot_token": "YOUR_DISCORD_BOT_TOKEN"
}
```

### 1-3. X投稿の配信先を確定する

X投稿ジョブは `podcast-{podcast_id}-secrets` の4種類の認証情報を取得・検証し、そのアカウントだけへ投稿する。事前承認は要求せず、予定時刻を過ぎたpendingの自動投稿を継続する。

| 条件 | 動作 |
| --- | --- |
| 4種類の認証情報が揃い、X認証が成功 | 対象チャンネルへ自動投稿 |
| Secret未登録、取得失敗、一部欠落、X認証失敗 | 送信せず対象投稿をfailedにする |
| 投稿参照パスの形式やdocument IDが不整合 | 送信・状態更新をせずエラーログを残す |

チャンネル認証が使えない場合に、環境変数の共通Xアカウントへ切り替えない。promoterのentrypointは共通Xクライアントを作らないため、古い `X_API_KEY` / `X_API_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET` が残っていても使用しない。

移行前に各PodcastのSecretと実行サービスアカウントの参照権限を確認する。共通アカウントを継続して使う場合でも、その認証情報を対象Podcastに明示的に対応付ける。failedになった投稿は認証情報を修正し、外部送信がなかったことを確認したうえで既存の管理操作で再度投稿対象にする。実際の移行・再送操作はこの変更では実施していない。

ユースケースへSecretProviderなしでXClientを直接渡す単一アカウント用呼出しは互換性のため残すが、通常のpromoter entrypointからは使用しない。Discordの認証情報やフォールバックはこのX投稿の変更対象外。

---

## 2. 現行仕様における課題とリスク (Challenges)

### 2-1. 配信先対応と停止後の運用

暗黙の共通Xアカウントへの切替は廃止した。ただし、チャンネルのSecret自体に誤ったアカウントを登録した場合を防ぐものではない。登録したアカウントの確認は別途必要。failedの表示・通知・復旧操作の使いやすさ、参照パス不正の投稿がキュー先頭を塞ぐ場合の扱いは後続課題。

### 2-2. Secret Manager の API コストとクォータ
* **課題**: 毎回の自動投稿チェックやリマインダー実行時に毎回 Secret Manager API を呼び出します。
* **リスク**: チャンネル数や実行頻度（cron の間隔）が増加するにつれて、Secret Manager の API 呼び出しコスト（GCP課金）および API レートリミット（クォータ）の制約に達する可能性があります。

### 2-3. インフラ運用のオーバーヘッド
* **課題**: ポッドキャストの新規追加時に、GCPコンソールやTerraform等から手動で Secret Manager リソースを作成する必要があります。
* **リスク**: 現状、Web UI からはシークレット情報の登録ができないため、管理者の作業工数が発生し、プロビジョニングの遅延に繋がります。

---

## 3. 代替案および今後の改善案 (Alternatives)

### 対応済み A: X認証失敗時の停止

X投稿側でキー欠落・取得失敗・認証失敗を停止条件にした。Secret Manager全体のスキーマを変更したものではなく、他の利用箇所の仕様は維持する。

### 代替案 B: Firestore への暗号化保存（Web UI 連携向け）
* **アプローチ**: 認証情報を Secret Manager ではなく、Firestore の `podcasts/{podcast_id}` ドキュメント内に暗号化フィールドとして格納します。
  * **暗号化手法**: GCP KMS (Key Management Service) を用いてデータをエンベロープ暗号化した上で Firestore に保存します。
  * **メリット**: Web UI 側から Firestore を経由して動的に認証情報を登録・編集できるようになるため、GCPインフラ管理者の手動作業が完全に不要になります。

### 代替案 C: 単一の JSON マッピングシークレットの運用
* **アプローチ**: チャンネルごとに Secret Manager のリソースを分けるのではなく、単一のシークレット（例: `podcast-channels-secrets`）の中に、以下のような全チャンネルのマッピング構造を持たせます。
  ```json
  {
    "channel_a": { "x_api_key": "...", ... },
    "channel_b": { "x_api_key": "...", ... }
  }
  ```
  * **メリット**: GCP 上の Secret Manager のリソース数が 1 つで済むため、API 呼び出しの集約や IAM 権限の管理が極めてシンプルになります。
  * **デメリット**: 1つのチャンネルの設定を更新する際にシークレット全体を書き換える必要があるため、他のチャンネルの設定を誤って上書き・破損してしまうオペレーションミスが発生しやすくなります。
