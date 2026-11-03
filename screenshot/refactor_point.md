## UIの修正
### `DirectorInterventionsPanel`と`PolicyFindingsPanel` におけるアクションボタンのデザイン、動作を統一したい。

- ボタンのデザインが異なる。
- 「訂正介入の判断を保存」、「すべての判断を確定」の動作の違いがわかりにくい。
- 「承認した内容でカットイン編集を実行」「承認した内容で音声編集を開始」の処理の順番は？全体で処理を確定後に編集を実行しないと再生位置に整合性が取れなくなるのではないか。

File: apps/ui/src/components/DirectorInterventionsPanel.tsx
Lines: 139-149

```ts
{editable && <button type="button" disabled={applying || state.interventions.some((i) => i.status === "pending")}
        onClick={save} className="rounded border px-4 py-2 text-sm disabled:opacity-40">訂正介入の判断を保存</button>}
      {editable && (
        <button
          type="button"
          disabled={applying || approvedCount === 0}
          onClick={apply}
          className="rounded-xs bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          {applying ? "音声編集を開始中…" : `承認した内容でカットイン編集を実行 (${approvedCount}件)`}
        </button>
```

File: apps/ui/src/components/PolicyFindingsPanel.tsx
Lines: 270-287

```ts
{editable && (
          <button
            disabled={locked || !allDecided}
            onClick={() => request("save")}
            className="rounded bg-brand px-4 py-2 text-sm text-white disabled:opacity-40"
          >
            すべての判断を確定
          </button>
        )}
        {editable && (
          <button
            disabled={locked || dirty || !allDecided}
            onClick={() => request("apply")}
            className="rounded bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-40"
          >
            承認した内容で音声編集を開始
          </button>
        )}
```

### 「推奨」を「判断根拠」のデザインに寄せる

File: apps/ui/src/components/PolicyEditProposalCard.tsx
Lines: 304-306

```ts
<p className="text-sm">
            推奨：{labels[proposal.recommendedAction]} — {proposal.reason}
          </p>
```

の部分を、

File: apps/ui/src/components/DirectorInterventionCard.tsx

```ts
<div className="rounded-xs border border-blue-100 bg-blue-50/60 p-3 text-xs text-blue-950 space-y-1">
```
によせることでデザインを統一したい。


### 対象範囲を再生、前後を含めて再生のボタンをアイコンに変更し、Tooltipに説明を表示
以下該当箇所の変更。

File: apps/ui/src/components/PolicyEditProposalCard.tsx
Lines: 346-365

```ts
<div className="flex flex-wrap gap-2">
              <button
                className={button}
                disabled={
                  !canSeek || !onPlayRange || proposal.start >= proposal.end
                }
                onClick={() => onPlayRange?.(proposal.start, proposal.end)}
              >
                対象範囲を再生
              </button>
              <button
                className={button}
                disabled={!canSeek || !onPlayRange}
                onClick={() =>
                  onPlayRange?.(Math.max(0, proposal.start - 2), proposal.end + 2)
                }
              >
                前後を含めて再生
              </button>
            </div>
```
および

File: apps/ui/src/components/DirectorInterventionCard.tsx
Lines: 357-376

```ts
<div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={actionButton}
                disabled={!canSeek || !onPlayRange || start >= end}
                onClick={() => onPlayRange?.(start, end)}
              >
                対象範囲を再生
              </button>
              <button
                type="button"
                className={actionButton}
                disabled={!canSeek || !onPlayRange}
                onClick={() =>
                  onPlayRange?.(Math.max(0, start - 2), end + 2)
                }
              >
                前後を含めて再生
              </button>
            </div>
```

### `DirectorInterventionCard`および`PolicyEditProposalCard`内の文字の大きさを`text-xs`に統一。

File: apps/ui/src/components/DirectorInterventionCard.tsx
Lines: 286-294

```ts
{isExpanded && (
        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-gray-100">
          <div>
            <p className="text-xs font-bold text-gray-900 mb-1">
              {intervention.speaker || "話者"}の発話
            </p>
            <p className="text-sm text-gray-800 leading-relaxed">
              {intervention.sourceText}
            </p>
```

File: apps/ui/src/components/PolicyEditProposalCard.tsx
Lines: 294-295

```ts
<div className="space-y-3 border-t p-4">
          {proposal.findings.map((finding) => (
```

### ファクトチェックの発言ソースは括弧で囲う

以下、`「{intervention.sourceText}」`に変更。

File: apps/ui/src/components/DirectorInterventionCard.tsx
Lines: 292-294

```ts
<p className="text-sm text-gray-800 leading-relaxed">
              {intervention.sourceText}
            </p>
```

### PolicyFindingsPanel.tsx の原音確認プレビューが必要か検討
以下箇所に関する部分だが、File: apps/ui/src/components/EpisodeMasterDetail.tsx
Lines: 777-782の元音声プレビュー（編集・合成前）で十分ではないか検討して。


`apps/ui/src/components/PolicyFindingsPanel.tsx` Lines: 187-199

```ts
 <div className="text-xs text-gray-600">
          原音声確認
          <audio
            ref={sourcePlayer}
            controls
            src={sourceAudioUrl}
            onPlay={(event) => {
              document.querySelectorAll("audio").forEach((player) => {
                if (player !== event.currentTarget) player.pause();
              });
            }}
          />
        </div>
```

### PolicyEditProposalCard.tsx の再生位置のリンク表示に関する変更
Lines: 264-271

```ts
<button
          className="font-mono text-xs text-brand"
          disabled={!canSeek}
          onClick={() => onSeek(proposal.start)}
        >
          {formatDirectorTimestamp(proposal.start)} -{" "}
          {formatDirectorTimestamp(proposal.end)}
        </button>
```

をリンク表示変更する。以下の仕様に合わせる。
File: apps/ui/src/components/DirectorInterventionCard.tsx
Lines: 254-263

```ts
<button
          type="button"
          disabled={disabled || !canSeek}
          onClick={(event) => {
            event.stopPropagation();
            if (onPlayRange) onPlayRange(start, end);
            else onSeek(start);
          }}
          className="font-mono text-xs font-semibold text-brand hover:underline disabled:cursor-default disabled:no-underline"
        >
```


### EpisodeMasterDetail.tsx のクラス修正

正確な再生位置が知りたいため、rounded-fullは削除する。

Lines: 819-822

```ts
className="bg-brand h-full rounded-full transition-all duration-100 ease-out"
style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
```

### EpisodeMasterDetail.tsx におけるMarker表示の修正

以下、マーカーにおいて、再生中のバーの進捗がマーカーにかぶるとどこを再生しているか見えなくなってしまうので、マーカーが表示されていても再生位置がわかるように修正したい。

Lines: 122-160

```ts
     {activeInterventions.map((intervention) => {
        const leftPercent = Math.min(100, Math.max(0, (intervention.insertAt / effectiveDuration) * 100));
        return (
          <button
            key={`intervention-${intervention.id}`}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onSeek(intervention.insertAt);
            }}
            title={`[ファクトチェック] ${formatTime(intervention.insertAt)}: ${intervention.category || "訂正提案"}`}
            className="absolute top-0 bottom-0 z-10 w-2 -translate-x-1/2 bg-red-600 hover:bg-red-700 ring-1 ring-white cursor-pointer transition-transform hover:scale-110"
            style={{ left: `${leftPercent}%` }}
            aria-label={`ファクトチェック ${formatTime(intervention.insertAt)}`}
          />
        );
      })}

      {activeFindings.map((finding) => {
        const leftPercent = Math.min(100, Math.max(0, (finding.start / effectiveDuration) * 100));
        const widthPercent = Math.max(
          0.8,
          ((Math.max(finding.end, finding.start + 1) - finding.start) / effectiveDuration) * 100,
        );
        return (
          <button
            key={`finding-${finding.id}`}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onSeek(finding.start);
            }}
            title={`[ポリシー監査] ${formatTime(finding.start)} - ${formatTime(finding.end)}: ${finding.category || "規約・校正"}`}
            className="absolute top-0 bottom-0 z-10 min-w-[6px] bg-[#ffb6b0] hover:bg-[#ffa099] ring-1 ring-white cursor-pointer transition-transform hover:scale-110"
            style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
            aria-label={`ポリシー監査 ${formatTime(finding.start)}`}
          />
        );
      })}
```