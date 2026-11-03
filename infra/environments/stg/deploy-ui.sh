#!/usr/bin/env bash
# stg（ハッカソン審査用の凍結環境）へ UI を手動で配信する。
# cd.yml の ui ジョブと同じ手順（マイグレーション → ビルド → push → 配信）を、
# gcloud にログインした手元から実行する。stg は CD に繋いでいない。
#
#   bash infra/environments/stg/deploy-ui.sh
#
# 審査（2026-12-01）が終わるまでは、提出時点のコミットから一度だけ実行し、以後は動かさない。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$REPO_ROOT"

PROJECT_ID=sunabalog-stg
REGION=asia-northeast1
SERVICE=sparkcast-ui-stg
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/sparkcast-ui/sparkcast-ui"
DATABASE_URL_SECRET=supabase-database-url-stg
# Firebase の Web 設定値（公開値。cd.yml と同じくビルド時に埋め込む）
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyCvrN3zPn3XBf6AKkCh7zdODdm6sne4p9w
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=sunabalog-stg.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=sunabalog-stg
FIREBASE_AUTH_HELPER_DOMAIN=sunabalog-stg.firebaseapp.com

SHA="$(git rev-parse HEAD)"
if [[ -n "$(git status --porcelain -- apps/ui)" ]]; then
  echo "apps/ui に未コミットの変更があります。提出時点のコミットから配信してください。" >&2
  exit 1
fi

# policy-media の URL と音声バケットは Terraform が作ったものを引く（cd.yml と同じ）
POLICY_MEDIA_URL="$(gcloud run services describe "sparkcast-automator-policy-media-stg" \
  --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')"
POLICY_AUDIO_BUCKET="sparkcast-automator-policy-audio-stg"
gcloud storage buckets describe "gs://${POLICY_AUDIO_BUCKET}" --project "$PROJECT_ID" \
  --format='value(name)' > /dev/null

(
  cd apps/ui
  npm ci
  DATABASE_URL="$(gcloud secrets versions access latest --secret="$DATABASE_URL_SECRET" --project="$PROJECT_ID")"
  export DATABASE_URL
  npm run db:migrate
)

gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
docker build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_FIREBASE_API_KEY="$NEXT_PUBLIC_FIREBASE_API_KEY" \
  --build-arg NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN" \
  --build-arg NEXT_PUBLIC_FIREBASE_PROJECT_ID="$NEXT_PUBLIC_FIREBASE_PROJECT_ID" \
  --build-arg FIREBASE_AUTH_HELPER_DOMAIN="$FIREBASE_AUTH_HELPER_DOMAIN" \
  -t "$IMAGE:$SHA" apps/ui
docker push "$IMAGE:$SHA"

SUFFIX="sha-${SHA::8}-$(date +%Y%m%d%H%M)"
gcloud run deploy "$SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --update-env-vars "POLICY_MEDIA_URL=$POLICY_MEDIA_URL,POLICY_AUDIO_BUCKET=$POLICY_AUDIO_BUCKET" \
  --image "$IMAGE:$SHA" \
  --revision-suffix "$SUFFIX" \
  --no-traffic
gcloud run services update-traffic "$SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --to-revisions "${SERVICE}-${SUFFIX}=100"
