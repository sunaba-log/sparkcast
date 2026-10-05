"""ブラウザ収録(#166)の状態を Postgres に書く."""

from __future__ import annotations

import psycopg


class PostgresRecordingRepository:
    """recording_sessions / recording_tracks / episodes の更新."""

    def __init__(self, *, database_url: str) -> None:
        """Initialize the repository."""
        self._database_url = database_url

    def set_aligned_track(self, *, session_id: str, participant_id: str, object_key: str) -> None:
        """話者別の位置合わせ済みトラックの R2 キーを記録する."""
        with psycopg.connect(self._database_url) as connection:
            connection.execute(
                """
                INSERT INTO recording_tracks (session_id, participant_id, kind, aligned_object_key)
                VALUES (%s, %s, 'local', %s)
                ON CONFLICT (session_id, participant_id, kind)
                DO UPDATE SET aligned_object_key = EXCLUDED.aligned_object_key, updated_at = now()
                """,
                (session_id, participant_id, object_key),
            )

    def mark_episode_uploaded(self, *, episode_id: str) -> None:
        """ミックスを置いたことを記録する(既存パイプラインが先に進めていれば何もしない)."""
        with psycopg.connect(self._database_url) as connection:
            connection.execute(
                """
                UPDATE episodes SET status = 'uploaded', updated_at = now()
                WHERE episode_id = %s AND status = 'upload_pending'
                """,
                (episode_id,),
            )

    def mark_session_done(self, *, session_id: str) -> None:
        """セッションを完了にする."""
        with psycopg.connect(self._database_url) as connection:
            connection.execute(
                """
                UPDATE recording_sessions SET status = 'done', error = NULL, updated_at = now()
                WHERE session_id = %s AND status = 'mixing'
                """,
                (session_id,),
            )

    def mark_failed(self, *, session_id: str, episode_id: str, error: str) -> None:
        """セッションとエピソードを失敗にする."""
        message = error[:2000]
        with psycopg.connect(self._database_url) as connection:
            connection.execute(
                """
                UPDATE recording_sessions SET status = 'failed', error = %s, updated_at = now()
                WHERE session_id = %s AND status = 'mixing'
                """,
                (message, session_id),
            )
            connection.execute(
                """
                UPDATE episodes
                SET status = 'failed', processing_error = %s, processing_completed_at = now(), updated_at = now()
                WHERE episode_id = %s AND status = 'upload_pending'
                """,
                (f"収録のミックスに失敗しました: {message}"[:2000], episode_id),
            )
