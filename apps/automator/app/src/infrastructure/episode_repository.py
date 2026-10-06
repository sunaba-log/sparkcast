"""Cloud SQL persistence for podcast episode processing state."""

from __future__ import annotations

from typing import Any

import psycopg

from domain.interfaces import RecordingSpeaker, RecordingSpeakers


class PostgresEpisodeRepository:
    """Update episode records through a PostgreSQL connection string."""

    def __init__(self, *, database_url: str) -> None:
        """Initialize the repository."""
        self._database_url = database_url

    def mark_processing(self, *, podcast_id: str, episode_id: str, source_audio_path: str) -> None:
        """Mark an uploaded episode as processing."""
        self._execute_update(
            """
            UPDATE episodes
            SET status = 'processing',
                source_audio_path = COALESCE(source_audio_path, %s),
                processing_error = NULL,
                processing_started_at = now(),
                updated_at = now()
            WHERE podcast_id = %s AND episode_id = %s
            """,
            (source_audio_path, podcast_id, episode_id),
            podcast_id=podcast_id,
            episode_id=episode_id,
        )

    def mark_completed(
        self,
        *,
        podcast_id: str,
        episode_id: str,
        title: str,
        description: str,
        audio_url: str,
        duration_seconds: int | None,
    ) -> None:
        """Store generated metadata and mark an episode complete."""
        self._execute_update(
            """
            UPDATE episodes
            SET status = 'completed',
                title = %s,
                description = %s,
                audio_file_path = %s,
                duration_seconds = %s,
                processing_error = NULL,
                processing_completed_at = now(),
                published_at = COALESCE(published_at, now()),
                updated_at = now()
            WHERE podcast_id = %s AND episode_id = %s
            """,
            (title, description, audio_url, duration_seconds, podcast_id, episode_id),
            podcast_id=podcast_id,
            episode_id=episode_id,
        )

    def mark_failed(self, *, podcast_id: str, episode_id: str, error_message: str) -> None:
        """Record a processing failure."""
        self._execute_update(
            """
            UPDATE episodes
            SET status = 'failed',
                processing_error = %s,
                processing_completed_at = now(),
                updated_at = now()
            WHERE podcast_id = %s AND episode_id = %s
            """,
            (error_message[:2000], podcast_id, episode_id),
            podcast_id=podcast_id,
            episode_id=episode_id,
        )

    def mark_auditing(self, *, podcast_id: str, episode_id: str) -> None:
        """Mark an episode as auditing."""
        self._execute_update(
            """
            UPDATE episodes
            SET status = 'auditing',
                updated_at = now()
            WHERE podcast_id = %s AND episode_id = %s
            """,
            (podcast_id, episode_id),
            podcast_id=podcast_id,
            episode_id=episode_id,
        )

    def mark_awaiting_approval(self, *, podcast_id: str, episode_id: str) -> None:
        """Mark an episode as awaiting approval for director interventions."""
        self._execute_update(
            """
            UPDATE episodes
            SET status = 'awaiting_approval',
                processing_error = NULL,
                updated_at = now()
            WHERE podcast_id = %s AND episode_id = %s
            """,
            (podcast_id, episode_id),
            podcast_id=podcast_id,
            episode_id=episode_id,
        )

    def get_cast_names(self, *, podcast_id: str) -> list[str]:
        """番組設定の登場人物(改行・読点・カンマ区切り)を返す。未設定なら空."""
        with psycopg.connect(self._database_url) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT cast_members FROM podcasts WHERE podcast_id = %s", (podcast_id,))
            row = cursor.fetchone()
        return split_cast_names(row[0] if row else None)

    def find_recording_speakers(self, *, episode_id: str) -> RecordingSpeakers | None:
        """ブラウザ収録(#166)で作られたエピソードなら、位置合わせ済みトラックのある参加者を返す."""
        with psycopg.connect(self._database_url) as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT s.session_id::text, p.participant_id::text, p.display_name, p.role
                FROM recording_sessions s
                JOIN recording_tracks t ON t.session_id = s.session_id AND t.kind = 'local'
                JOIN recording_participants p ON p.participant_id = t.participant_id
                WHERE s.episode_id = %s AND t.aligned_object_key IS NOT NULL
                ORDER BY p.role DESC, p.created_at
                """,
                (episode_id,),
            )
            rows = cursor.fetchall()
        if not rows:
            return None
        return RecordingSpeakers(
            session_id=rows[0][0],
            speakers=[RecordingSpeaker(participant_id=row[1], name=row[2], role=row[3]) for row in rows],
        )

    def _execute_update(
        self,
        statement: str,
        parameters: tuple[Any, ...],
        *,
        podcast_id: str,
        episode_id: str,
    ) -> None:
        with psycopg.connect(self._database_url) as connection, connection.cursor() as cursor:
            cursor.execute(statement, parameters)
            if cursor.rowcount != 1:
                msg = f"Episode not found: podcast_id={podcast_id}, episode_id={episode_id}"
                raise LookupError(msg)


def split_cast_names(raw: str | None) -> list[str]:
    """「小野、数森, 高島」や改行区切りを名前の一覧にする."""
    if not raw:
        return []
    normalized = raw.replace("、", ",").replace("\n", ",")
    return [name.strip() for name in normalized.split(",") if name.strip()]
