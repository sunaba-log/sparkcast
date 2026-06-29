# Environment Variables Runbook

## Purpose

This document explains how to prepare `podcast-ui/.env.local` without sharing
real secret values. Share this runbook and `.env.example`, not `.env.local`.

## Source of Truth

| Variable | Required | Local source | Production/Preview source | Notes |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | Optional | Local PostgreSQL connection string | Usually unset on Vercel | Use for a local DB or direct PostgreSQL connection. |
| `CLOUD_SQL_INSTANCE_CONNECTION_NAME` | Required without `DATABASE_URL` | Vercel env or GCP Cloud SQL instance name | Vercel Environment Variables | Format: `project:region:instance`. |
| `DB_NAME` | Required without `DATABASE_URL` | Vercel env | Vercel Environment Variables | Cloud SQL database name. |
| `DB_USER` | Required without `DATABASE_URL` | Vercel env | Vercel Environment Variables | Cloud SQL database user. |
| `DB_PASSWORD` | Required without `DATABASE_URL` | Vercel env or GCP Secret Manager | Vercel Environment Variables | Do not paste into docs or chat. |
| `GOOGLE_CLOUD_PROJECT` | Required | Vercel env or GCP project ID | Vercel Environment Variables | `sunabalog-dev` or `sunabalog-prod`. |
| `DEFAULT_PODCAST_ID` | Required | Vercel env | Vercel Environment Variables | Current single-channel default is `1`. |
| `DEV_ALLOWED_EMAILS` | Required | Vercel env / team allowlist | Vercel Environment Variables | Comma-separated login allowlist. |
| `GCS_UPLOAD_BUCKET` | Required | Vercel env or GCS bucket name | Vercel Environment Variables | Dev and prod buckets must not be mixed. |
| `GCS_SIGNED_URL_TTL_SECONDS` | Optional | `.env.example` default | Vercel Environment Variables | Defaults to `900` seconds. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Required outside GCP | Vercel env | Vercel Environment Variables | JSON for server-side Firebase/GCS signing credentials. |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Required | Firebase Console or Vercel env | Vercel Environment Variables | Public Firebase Web SDK config. |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Required | Firebase Console or Vercel env | Vercel Environment Variables | Dev/Preview can use `sunabalog-dev.firebaseapp.com`. Production on Vercel should use the UI host, for example `podcast-ui-kentakashimas-projects.vercel.app`, so mobile redirect sign-in can restore the Firebase result. |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Required | Firebase Console or Vercel env | Vercel Environment Variables | Must match the Firebase project used for auth. |
| `FIREBASE_AUTH_HELPER_DOMAIN` | Optional | Firebase project auth helper domain | Vercel Environment Variables | Defaults to `${NEXT_PUBLIC_FIREBASE_PROJECT_ID}.firebaseapp.com`. Used by Next.js rewrites for `/__/auth/*`. |
| `CRON_SECRET` | Required | Vercel env or generated local value | Vercel Environment Variables | Used by scheduled upload cleanup endpoint. |

## Current Secret Stores

- Vercel Environment Variables: runtime configuration for `podcast-ui`.
- GCP Secret Manager: shared backend secrets used mainly by `podcast-automator`
  and infrastructure, such as Cloud SQL, Cloudflare R2, Discord, and X API
  credentials.
- GitHub Secrets: GitHub Actions secrets, mainly Discord notifications and
  deployment credentials.

`podcast-ui` local development should usually copy values from Vercel
Environment Variables. If a value also exists in GCP Secret Manager, prefer the
team-agreed source for that environment and do not duplicate it in docs.

## How to Create `.env.local`

1. Copy the template:

   ```bash
   cp .env.example .env.local
   ```

2. Fill non-secret values from the target environment:

   ```text
   GOOGLE_CLOUD_PROJECT
   DEFAULT_PODCAST_ID
   GCS_UPLOAD_BUCKET
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
   NEXT_PUBLIC_FIREBASE_PROJECT_ID
   FIREBASE_AUTH_HELPER_DOMAIN
   ```

3. Fill secret values from the appropriate secret store:

   ```text
   DB_PASSWORD
   FIREBASE_SERVICE_ACCOUNT_JSON
   NEXT_PUBLIC_FIREBASE_API_KEY
   CRON_SECRET
   ```

4. Use either `DATABASE_URL` or the Cloud SQL Connector variables.

   For local PostgreSQL, `DATABASE_URL` is usually simpler. For parity with
   Vercel, use:

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

## Firebase Redirect Sign-In on Vercel

Mobile browsers may block the cross-origin storage access used by Firebase
`signInWithRedirect()` when the app is served from Vercel but `authDomain`
points at `<project>.firebaseapp.com`. In that state, Google sign-in appears to
complete, but the app returns to `/login` because `getRedirectResult()` is empty
and `/api/auth/session` is never called.

Production Vercel should therefore use:

```text
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=podcast-ui-kentakashimas-projects.vercel.app
FIREBASE_AUTH_HELPER_DOMAIN=sunabalog-prod.firebaseapp.com
```

The Next.js rewrite proxies `/__/auth/*` to the Firebase helper domain. Also
make sure Firebase Auth authorized domains includes the UI host, and the Google
OAuth client allows this redirect URI:

```text
https://podcast-ui-kentakashimas-projects.vercel.app/__/auth/handler
```
