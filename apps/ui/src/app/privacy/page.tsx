import type { Metadata } from "next";

// ログインなしで読めるページ（ログイン画面・収録ルームの入室画面からリンクする）。
// 書いてある内容は実装に合わせる（保存期間は infra の lifecycle、外部サービスは実際の送り先）。
export const metadata: Metadata = {
  title: "プライバシーポリシー | SparkCast",
};

const ENACTED_AT = "2026年10月6日";
const CONTACT_EMAIL = "admin@sunabalog.com";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-bold text-gray-900">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-gray-700">{children}</div>
    </section>
  );
}

function List({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-8 pb-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-gray-900">プライバシーポリシー</h1>
        <p className="text-sm leading-relaxed text-gray-700">
          sunabalog（以下「運営者」）は、SparkCast（以下「本サービス」）で取得する個人情報を、次のとおり取り扱います。
        </p>
        <p className="text-xs text-gray-500">制定日：{ENACTED_AT}</p>
      </header>

      <Section title="1. 取得する情報">
        <List
          items={[
            "アカウントの情報：Google アカウントでログインしたときのメールアドレス・名前・利用者 ID",
            "登録・アップロードした内容：番組やエピソードの情報、音声ファイル、出演者の名前、AI チャットのやりとり",
            "利用の記録：AI チャット・エピソードのアップロード・収録ルームの作成を行った日時（利用回数の上限の管理のため）",
            "収録ルームの情報：参加者の表示名、録音に同意した日時、各参加者の端末で録音した音声、ルーム内のテキストチャット",
            "Cookie と端末への保存：ログインの状態と選んでいるチャンネルを保つための Cookie、収録ルームに入り直すための情報と送信前の録音（ブラウザ内に一時的に保存）",
          ]}
        />
        <p>アクセス解析や広告のための Cookie・タグは使っていません。</p>
      </Section>

      <Section title="2. 利用目的">
        <List
          items={[
            "本サービスの提供（ログイン、エピソードの作成と配信、文字起こし・議事録・要約・SNS 投稿文の作成、AI チャット）",
            "収録ルームでの通話の中継、録音の保存とミックス、話者ごとの文字起こし",
            "利用回数の上限の管理、不正な利用の防止、障害の調査",
            "お問い合わせへの対応",
          ]}
        />
      </Section>

      <Section title="3. 収録ルームでの音声の取り扱い">
        <List
          items={[
            "招待 URL から参加する方には、録音されることへの同意をいただいてから入室していただきます。",
            "録音は各参加者の端末で行い、運営者が管理する保存先に送ります。送り終えた録音は端末から消します。",
            "録音した音声は、ミックスと文字起こしに使います。番組の運営者の判断で、編集のうえエピソードとして公開する場合があります。",
            "収録ルームの録音は 30 日で消します。テキストチャットは、ルームを閉じたときに消します。",
          ]}
        />
      </Section>

      <Section title="4. 公開される情報">
        <p>
          番組の運営者が公開したエピソードの音声・タイトル・説明は、ポッドキャストとして配信され、誰でも聞いたり読んだりできます。
        </p>
      </Section>

      <Section title="5. 外部サービスの利用">
        <p>
          本サービスは次のサービスを使っており、それぞれの役割に必要な範囲で情報を預けています。これらのサービスのサーバーは、米国など日本の外にある場合があります。
        </p>
        <List
          items={[
            "Google（Firebase Authentication、Google Cloud の Cloud Run・Cloud Storage・Firestore・Speech-to-Text・Vertex AI）：ログイン、データの保存、文字起こし、AI による要約・チャット",
            "Supabase：データベース",
            "Cloudflare：エピソードの配信、収録ルームの通話の中継と録音の保存",
            "Discord：運営者への処理状況の通知（文字起こしを含む）",
            "X（旧 Twitter）：番組の運営者が設定した場合の SNS への投稿",
          ]}
        />
      </Section>

      <Section title="6. 第三者への提供">
        <p>
          法令に基づく場合を除き、本人の同意なく個人情報を第三者に提供しません。上の外部サービスに預けるのは、本サービスの運営を任せるためであり、第三者への提供には当たりません。
        </p>
      </Section>

      <Section title="7. 保存する期間">
        <List
          items={[
            "処理のためにアップロードした音声ファイルは 30 日で、作業用のファイルは 7 日で消します。",
            "データベースのバックアップは 30 日で消します。",
            "アカウントの情報と登録した内容は、退会されるか、削除のご依頼をいただくまで保存します。",
          ]}
        />
      </Section>

      <Section title="8. 安全管理">
        <p>
          通信の暗号化、扱える人の限定、認証情報の秘密の管理などにより、個人情報の漏えい・滅失・毀損を防ぎます。
        </p>
      </Section>

      <Section title="9. 開示・訂正・削除などのご請求">
        <p>
          ご本人から、保有している個人情報の開示・訂正・追加・削除・利用の停止などのご請求があった場合は、ご本人であることを確かめたうえで、法令に従って対応します。下のお問い合わせ先までご連絡ください。
        </p>
      </Section>

      <Section title="10. 運営者・お問い合わせ先">
        <List
          items={[
            "名称：sunabalog",
            <>
              お問い合わせ：
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-brand underline">
                {CONTACT_EMAIL}
              </a>
            </>,
            "住所と代表者の氏名は、ご請求があれば遅滞なくお知らせします。",
          ]}
        />
      </Section>

      <Section title="11. 改定">
        <p>このポリシーを変えるときは、このページでお知らせします。</p>
      </Section>
    </article>
  );
}
