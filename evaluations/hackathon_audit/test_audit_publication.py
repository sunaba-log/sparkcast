"""検証1・2（automator 側）：監査・承認と公開の境界、編集後データの再混入。

[モック] 外部API・R2・RSS・Discord・Firestore はすべて記録用の代替。実送信なし。
既存テスト（tests/test_review_publication_boundary.py 等）と重複するケースは追加していない。
実行：evaluations/hackathon_audit/run-local.sh
"""

from __future__ import annotations

from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from domain.errors import ReviewIncompleteError
from domain.models import FactCheckAuditMetric, UtteranceChunk
from domain.models.director import AuditBundle, DirectorIntervention, FactVerificationResult, PolicyFinding
from domain.models.transcript import TranscriptSegment, TranscriptWord
from services.fact_verification_agent import FactVerificationAgent
from services.policy_edit_plan import remap_policy_segments
from tests.test_review_publication_boundary import _workflow

SECRET = "スイレン742"
SEG = TranscriptSegment(0, 6, f"案件コードは{SECRET}です。来週公開します。", speaker="話者A")


class BundleAuditor:
    """audit_bundle を持つ監査器の代替。呼び出しごとに用意した結果を返す."""

    def __init__(self, *runs):
        self.runs = list(runs)
        self.calls = 0

    def audit_bundle(self, chunks, *, policy):
        self.calls += 1
        metric, findings = self.runs.pop(0)
        return AuditBundle(
            fact_check_results=[(c, metric) for c in chunks],
            policy_findings=[f(c) for c in chunks for f in findings],
            traces=[],
        )


def _secret_finding(chunk):
    return PolicyFinding.create(chunk=chunk, category="confidential_information", source="presidio", policy_version="v1", entity_type="CUSTOM_TERM")


def _intervention(script: str):
    return DirectorIntervention.create(
        chunk_id="c", target_speaker="話者A", insert_timestamp_ms=6000, correction_script=script, reason="r", audit_metrics=SEVERE
    )


LOW = FactCheckAuditMetric(0.9, 1, "none")
SEVERE = FactCheckAuditMetric(0.95, 4, "numerical_data")


def _published(case) -> bool:
    return case.repository.mark_completed.called and case.storage.upload_file.called


def _case(auditor, **kw):
    case = _workflow(auditor=auditor, segments=[SEG])
    for k, v in kw.items():
        setattr(case.usecase, k, v)
    case.usecase._transcription.run.return_value = replace(case.usecase._transcription.run.return_value, minutes=SEG.text)
    return case


def test_v1_01_publish_original_job_skips_audit_and_requires_all_rejected():
    """V1-01 原音声公開ジョブは監査を飛ばす。修正後（I-05）は保存済みの判断がすべて却下のときだけ公開する（拒否側は apps のテストで確認）."""
    auditor = BundleAuditor((LOW, [_secret_finding]))
    case = _case(auditor)
    fs = case.usecase._firestore_manager
    fs.get_episode_content.return_value = {"minutes": SEG.text, "transcript_summary": f"紹介文 {SECRET}"}
    fs.get_transcript_segments.return_value = [SEG]
    fs.get_policy_findings.return_value = [{"status": "rejected"}]
    fs.get_director_interventions.return_value = []
    case.usecase.run(replace(case.request, resume_from_audit=True, publish_original=True))
    assert auditor.calls == 0
    assert _published(case)
    # 原音声公開時の紹介文・SNS入力は監査前に作った要約のまま
    assert SECRET in case.usecase._transcript_provider.generate_sns_promotions.call_args.kwargs["summary_description"]


def test_v1_02_reaudit_after_earlier_review_waits_for_confirmation_instead_of_publishing():
    """V1-02（修正後 I-03）：承認待ちの後の再監査で指摘が出なくても、以前の確認事項を履歴に残し、公開の確認待ちにする.

    修正前は前回の未判断の指摘を空で上書きして自動公開した（evidence/before）。
    """
    auditor = BundleAuditor((LOW, [_secret_finding]), (LOW, []))
    case = _case(auditor)
    fs = case.usecase._firestore_manager
    fs.archive_review.return_value = False
    case.usecase.run(case.request)
    assert not _published(case)
    case.repository.mark_awaiting_approval.assert_called()
    fs.get_episode_content.return_value = {"minutes": SEG.text, "transcript_summary": "s"}
    fs.get_transcript_segments.return_value = [SEG]
    fs.archive_review.return_value = True  # 1回目の指摘が残っている
    case.usecase.run(replace(case.request, resume_from_audit=True))
    assert not _published(case)
    case.repository.mark_awaiting_publish_confirmation.assert_called_once()


def _verification(is_false: bool):
    return FactVerificationResult(claim="c", ground_truth="g", sources=(), is_false=is_false, reason="r")


def test_v1_03_verification_true_skips_human_review_and_publishes():
    """V1-03 Jev が要訂正と判定しても、Gemini 裏取りが『正しい』なら訂正案を作らず、人の確認なしで公開される."""
    agent = MagicMock()
    agent.verify_chunk.return_value = _verification(is_false=False)
    case = _case(BundleAuditor((SEVERE, [])), _fact_verification_agent=agent)
    case.usecase.run(case.request)
    case.usecase._director_script_generator.generate_intervention.assert_not_called()
    assert _published(case)


def test_v1_04_verification_failure_still_creates_proposal_without_evidence():
    """V1-04 裏取りが失敗（None）しても停止せず、根拠なしで訂正案を作り承認待ちにする."""
    agent = MagicMock()
    agent.verify_chunk.return_value = None
    case = _case(BundleAuditor((SEVERE, [])), _fact_verification_agent=agent)
    director = case.usecase._director_script_generator
    director.generate_intervention.return_value = _intervention("訂正です")
    case.usecase.run(case.request)
    assert director.generate_intervention.call_args.kwargs["verification"] is None
    case.repository.mark_awaiting_approval.assert_called()
    assert not _published(case)


@pytest.mark.parametrize("result", [None, "empty"])
def test_v1_05_correction_generation_failure_stops(result):
    """V1-05 訂正案の生成失敗・空文は公開停止."""
    case = _case(BundleAuditor((SEVERE, [])))
    director = case.usecase._director_script_generator
    director.generate_intervention.return_value = (
        None
        if result is None
        else _intervention(" ")
    )
    with pytest.raises(ReviewIncompleteError):
        case.usecase.run(case.request)
    assert not _published(case)


def test_v1_06_director_disabled_with_severe_finding_stops():
    """V1-06 訂正生成が無効で要訂正がある場合は公開停止."""
    case = _case(BundleAuditor((SEVERE, [])), _director_script_generator=None)
    with pytest.raises(ReviewIncompleteError):
        case.usecase.run(case.request)
    assert not _published(case)


@pytest.mark.parametrize(
    ("judgment", "expected_is_false"),
    [("誤り", True), ("正しい", False), ("判断不能", True), ("概ね正しい", False), ("正しい（ただし数値は誤り）", True), ("", True)],
)
def test_v1_07_verification_judgment_parsing(judgment, expected_is_false):
    """V1-07 裏取り結果の判定文の解釈。『概ね正しい』は正しい扱いで訂正案が作られない。判定欠落は誤り扱い."""
    text = f"【命題】c\n【判定】{judgment}\n【正しい事実】g\n【理由】r" if judgment else "自由形式の回答"
    client = MagicMock()
    client.models.generate_content.return_value = SimpleNamespace(text=text, candidates=[])
    agent = FactVerificationAgent(client=client)
    chunk = UtteranceChunk("c", "A", 0, 1, "x")
    assert agent.verify_chunk(chunk=chunk, metric=SEVERE, all_chunks=[chunk]).is_false is expected_is_false


def test_v2_01_discord_receives_full_transcript_before_audit():
    """V2-01 監査より前に、機密語を含む議事録全文と紹介文が Discord 通知へ送られる."""
    auditor = BundleAuditor((LOW, [_secret_finding]))
    case = _case(auditor)
    case.usecase._transcript_provider.summarize_transcript.return_value = SimpleNamespace(title="t", description=f"紹介文 {SECRET}")
    case.usecase.run(case.request)
    messages = [c.kwargs["message"] for c in case.usecase._notifier.send_discord_message.call_args_list]
    assert any(SECRET in m for m in messages[:2])
    assert not _published(case)


def test_v2_02_interim_metadata_contains_secret_before_review():
    """V2-02 承認待ちの間も、監査前の紹介文（機密語を含む）が SQL と Firestore に保存される（公開はされない）."""
    case = _case(BundleAuditor((LOW, [_secret_finding])))
    case.usecase._transcript_provider.summarize_transcript.return_value = SimpleNamespace(title="t", description=f"紹介文 {SECRET}")
    case.usecase.run(case.request)
    assert SECRET in case.repository.update_metadata.call_args.kwargs["description"]
    assert SECRET in case.usecase._firestore_manager.save_episode_content.call_args.kwargs["minutes"]
    assert not _published(case)


def _words(*items):
    return tuple(TranscriptWord(t, s, e) for t, s, e in items)


def test_v2_03_remap_drops_straddling_word_text_but_audio_keeps_remainder():
    """V2-03 編集範囲が単語の途中で切れると、その単語は文字起こしから消えるが、範囲外の音は残る（文字と音の不一致）."""
    seg = TranscriptSegment(0, 3, f"コード{SECRET}です", words=_words(("コード", 0.0, 1.0), (SECRET, 1.0, 2.2), ("です", 2.2, 3.0)))
    timeline = [
        {"sourceStartMs": 0, "sourceEndMs": 1200, "outputStartMs": 0, "outputEndMs": 1200, "kind": "original"},
        {"sourceStartMs": 1200, "sourceEndMs": 2200, "outputStartMs": 1200, "outputEndMs": 1200, "kind": "cut"},
        {"sourceStartMs": 2200, "sourceEndMs": 3000, "outputStartMs": 1200, "outputEndMs": 2000, "kind": "original"},
    ]
    text = "".join(s.text for s in remap_policy_segments([seg], timeline, {"operations": []}))
    assert SECRET not in text  # 文字起こし上は削除済み
    # 1.0〜1.2秒（機密語の先頭 0.2秒）の音声は timeline 上 original として残る
    assert timeline[0]["sourceEndMs"] > 1000


def test_v2_04_edited_path_regenerates_summary_and_sns_from_edited_text(monkeypatch):
    """V2-04 編集計画の公開では、議事録・紹介文・SNS案を編集後の文字起こしから再生成する（削除語の再混入なし）."""
    case = _case(MagicMock())
    fs = case.usecase._firestore_manager
    fs.get_episode_content.return_value = {"minutes": SEG.text, "transcript_summary": f"紹介文 {SECRET}"}
    seg = TranscriptSegment(0, 3, f"前{SECRET}後", words=_words(("前", 0, 1), (SECRET, 1, 2), ("後", 2, 3)))
    fs.get_transcript_segments.return_value = [seg]
    provider = case.usecase._transcript_provider
    provider.generate_minutes.side_effect = lambda text, *_a, **_k: f"議事録:{text}"
    provider.summarize_transcript.side_effect = lambda text, **_k: SimpleNamespace(title="t", description=f"紹介:{text}")
    timeline = [
        {"sourceStartMs": 0, "sourceEndMs": 1000, "outputStartMs": 0, "outputEndMs": 1000, "kind": "original"},
        {"sourceStartMs": 1000, "sourceEndMs": 2000, "outputStartMs": 1000, "outputEndMs": 1000, "kind": "cut"},
        {"sourceStartMs": 2000, "sourceEndMs": 3000, "outputStartMs": 1000, "outputEndMs": 2000, "kind": "original"},
    ]
    monkeypatch.setattr("usecases.process_podcast_workflow.apply_saved_policy_plan", lambda *_a: (b"mp3", timeline, {"operations": []}))
    monkeypatch.setattr("usecases.process_podcast_workflow.finish_policy_plan", MagicMock())
    case.usecase.run(replace(case.request, edit_plan_id="plan", resume_from_audit=True))
    assert SECRET not in provider.summarize_transcript.call_args.args[0]
    assert SECRET not in provider.generate_sns_promotions.call_args.kwargs["summary_description"]
    assert SECRET not in case.repository.mark_completed.call_args.kwargs["description"]
    # 最終通知も編集後のタイトルのみ
    final = case.usecase._notifier.send_discord_message.call_args_list[-1].kwargs["message"]
    assert SECRET not in final


def test_v2_05_correction_script_is_inserted_without_policy_recheck(monkeypatch):
    """V2-05 承認済み訂正案の台詞（利用者が編集可能）は、編集計画の適用時に機密語・PIIの再検査を受けずに合成・挿入される."""
    import services.policy_edit_plan as plan_mod

    synthesized = []
    monkeypatch.setattr(plan_mod, "DirectorVoiceSynthesizer", lambda: SimpleNamespace(synthesize=lambda text: synthesized.append(text) or _mp3()))
    seg = TranscriptSegment(0, 1, "原文", words=_words(("原文", 0, 1)))
    plan = {"operations": [], "corrections": [{"startMs": 500, "script": f"訂正：{SECRET}"}]}
    # 適用処理と同じ部品（合成→挿入→文字起こしの再配置）を、記録用の合成器で実行する
    from pydub import AudioSegment

    from services.audio_policy_editor import PolicyAudioEdit, export_audio, render_policy_audio

    wav = export_audio(AudioSegment.from_file(__import__("io").BytesIO(plan_mod.DirectorVoiceSynthesizer().synthesize(plan["corrections"][0]["script"])), format="mp3"), "wav")
    _audio, timeline = render_policy_audio(AudioSegment.silent(1000), [PolicyAudioEdit(500, 500, "insert", wav)])
    text = "".join(s.text for s in remap_policy_segments([seg], timeline, plan))
    assert synthesized == [f"訂正：{SECRET}"]
    assert SECRET in text


def _mp3() -> bytes:
    import io

    from pydub import AudioSegment

    out = io.BytesIO()
    AudioSegment.silent(300).export(out, format="mp3")
    return out.getvalue()
