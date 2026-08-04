#!/usr/bin/env bash
# Deploys Sutamaya to Cloud Run. See deploy.md for the one-time setup this assumes
# (APIs enabled, Firestore database, sutamaya-run service account, session secret).
set -euo pipefail

if ! command -v gcloud >/dev/null 2>&1; then
  echo "error: gcloud CLI not found. Install it: https://cloud.google.com/sdk/docs/install" >&2
  exit 1
fi

ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null || true)"
if [ -z "$ACCOUNT" ]; then
  echo "error: no active gcloud authentication. Run 'gcloud auth login' first." >&2
  exit 1
fi

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "(unset)" ]; then
  echo "error: no GCP project set. Run 'gcloud config set project <PROJECT_ID>' or pass PROJECT_ID=<id>." >&2
  exit 1
fi

REGION="${REGION:-europe-west1}"
REPO="cloud-run-source-deploy"

echo "Deploying sutamaya to Cloud Run — project=$PROJECT_ID region=$REGION account=$ACCOUNT"

# Pre-create the Artifact Registry repo `gcloud run deploy --source` would otherwise create
# on the fly (avoids its interactive y/n prompt, which is unsafe in non-interactive runs) and
# attach a cleanup policy so old image versions don't eat the 0.5GB free-tier storage quota.
if ! gcloud artifacts repositories describe "$REPO" --project="$PROJECT_ID" --location="$REGION" >/dev/null 2>&1; then
  echo "Creating Artifact Registry repo $REPO in $REGION…"
  gcloud artifacts repositories create "$REPO" \
    --project="$PROJECT_ID" \
    --location="$REGION" \
    --repository-format=docker \
    --description="Cloud Run source deploys for sutamaya"
fi
gcloud artifacts repositories set-cleanup-policies "$REPO" \
  --project="$PROJECT_ID" \
  --location="$REGION" \
  --policy="$(dirname "$0")/artifact-cleanup-policy.json"

# The server needs the same OAuth Client ID the frontend was built with, to verify Google's
# sign-in tokens are actually meant for this app. It's a public identifier (not a secret), and
# already lives in web/.env.production for the frontend build — read it from there so it never
# has to be pasted in by hand, and never gets silently dropped from an already-deployed service
# (--set-env-vars below replaces the full env var set every deploy, not just adds to it).
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-$(sed -n 's/^VITE_GOOGLE_CLIENT_ID=//p' "$(dirname "$0")/../web/.env.production" 2>/dev/null || true)}"

# Cloud Run does *not* inject GOOGLE_CLOUD_PROJECT automatically (despite what an earlier
# version of deploy.md claimed) — without it, server/src/firestore.js falls back to its
# 'sutamaya-local' local-dev default and every Firestore call 500s with a "permission denied on
# resource project sutamaya-local" error, which only surfaces once a request actually reaches
# Firestore (e.g. the first successful sign-in).
ENV_VARS="NODE_ENV=production,GOOGLE_CLOUD_PROJECT=$PROJECT_ID"
if [ -n "$GOOGLE_CLIENT_ID" ]; then
  ENV_VARS="$ENV_VARS,GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID"
else
  echo "error: no GOOGLE_CLIENT_ID found — set VITE_GOOGLE_CLIENT_ID in web/.env.production, or pass GOOGLE_CLIENT_ID=... to this script." >&2
  exit 1
fi

gcloud run deploy sutamaya \
  --source . \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --service-account="sutamaya-run@${PROJECT_ID}.iam.gserviceaccount.com" \
  --set-secrets="SESSION_SECRET=sutamaya-session-secret:latest" \
  --set-env-vars="$ENV_VARS" \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=1 \
  --memory=512Mi \
  --timeout=30
