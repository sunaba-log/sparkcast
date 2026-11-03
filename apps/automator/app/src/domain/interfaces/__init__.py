"""Domain external interfaces."""

from .gateways import (
    AgendaSerializer,
    AuditTraceRecorderGateway,
    BlobSource,
    ChannelCredentials,
    DiscordTranscriptSource,
    EpisodeRepository,
    FactCheckAuditorGateway,
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
    "AuditTraceRecorderGateway",
    "BlobSource",
    "ChannelCredentials",
    "DiscordTranscriptSource",
    "EpisodeRepository",
    "FactCheckAuditorGateway",
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
