#!/usr/bin/env bash
# watch-deploy.sh — polls Cloudflare Pages until the target commit is live
#
# Usage:
#   scripts/watch-deploy.sh [commit-sha]
#
# If no commit SHA is given, uses the current HEAD.
# Reads CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID from .env.local.

set -euo pipefail

TARGET="${1:-$(git rev-parse --short HEAD)}"
PROJECT="aigon-site"
ENV_FILE="$(git rev-parse --show-toplevel)/.env.local"
TIMEOUT=120   # seconds before giving up
INTERVAL=5    # seconds between polls
ELAPSED=0

# Load secrets from .env.local if available
if [[ -f "$ENV_FILE" ]]; then
  while IFS='=' read -r key value; do
    case "$key" in
      CLOUDFLARE_API_TOKEN) export CLOUDFLARE_API_TOKEN="$value" ;;
      CLOUDFLARE_ACCOUNT_ID) export CLOUDFLARE_ACCOUNT_ID="$value" ;;
    esac
  done < <(grep -E '^CLOUDFLARE_(API_TOKEN|ACCOUNT_ID)=' "$ENV_FILE")
fi

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "Error: CLOUDFLARE_API_TOKEN not set. Add it to .env.local"
  exit 1
fi
if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  echo "Error: CLOUDFLARE_ACCOUNT_ID not set. Add it to .env.local"
  exit 1
fi

API_URL="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${PROJECT}/deployments?sort_by=created_on&sort_order=desc&per_page=1&env=production"

echo "Watching Cloudflare Pages for commit ${TARGET}..."

while [[ $ELAPSED -lt $TIMEOUT ]]; do
  DEPLOYED=$(curl -sf "$API_URL" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    | python3 -c "
import json, sys
data = json.load(sys.stdin)
results = data.get('result', [])
if results:
    d = results[0]
    sha = d['deployment_trigger']['metadata']['commit_hash'][:7]
    stage = d['latest_stage']
    print(sha + '|' + stage['name'] + ':' + stage['status'])
" 2>/dev/null || echo "")

  DEPLOYED_SHA="${DEPLOYED%%|*}"
  DEPLOYED_STATUS="${DEPLOYED##*|}"

  if [[ "$DEPLOYED_SHA" == "${TARGET:0:7}" && "$DEPLOYED_STATUS" == "deploy:success" ]]; then
    echo "✓ Deployed: ${TARGET} is live on Cloudflare Pages"
    exit 0
  fi

  if [[ "$DEPLOYED_SHA" == "${TARGET:0:7}" && "$DEPLOYED_STATUS" == *":failure"* ]]; then
    echo "✗ Deploy failed for ${TARGET} — check https://dash.cloudflare.com for details"
    exit 1
  fi

  echo "  Waiting... latest: ${DEPLOYED_SHA:-unknown} (${DEPLOYED_STATUS:-checking}) — ${ELAPSED}s elapsed"
  sleep "$INTERVAL"
  ELAPSED=$((ELAPSED + INTERVAL))
done

echo "Timed out after ${TIMEOUT}s — check https://dash.cloudflare.com for status"
exit 1
