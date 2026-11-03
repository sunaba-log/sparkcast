#!/usr/bin/env bash
# Resolve Terraform-provisioned resources before deploying any UI revision.
set -euo pipefail
: "${PROJECT_ID:?PROJECT_ID is required}"
: "${REGION:?REGION is required}"
: "${ENVIRONMENT:?ENVIRONMENT is required}"
: "${GITHUB_ENV:?GITHUB_ENV is required}"

POLICY_MEDIA_SERVICE="${AUTOMATOR_NAME_PREFIX:-sparkcast-automator}-policy-media-${ENVIRONMENT}"
POLICY_AUDIO_BUCKET="${AUTOMATOR_NAME_PREFIX:-sparkcast-automator}-policy-audio-${ENVIRONMENT}"
POLICY_MEDIA_URL="$(gcloud run services describe "$POLICY_MEDIA_SERVICE" \
  --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')"
if [[ -z "$POLICY_MEDIA_URL" ]]; then
  echo "::error::Policy media service has no URL. Apply infra for ${ENVIRONMENT} first."
  exit 1
fi
# Fail before deploying if persistent audio storage has not been provisioned.
gcloud storage buckets describe "gs://${POLICY_AUDIO_BUCKET}" \
  --project "$PROJECT_ID" --format='value(name)' > /dev/null
{
  echo "POLICY_MEDIA_URL=$POLICY_MEDIA_URL"
  echo "POLICY_AUDIO_BUCKET=$POLICY_AUDIO_BUCKET"
} >> "$GITHUB_ENV"
