#!/usr/bin/env bash
# API / web の本番イメージを buildx で作り Artifact Registry へ push する (cares 06 と同方式)。
source "$(dirname "$0")/_env.sh"
cd "$(dirname "$0")/../.."

TAG="${TAG:-$(git rev-parse --short HEAD)}"
gcloud auth configure-docker "$AR_HOST" --quiet

docker buildx build --platform linux/amd64 -f apps/api/Dockerfile.prod \
  -t "${IMAGE_REGISTRY}/bonds-api:${TAG}" --push .
docker buildx build --platform linux/amd64 -f apps/web/Dockerfile.prod \
  --build-arg NEXT_PUBLIC_FIREBASE_API_KEY="${NEXT_PUBLIC_FIREBASE_API_KEY:-}" \
  --build-arg NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="${NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:-}" \
  --build-arg NEXT_PUBLIC_FIREBASE_PROJECT_ID="${NEXT_PUBLIC_FIREBASE_PROJECT_ID:-}" \
  -t "${IMAGE_REGISTRY}/bonds-web:${TAG}" --push .
echo "pushed: ${IMAGE_REGISTRY}/bonds-{api,web}:${TAG}"
