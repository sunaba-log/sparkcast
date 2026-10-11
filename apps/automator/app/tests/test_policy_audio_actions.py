"""Source-coordinate editing and evidence alignment regression tests."""

import pytest
from pydub.generators import Sine

from domain.models.director import PolicyFinding, UtteranceChunk
from domain.models.transcript import TranscriptSegment, TranscriptWord, align_words
from infrastructure.speech_transcriber import Word, words_to_segments
from services.audio_policy_editor import PolicyAudioEdit, export_audio, render_policy_audio
from services.policy_edit_plan import remap_policy_segments
from services.voiced_audio import TimeMap, remap_segments


def tone(frequency, duration=1000):
    return Sine(frequency).to_audio_segment(duration=duration).set_frame_rate(48000)


def test_multiple_edits_use_original_coordinates_and_remove_original_samples():
    source = tone(300) + tone(500) + tone(700) + tone(900)
    replacement = export_audio(tone(1100, 500), "wav")
    rendered, timeline = render_policy_audio(
        source, [PolicyAudioEdit(1000, 2000, "cut"), PolicyAudioEdit(3000, 4000, "replace", replacement)]
    )
    assert len(rendered) == 2500
    assert rendered[1100:1800].raw_data == source[2100:2800].raw_data
    assert rendered[2050:2450].raw_data == tone(1100, 500)[50:450].raw_data
    assert timeline[-1]["outputStartMs"] == 2000
    assert timeline[-1]["outputEndMs"] == 2500


def test_silence_preserves_duration_and_has_no_original_audio():
    source = tone(300, 3000)
    rendered, _ = render_policy_audio(source, [PolicyAudioEdit(1000, 2000, "silence")])
    assert len(rendered) == len(source)
    assert rendered[1000:2000].rms == 0
    assert rendered[100:900].raw_data == source[100:900].raw_data


@pytest.mark.parametrize(
    "edits",
    [
        [PolicyAudioEdit(0, 2000, "cut"), PolicyAudioEdit(1000, 3000, "silence")],
        [PolicyAudioEdit(-1, 100, "cut")],
        [PolicyAudioEdit(10, 10, "cut")],
        [PolicyAudioEdit(1, 3001, "cut")],
        [PolicyAudioEdit(1, 100, "replace")],
    ],
)
def test_invalid_or_conflicting_edits_fail_closed(edits):
    with pytest.raises(ValueError, match=r"ranges|Replacement"):
        render_policy_audio(tone(300, 3000), edits)


def test_insertion_and_cut_share_original_timeline():
    rendered, timeline = render_policy_audio(
        tone(300, 3000),
        [PolicyAudioEdit(500, 500, "insert", export_audio(tone(900, 250), "wav")), PolicyAudioEdit(1000, 2000, "cut")],
    )
    assert len(rendered) == 2250
    assert next(piece for piece in timeline if piece["kind"] == "cut")["outputStartMs"] == 1250


def test_pii_retains_only_its_word_range_with_repeated_text():
    segment = words_to_segments([Word("電話", 1, 2), Word("09012345678", 2, 4), Word("電話", 4, 5)])[0]
    chunk = UtteranceChunk.from_segments([segment])[0]
    at = chunk.text.index("09012345678")
    finding = PolicyFinding.create(
        chunk=chunk, category="pii", source="presidio", policy_version="v1", char_start=at, char_end=at + 11
    )
    assert (finding.start_ms, finding.end_ms) == (2000, 4000)
    assert finding.evidence_text == "09012345678"
    assert finding.word_ids == ("seg_00001:w0001",)


def test_word_times_survive_condensed_track_remapping():
    segment = TranscriptSegment(1, 2, "電話", words=(TranscriptWord("電話", 1, 2),))
    [remapped] = remap_segments([segment], TimeMap(((0, 10, 5),)))
    assert remapped.words[0].start == 11
    assert remapped.words[0].end == 12


def test_repeated_word_mapping_and_nfkc():
    words = align_words(
        "\uff21\uff22 電話 電話",
        (TranscriptWord("AB", 0, 1), TranscriptWord("電話", 1, 2), TranscriptWord("電話", 2, 3)),
    )
    assert [(w.char_start, w.char_end) for w in words] == [(0, 2), (3, 5), (6, 8)]


def test_rendered_transcript_excludes_cut_evidence_and_includes_replacement():
    segment = words_to_segments([Word("公開", 0, 1), Word("秘密", 1, 2), Word("続き", 2, 3)])[0]
    source = tone(300, 3000)
    _, timeline = render_policy_audio(
        source, [PolicyAudioEdit(1000, 2000, "replace", export_audio(tone(500, 500), "wav"))]
    )
    segments = remap_policy_segments(
        [segment], timeline, {"operations": [{"startMs": 1000, "replacementTranscript": "伏せます"}]}
    )
    assert "秘密" not in "".join(s.text for s in segments)
    assert [s.text for s in segments] == ["公開", "伏せます", "続き"]
    assert segments[-1].start == 1.5


def test_word_crossing_condensed_gap_is_not_treated_as_exact():
    segment = TranscriptSegment(0.9, 1.6, "電話", words=(TranscriptWord("電話", 0.9, 1.6),))
    [remapped] = remap_segments([segment], TimeMap(((0, 10, 1), (1.5, 20, 1))))
    assert remapped.words[0].timing_confident is False


def test_sentence_split_keeps_the_correct_repeated_word_ids():
    words = align_words(
        "電話です。電話です。",
        (
            TranscriptWord("電話", 0, 1),
            TranscriptWord("です", 1, 2),
            TranscriptWord("電話", 2, 3),
            TranscriptWord("です", 3, 4),
        ),
    )
    chunks = UtteranceChunk.from_segments([TranscriptSegment(0, 4, "電話です。電話です。", words=words)])
    assert [w.word_id for w in chunks[0].words] == ["seg_00001:w0000", "seg_00001:w0001"]
    assert [w.word_id for w in chunks[1].words] == ["seg_00001:w0002", "seg_00001:w0003"]
