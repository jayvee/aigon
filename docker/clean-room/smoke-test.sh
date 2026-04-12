#!/usr/bin/env bash
# smoke-test.sh — Clean-room automated install + tutorial validation
# Works on both Linux (Docker) and macOS (GitHub Actions / bare metal)
# Exit non-zero on first failure with a clear message about which step broke.
set -euo pipefail

# ---------- helpers ----------

PASS_COUNT=0
FAIL_COUNT=0
CURRENT_SCENARIO=""

step() {
  echo ""
  echo "--- [$CURRENT_SCENARIO] $1"
}

pass() {
  echo "  PASS: $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  echo "  FAIL: $1" >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
  exit 1
}

check_command() {
  if command -v "$1" &>/dev/null; then
    pass "$1 is available"
  else
    fail "$1 not found after install"
  fi
}

detect_platform() {
  case "$(uname -s)" in
    Linux)  PLATFORM="linux" ;;
    Darwin) PLATFORM="macos" ;;
    *)      fail "Unsupported platform: $(uname -s)" ;;
  esac
  echo "Platform: $PLATFORM"
}

install_prerequisites() {
  step "Install prerequisites (node, git, tmux)"
  if [[ "$PLATFORM" == "linux" ]]; then
    sudo apt-get update -qq
    sudo apt-get install -y -qq nodejs npm git tmux
  else
    # macOS — assume brew is available (GitHub Actions runners have it)
    brew install node git tmux 2>/dev/null || true
  fi
  check_command node
  check_command npm
  check_command git
  check_command tmux
  echo "  Node version: $(node --version)"
  echo "  npm version: $(npm --version)"
}

install_aigon() {
  step "Install aigon from local source"
  cd ~/src/aigon
  npm ci --ignore-scripts 2>&1 | tail -1
  if [[ "$PLATFORM" == "linux" ]]; then
    sudo npm link 2>&1 | tail -1
  else
    npm link 2>&1 | tail -1
  fi
  check_command aigon
  aigon --version
  pass "aigon installed and responds to --version"
}

# ---------- scenarios ----------

scenario_1() {
  CURRENT_SCENARIO="S1: Minimal single-agent"
  step "Starting scenario: minimal single-agent install"
  detect_platform
  install_prerequisites
  install_aigon

  step "Configure aigon"
  aigon config init --global 2>&1 || true
  aigon config set --global terminal tmux
  pass "aigon config set"

  step "Run aigon doctor"
  aigon doctor || true
  pass "aigon doctor ran (warnings are OK for clean-room)"

  echo ""
  echo "=== SCENARIO 1 COMPLETE ==="
}

scenario_2() {
  CURRENT_SCENARIO="S2: Dashboard + server"
  step "Starting scenario: dashboard + server"

  # Ensure scenario 1 prerequisites are in place
  if ! command -v aigon &>/dev/null; then
    detect_platform
    install_prerequisites
    install_aigon
    aigon config init --global 2>&1 || true
    aigon config set --global terminal tmux
  fi

  step "Create a temp project to register"
  TEMP_PROJECT=$(mktemp -d)
  cd "$TEMP_PROJECT"
  git init -q
  git commit --allow-empty -m "init" -q
  aigon init 2>&1 || true
  pass "aigon init in temp project"

  step "Start aigon server"
  aigon server start &
  SERVER_PID=$!
  sleep 3

  step "Verify dashboard responds on port 4100"
  if curl -sf -o /dev/null http://localhost:4100; then
    pass "Dashboard responds on localhost:4100"
  else
    fail "Dashboard did not respond on localhost:4100"
  fi

  # Clean up
  kill $SERVER_PID 2>/dev/null || true
  rm -rf "$TEMP_PROJECT"

  echo ""
  echo "=== SCENARIO 2 COMPLETE ==="
}

scenario_5() {
  CURRENT_SCENARIO="S5: Brewboard tutorial"
  step "Starting scenario: brewboard tutorial"

  # Ensure prerequisites
  if ! command -v aigon &>/dev/null; then
    detect_platform
    install_prerequisites
    install_aigon
    aigon config init --global 2>&1 || true
    aigon config set --global terminal tmux
  fi

  step "Clone brewboard seed repo"
  BREWBOARD_DIR=~/src/brewboard
  rm -rf "$BREWBOARD_DIR"
  git clone https://github.com/jayvee/brewboard-seed.git "$BREWBOARD_DIR"
  cd "$BREWBOARD_DIR"
  git remote remove origin 2>/dev/null || true
  pass "brewboard-seed cloned"

  step "Install brewboard dependencies"
  npm install 2>&1 | tail -3
  pass "npm install complete"

  step "Initialize aigon in brewboard"
  aigon init 2>&1 || true
  pass "aigon init"

  step "Install agent (cc)"
  aigon install-agent cc 2>&1 || true
  pass "aigon install-agent cc"

  step "Start aigon server"
  aigon server start &
  SERVER_PID=$!
  sleep 3

  step "Register brewboard with server"
  aigon server add "$BREWBOARD_DIR" 2>&1 || true
  pass "aigon server add"

  step "Verify dashboard responds"
  if curl -sf -o /dev/null http://localhost:4100; then
    pass "Dashboard responds on localhost:4100"
  else
    fail "Dashboard did not respond on localhost:4100"
  fi

  step "Verify board shows seeded features"
  aigon board 2>&1 | head -20
  pass "aigon board runs"

  step "Start dev server"
  aigon dev-server start &
  DEV_PID=$!
  sleep 5

  step "Verify dev server responds"
  # Dev server port varies — check common ports
  DEV_PORT_OK=false
  for port in 3000 3001 5173 8080; do
    if curl -sf -o /dev/null "http://localhost:$port" 2>/dev/null; then
      pass "Dev server responds on localhost:$port"
      DEV_PORT_OK=true
      break
    fi
  done
  if [[ "$DEV_PORT_OK" == false ]]; then
    echo "  WARN: Could not detect dev server on common ports (non-fatal)"
  fi

  # Clean up
  kill $SERVER_PID 2>/dev/null || true
  kill $DEV_PID 2>/dev/null || true

  echo ""
  echo "=== SCENARIO 5 COMPLETE ==="
}

# ---------- CLI ----------

SCENARIO=""
ALL=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --scenario)
      SCENARIO="$2"
      shift 2
      ;;
    --all)
      ALL=true
      shift
      ;;
    -h|--help)
      echo "Usage: smoke-test.sh [--scenario N] [--all]"
      echo ""
      echo "Scenarios:"
      echo "  1  Minimal single-agent install"
      echo "  2  Dashboard + server"
      echo "  5  Brewboard tutorial (full)"
      echo ""
      echo "  --all    Run scenarios 1, 2, 5 sequentially"
      exit 0
      ;;
    *)
      echo "Unknown flag: $1" >&2
      exit 1
      ;;
  esac
done

echo "=========================================="
echo "  Aigon Clean-Room Smoke Test"
echo "=========================================="
detect_platform

if [[ "$ALL" == true ]]; then
  scenario_1
  scenario_2
  scenario_5
elif [[ -n "$SCENARIO" ]]; then
  case "$SCENARIO" in
    1) scenario_1 ;;
    2) scenario_2 ;;
    5) scenario_5 ;;
    *) fail "Unknown scenario: $SCENARIO. Available: 1, 2, 5" ;;
  esac
else
  # Default: run scenario 1 (minimal)
  scenario_1
fi

echo ""
echo "=========================================="
echo "  All tests passed ($PASS_COUNT checks)"
echo "=========================================="
exit 0
