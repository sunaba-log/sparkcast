# Episode Upload Contract

## Scope

`podcast-ui` creates the Cloud SQL episode record and issues a signed GCS upload URL.
The browser uploads the source audio directly to GCS. A GCS finalize event starts
`podcast-automator`.

## API

`POST /api/episodes/upload-url`

Request:

```json
{
  "podcastId": 1,
  "title": "Optional provisional title",
  "description": "Optional description",
  "fileName": "recording.m4a",
  "contentType": "audio/mp4",
  "fileSize": 123456
}
```

Response (`201`):

```json
{
  "episodeId": 42,
  "podcastId": 1,
  "objectPath": "podcasts/1/episodes/42/source/recording.m4a",
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
- The file extension must be `.mp3` or `.m4a`.
- The API validates the requested `Content-Type`. Supported values are
  `audio/mpeg`, `audio/mp4`, `audio/x-m4a`, and `audio/m4a`.
- The signed URL is not bound to a specific `Content-Type`, because browsers and
  operating systems may report M4A files with different audio MIME values. The
  browser should still send the validated `Content-Type` on the PUT request.

`podcast-automator` must parse `podcast_id` and `episode_id` from this path and
use them when updating Cloud SQL and writing Firestore generated content.

## Database Behavior

The API inserts an `episodes` record with `status = upload_pending` and stores
the GCS object path in `source_audio_path` before returning the signed URL. If
URL signing fails, the database transaction is rolled back.

`title` is optional at upload time. When omitted, `podcast-ui` stores a
provisional title derived from the source filename because `episodes.title` is
non-null. `podcast-automator` overwrites it with the AI-generated title when it
marks the episode `completed`.

After the browser PUT:

- success: `POST /api/episodes/{episode_id}/upload-result` with `status=uploaded`
- failure: the same endpoint with `status=failed` and an error summary

The update only applies while the current state is `upload_pending`. If the GCS
finalize event has already moved the episode to `processing`, the browser
callback cannot move it backwards.

The initial migration assumes that the `podcasts` table defined in
`docs/schemas/episode-firestore-schema-spec.md` already exists.

## Current Constraints

- The API accepts MP3 and M4A files up to 500 MiB.
- A scheduled cleanup for browsers that close before sending the result
  callback is still required.

## Browser Recording (#166)

Episodes recorded in the browser recording room do not use the signed upload URL.
When the host finalizes a recording, `podcast-ui` creates the episode with
`status = upload_pending` and `source_audio_path =
podcasts/{podcast_id}/episodes/{episode_id}/source/recording-{session8}.flac`,
then starts the `mixer` Cloud Run Job. The mixer writes that FLAC to the same
input bucket (with `ifGenerationMatch=0`), which triggers `podcast-automator`
exactly like a browser upload, and moves the episode from `upload_pending` to
`uploaded`. FLAC is accepted only on this path; user uploads remain MP3/M4A.
See `docs/adr/20261004-browser-recording-room.md`.
