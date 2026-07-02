# Environment Variables Runbook

## Purpose

This document explains how to prepare `podcast-ui/.env.local` without sharing
real secret values, and where each value lives in the deployed environment.
Share this runbook and `.env.example`, not `.env.local`.

## Source of Truth

Deployed (Firebase App Hosting) configuration lives in `apphosting.yaml`.
Secrets are referenced from GCP Secret Manager.

| Variable | Required | Local source | Deployed source | Notes |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | Optional | Local PostgreSQL connection string | Unset on App Hosting | Use for a local DB or direct PostgreSQL connection. |
| `CLOUD_SQL_INSTANCE_CONNECTION_NAME` | Required without `DATABASE_URL` | GCP Cloud SQL instance name | `apphosting.yaml` | Format: `project:region:instance`. |
| `DB_NAME` | Required without `DATABASE_URL` | `apphosting.yaml` | `apphosting.yaml` | Cloud SQL database name. |
| `DB_USER` | Required without `DATABASE_URL` | `apphosting.yaml` | `apphosting.yaml` | Cloud SQL database user. |
| `DB_PASSWORD` | Required without `DATABASE_URL` | GCP Secret Manager | Secret Manager (`DB_PASSWORD`) | Do not paste into docs or chat. |
| `GOOGLE_CLOUD_PROJECT` | Required | GCP project ID | `apphosting.yaml` | `sunabalog-dev` or `sunabalog-prod`. |
| `DEV_ALLOWED_EMAILS` | Optional | team allowlist | `apphosting.yaml`（現在は未設定＝全アカウント許可） | Comma-separated login allowlist. Unset or empty allows all accounts. |
| `GCS_UPLOAD_BUCKET` | Required | GCS bucket name | `apphosting.yaml` | Dev and prod buckets must not be mixed. |
| `GCS_SIGNED_URL_TTL_SECONDS` | Optional | `.env.example` default | `apphosting.yaml` | Defaults to `900` seconds. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Required outside GCP only | SA key for local use | 不要（App Hosting は ADC で認証） | JSON for server-side Firebase/GCS signing credentials when running outside GCP. |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Required | Firebase Console | `apphosting.yaml` | Public Firebase Web SDK config（ビルド時に埋め込み）. |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Required | Firebase Console | `apphosting.yaml` | Dev は `sunabalog-dev.firebaseapp.com`。モバイルのリダイレクトログインを使う本番は UI ホストを指定する（下記参照）. |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Required | Firebase Console | `apphosting.yaml` | Must match the Firebase project used for auth. |
| `FIREBASE_AUTH_HELPER_DOMAIN` | Optional | Firebase project auth helper domain | `apphosting.yaml` | Defaults to `${NEXT_PUBLIC_FIREBASE_PROJECT_ID}.firebaseapp.com`. Used by Next.js rewrites for `/__/auth/*`. |
| `CRON_SECRET` | Required | generated local value | Secret Manager (`CRON_SECRET`) | Cloud Scheduler ジョブが `Authorization: Bearer` で送る値と一致させる。 |

## Current Secret Stores

- `apphosting.yaml`: non-secret runtime/build configuration for the deployed app.
- GCP Secret Manager: `podcast-ui` の `DB_PASSWORD` / `CRON_SECRET`。ほかに
  `podcast-automator` やインフラ共有のシークレット（Cloud SQL, Cloudflare R2,
  Discord, X API など）もここにある。
- GitHub Secrets: GitHub Actions secrets, mainly Discord notifications and
  deployment credentials.

`podcast-ui` local development should copy non-secret values from
`apphosting.yaml` and secret values from GCP Secret Manager.

## How to Create `.env.local`

1. Copy the template:

   ```bash
   cp .env.example .env.local
   ```

2. Fill non-secret values from `apphosting.yaml` / Firebase Console:

   ```text
   GOOGLE_CLOUD_PROJECT
   GCS_UPLOAD_BUCKET
   NEXT_PUBLIC_FIREBASE_API_KEY
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
   NEXT_PUBLIC_FIREBASE_PROJECT_ID
   FIREBASE_AUTH_HELPER_DOMAIN
   ```

3. Fill secret values from GCP Secret Manager:

   ```text
   DB_PASSWORD
   CRON_SECRET
   ```

   ローカルから Firestore / GCS 署名を使う場合のみ、SA 鍵を
   `FIREBASE_SERVICE_ACCOUNT_JSON` に設定する（App Hosting では不要）。

4. Use either `DATABASE_URL` or the Cloud SQL Connector variables.

   For local PostgreSQL, `DATABASE_URL` is usually simpler. For parity with
   the deployed environment, use:

   ```text
   CLOUD_SQL_INSTANCE_CONNECTION_NAME
   DB_NAME
   DB_USER
   DB_PASSWORD
   ```

5. Never commit `.env.local`.

## Verification

Run the normal checks after preparing environment variables:

```bash
npm run lint
npm test
npm run build
```

For upload testing, use the target environment's matching Cloud SQL database,
GCS bucket, Firebase project, and service account. Mixing dev and prod values
can create signed URLs that fail with GCS `AccessDenied`.

## Firebase Redirect Sign-In on a Custom Host

Mobile browsers may block the cross-origin storage access used by Firebase
`signInWithRedirect()` when the app is served from a host other than
`<project>.firebaseapp.com` while `authDomain` points at
`<project>.firebaseapp.com`. In that state, Google sign-in appears to
complete, but the app returns to `/login` because `getRedirectResult()` is empty
and `/api/auth/session` is never called.

If mobile redirect sign-in is needed, set `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` to
the serving host (App Hosting domain) and keep `FIREBASE_AUTH_HELPER_DOMAIN` at
the Firebase helper host. The Next.js rewrite proxies `/__/auth/*` to the
Firebase helper domain. Also make sure Firebase Auth authorized domains include
the serving host, and the Google OAuth client allows this redirect URI:

```text
https://<app-hosting-domain>/__/auth/handler
```
