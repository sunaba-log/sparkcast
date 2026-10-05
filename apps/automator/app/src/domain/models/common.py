"""Shared domain models."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from pydantic import BaseModel, Field

if TYPE_CHECKING:
    from datetime import datetime


class Summary(BaseModel):
    """Structured summary for transcript output."""

    title: str = Field(..., description="Episode title")
    description: str = Field(..., description="Episode description")


class SpeakerAssignment(BaseModel):
    """1 つの発話の話者."""

    id: int = Field(..., description="発話の番号")
    speaker: str = Field(..., description="話者名")


class SpeakerAssignments(BaseModel):
    """発話ごとの話者."""

    assignments: list[SpeakerAssignment] = Field(..., description="発話ごとの話者")


class SnsPromotionContent(BaseModel):
    """SNS promotion message and hashtags."""

    message: str = Field(..., description="SNS promotion message text.")
    hashtags: list[str] = Field(..., description="Relevant hashtags.")


class SnsPromotionsResponse(BaseModel):
    """Multiple SNS promotion contents."""

    promotions: list[SnsPromotionContent] = Field(..., description="List of generated promotions.")


@dataclass
class NewsItem:
    """News item fetched from feeds."""

    title: str
    url: str
    source: str
    published_at: datetime
    summary: str | None = None


@dataclass
class DiscordMessage:
    """Discord channel message."""

    id: str
    content: str
    timestamp: str
    author_name: str
