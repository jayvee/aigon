#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
IMAGE_NAME="aigon-clean-room"

# Parse flags
MODE="interactive"
SCENARIO=""
ALL_SCENARIOS=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --auto)
      MODE="auto"
      shift
      ;;
    --scenario)
      SCENARIO="$2"
      shift 2
      ;;
    --all)
      ALL_SCENARIOS=true
      shift
      ;;
    -h|--help)
      echo "Usage: run.sh [--auto] [--scenario N] [--all]"
      echo ""
      echo "Modes:"
      echo "  (no flags)      Interactive shell — step through docs manually"
      echo "  --auto           Run smoke-test.sh non-interactively"
      echo "  --auto --scenario N  Run a specific scenario (1-5)"
      echo "  --auto --all     Run all scenarios sequentially"
      echo ""
      echo "Environment variables forwarded to container:"
      echo "  ANTHROPIC_API_KEY, GOOGLE_API_KEY, OPENAI_API_KEY"
      exit 0
      ;;
    *)
      echo "Unknown flag: $1" >&2
      exit 1
      ;;
  esac
done

echo "==> Building clean-room image..."
docker build -t "$IMAGE_NAME" "$SCRIPT_DIR"

# Common docker run args
DOCKER_ARGS=(
  --rm
  -v "$REPO_ROOT:/home/dev/src/aigon"
  -p 4100:4100    # dashboard
  -p 3000:3000    # dev server
  --hostname clean-room
)

# Mount aigon-pro if it exists alongside aigon
AIGON_PRO_DIR="$(cd "$REPO_ROOT/.." && pwd)/aigon-pro"
if [[ -d "$AIGON_PRO_DIR" ]]; then
  DOCKER_ARGS+=(-v "$AIGON_PRO_DIR:/home/dev/src/aigon-pro")
  echo "    Aigon Pro mounted at ~/src/aigon-pro"
fi

# Forward API keys if set
for key in ANTHROPIC_API_KEY GOOGLE_API_KEY OPENAI_API_KEY; do
  if [[ -n "${!key:-}" ]]; then
    DOCKER_ARGS+=(-e "$key")
  fi
done

if [[ "$MODE" == "interactive" ]]; then
  echo "==> Launching interactive shell (manual mode)"
  echo "    Aigon source mounted at ~/src/aigon"
  echo "    Dashboard port: localhost:4100"
  echo "    Dev server port: localhost:3000"
  echo ""
  docker run -it "${DOCKER_ARGS[@]}" "$IMAGE_NAME"
else
  # Auto mode — run smoke-test.sh inside the container
  SMOKE_ARGS=()
  if [[ -n "$SCENARIO" ]]; then
    SMOKE_ARGS+=(--scenario "$SCENARIO")
  fi
  if [[ "$ALL_SCENARIOS" == true ]]; then
    SMOKE_ARGS+=(--all)
  fi

  echo "==> Running automated smoke test..."
  docker run "${DOCKER_ARGS[@]}" "$IMAGE_NAME" \
    bash /home/dev/src/aigon/docker/clean-room/smoke-test.sh "${SMOKE_ARGS[@]}"
fi
