// マイクを使えなかったときの案内（#166）。端末とブラウザで、許可を直す場所が違う。

export type MicEnvironment =
  | "ios-chrome"
  | "ios-safari"
  | "ios-other"
  | "android-chrome"
  | "android-other"
  | "mac-safari"
  | "desktop-chrome"
  | "desktop-firefox"
  | "desktop-other";

export function detectMicEnvironment(userAgent: string, maxTouchPoints = 0): MicEnvironment {
  // iPadOS の Safari は Mac と同じ UA を名乗るので、タッチ点の数で見分ける
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  if (ios) {
    if (/CriOS/.test(userAgent)) return "ios-chrome";
    if (/FxiOS|EdgiOS|OPiOS/.test(userAgent)) return "ios-other";
    return "ios-safari";
  }
  if (/Android/.test(userAgent)) {
    return /Chrome\//.test(userAgent) && !/EdgA|SamsungBrowser|OPR/.test(userAgent) ? "android-chrome" : "android-other";
  }
  if (/Firefox\//.test(userAgent)) return "desktop-firefox";
  if (/Chrome\/|Chromium\/|Edg\//.test(userAgent)) return "desktop-chrome";
  if (/Macintosh/.test(userAgent) && /Safari\//.test(userAgent)) return "mac-safari";
  return "desktop-other";
}

export type MicHelp = {
  // 何が起きたか（1 文）
  message: string;
  // 直し方（順番どおりに並べる）
  steps: string[];
};

const SITE_STEPS: Record<MicEnvironment, string[]> = {
  "ios-chrome": [
    "iPhone の「設定」を開き、「Chrome」（iOS 18 以降は「アプリ」→「Chrome」）の「マイク」をオンにする",
    "Chrome に戻り、下の「もう一度試す」を押す。マイクの確認が出たら「許可」を押す",
  ],
  "ios-safari": [
    "アドレスバーの「ぁあ」（または「大小」）を押し、「Web サイトの設定」→「マイク」を「確認」か「許可」にする",
    "下の「もう一度試す」を押す。マイクの確認が出たら「許可」を押す",
    "それでも使えないときは、iPhone の「設定」→「アプリ」→「Safari」→「マイク」を「確認」にする",
  ],
  "ios-other": [
    "iPhone の「設定」で、使っているブラウザのアプリの「マイク」をオンにする",
    "ブラウザに戻り、下の「もう一度試す」を押す。うまくいかないときは Safari で開き直す",
  ],
  "android-chrome": [
    "アドレスバーの左のアイコンを押し、「権限」→「マイク」を許可する",
    "それでも使えないときは、端末の「設定」→「アプリ」→「Chrome」→「権限」→「マイク」を許可する",
    "下の「もう一度試す」を押す",
  ],
  "android-other": [
    "ブラウザのサイトの設定で、このサイトのマイクを許可する",
    "端末の「設定」→「アプリ」で、使っているブラウザのマイクの権限を許可する",
    "下の「もう一度試す」を押す。うまくいかないときは Chrome で開き直す",
  ],
  "mac-safari": [
    "メニューの「Safari」→「設定」→「Web サイト」→「マイク」で、このサイトを「許可」にする",
    "下の「もう一度試す」を押す",
  ],
  "desktop-chrome": [
    "アドレスバーの左のアイコン（サイト情報）を押し、「マイク」を許可する",
    "下の「もう一度試す」を押す（出てこないときはページを再読み込みする）",
  ],
  "desktop-firefox": [
    "アドレスバーの左のマイクのアイコンを押し、ブロックを解除する",
    "下の「もう一度試す」を押す",
  ],
  "desktop-other": [
    "ブラウザのサイトの設定で、このサイトのマイクを許可する",
    "下の「もう一度試す」を押す",
  ],
};

function systemSteps(environment: MicEnvironment, mac: boolean): string[] {
  if (environment.startsWith("ios") || environment.startsWith("android")) return SITE_STEPS[environment];
  if (mac) {
    return [
      "Mac の「システム設定」→「プライバシーとセキュリティ」→「マイク」で、使っているブラウザをオンにする",
      "ブラウザを一度終了して開き直し、このページをもう一度開く",
    ];
  }
  return [
    "パソコンの設定（Windows は「設定」→「プライバシーとセキュリティ」→「マイク」）で、ブラウザのマイクの使用を許可する",
    "ブラウザを開き直し、下の「もう一度試す」を押す",
  ];
}

// getUserMedia が失敗したときの案内
export function micHelpFor(error: unknown, environment: MicEnvironment, { mac = false } = {}): MicHelp {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  const detail = error instanceof Error ? error.message : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    // Chrome は OS がブラウザにマイクを許していないとき「Permission denied by system」になる
    if (/system/i.test(detail)) {
      return { message: "パソコンの設定で、このブラウザにマイクの使用が許可されていません。", steps: systemSteps(environment, mac) };
    }
    return { message: "マイクの使用が許可されていません。", steps: SITE_STEPS[environment] };
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return {
      message: "マイクが見つかりませんでした。",
      steps: ["マイク（イヤホンのマイクを含む）がつながっているか確かめる", "下の「もう一度試す」を押す"],
    };
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return {
      message: "マイクを開けませんでした。ほかのアプリやタブがマイクを使っている可能性があります。",
      steps: [
        "Zoom・Discord など、マイクを使うほかのアプリや、この収録ルームを開いたほかのタブを閉じる",
        "下の「もう一度試す」を押す",
      ],
    };
  }
  return { message: "マイクを使えませんでした。", steps: ["マイクがつながっているか確かめ、下の「もう一度試す」を押す"] };
}
