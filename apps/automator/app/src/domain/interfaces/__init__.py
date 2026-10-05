"""Domain external interfaces."""

from .gateways import (
    AgendaSerializer,
    BlobSource,
    ChannelCredentials,
    DiscordTranscriptSource,
    EpisodeRepository,
    NewsResearcher,
    NewsSource,
    NotificationGateway,
    ObjectStorage,
    RecordingSpeaker,
    RecordingSpeakers,
    SecretProvider,
    SpeechTranscriber,
    TranscriptProvider,
)

__all__ = [
    "AgendaSerializer",
    "BlobSource",
    "ChannelCredentials",
    "DiscordTranscriptSource",
    "EpisodeRepository",
    "NewsResearcher",
    "NewsSource",
    "NotificationGateway",
    "ObjectStorage",
    "RecordingSpeaker",
    "RecordingSpeakers",
    "SecretProvider",
    "SpeechTranscriber",
    "TranscriptProvider",
]
