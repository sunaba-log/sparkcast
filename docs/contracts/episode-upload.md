# Episode Upload Contract

## Scope

`podcast-ui` creates the Cloud SQL episode record and issues a signed GCS upload URL.
The browser uploads the MP3 directly to GCS. A GCS finalize event starts
`podcast-automator`.

## API

`POST /api/episodes/upload-url`

Request:

```json
{
  "podcastId": 1,
  "title": "Episode title",
  "description": "Optional description",
  "fileName": "recording.mp3",
  "contentType": "audio/mpeg",
  "fileSize": 123456
}
```

Response (`201`):

```json
{
  "episodeId": 42,
  "podcastId": 1,
  "objectPath": "podcasts/1/episodes/42/source/recording.mp3",
  "uploadUrl": "https://storage.googleapis.com/...",
  "expiresAt": "2026-06-12T00:15:00.000Z"
}
```

## GCS Object Path Contract

```text
podcasts/{podcast_id}/episodes/{episode_id}/source/{filename}
```

- `podcast_id` and `episode_id` are positive Cloud SQL integer IDs.
- `filename` is reduced to its basename and sanitized to ASCII letters, numbers,
  `.`, `_`, and `-`.
- The file extension is always `.mp3`.
- The upload request must use `Content-Type: audio/mpeg`.

`podcast-automator` must parse `podcast_id` and `episode_id` from this path and
use them when updating Cloud SQL and writing Firestore generated content.

## Database Behavior

The API inserts an `episodes` record and stores the GCS object path in
`audio_file_path` before returning the signed URL. If URL signing fails, the
database transaction is rolled back.

The initial migration assumes that the `podcasts` table defined in
`docs/schemas/episode-firestore-schema-spec.md` already exists.

## Current Constraints

- Authentication and podcast ownership authorization are not implemented yet.
- The API accepts MP3 files up to 500 MiB.
- If the browser receives a signed URL but the subsequent GCS PUT fails, the
  episode record remains. A later task must add upload state and abandoned
  upload cleanup.

