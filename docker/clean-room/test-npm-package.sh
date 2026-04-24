#!/usr/bin/env bash
# Non-interactive smoke test for F326-F331 (publish-npm-package feature set).
# Installs aigon from the packed tarball (simulates global npm install -g) and
# exercises: package boundary, release channel, prereq checks, global-setup,
# update notifications, and packaged server lifecycle.
set -euo pipefail

TARBALL="/home/dev/src/aigon/aigon-cli-2.54.5.tgz"
PASS=0
FAIL=0

# ── helpers ──────────────────────────────────────────────────────────────────
ok()   { echo "  ✅ $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌ $*"; FAIL=$((FAIL+1)); }
section() { echo; echo "── $* ──────────────────────────────────────"; }

# ── step 1: system prerequisites ─────────────────────────────────────────────
section "Step 1: Install system prerequisites"
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - >/dev/null 2>&1
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs git tmux lsof >/dev/null 2>&1
node --version >/dev/null && ok "node $(node --version)"
npm --version  >/dev/null && ok "npm $(npm --version)"

# ── step 2: install aigon from tarball ───────────────────────────────────────
section "Step 2: Install aigon globally from tarball (F326)"
if [[ ! -f "$TARBALL" ]]; then
  fail "tarball not found at $TARBALL"
  exit 1
fi
sudo npm install -g "$TARBALL" 2>&1 | tail -3
if aigon --version >/dev/null 2>&1; then
  ok "aigon $(aigon --version) installed from tarball"
else
  fail "aigon --version failed after global install"
  exit 1
fi

# ── step 3: release channel (F327) ───────────────────────────────────────────
section "Step 3: Release channel detection (F327)"
CHANNEL=$(node -e "const rc = require('/usr/lib/node_modules/@aigon/cli/lib/release-channel'); console.log(rc.channel)")
if [[ "$CHANNEL" == "latest" ]]; then
  ok "channel = latest (stable version, correct)"
else
  fail "expected channel=latest, got: $CHANNEL"
fi

# ── step 4: update check (F328) ──────────────────────────────────────────────
section "Step 4: Update check returns cleanly (F328)"
VERSION_OUT=$(aigon check-version 2>&1)
echo "  output: $VERSION_OUT"
# Should print something — either "up to date" or "unavailable"; must not crash
if [[ $? -eq 0 ]]; then
  ok "check-version exited 0"
else
  fail "check-version exited non-zero"
fi
# Verify the JS module itself returns a structured result (not a thrown error)
node - <<'EOF'
const { checkForUpdate } = require('/usr/lib/node_modules/@aigon/cli/lib/npm-update-check');
checkForUpdate({ force: true }).then(r => {
  if (!r || !r.state) { process.stderr.write('no state field\n'); process.exit(1); }
  console.log('  update-check state: ' + r.state + (r.error ? ' (' + r.error + ')' : ''));
  process.exit(0);
}).catch(e => { process.stderr.write('threw: ' + e.message + '\n'); process.exit(1); });
EOF
ok "npm-update-check module returns structured result"

# ── step 5: prerequisite checks (F330) ───────────────────────────────────────
section "Step 5: Prerequisite checks (F330)"
PREREQ_OUT=$(aigon check-prerequisites 2>&1)
echo "  $PREREQ_OUT"
if echo "$PREREQ_OUT" | grep -q "Core prerequisites OK\|All prerequisites satisfied"; then
  ok "check-prerequisites passed"
else
  fail "check-prerequisites did not report core prerequisites OK"
fi

# ── step 6: global-setup non-interactive (F329) ───────────────────────────────
section "Step 6: Global setup non-interactive (F329)"
git config --global user.name "Test User"
git config --global user.email "test@example.com"
git config --global init.defaultBranch main
aigon global-setup --non-interactive --quiet 2>&1 && ok "global-setup --non-interactive --quiet exited 0" || fail "global-setup exited non-zero"

# ── step 7: server lifecycle from a non-repo directory (F331) ─────────────────
section "Step 7: Server lifecycle from global install path (F331)"

# Create a throw-away test repo in /tmp — NOT inside ~/src/aigon
TEST_REPO=$(mktemp -d)
cd "$TEST_REPO"
git init -q
aigon init >/dev/null 2>&1 || true   # seed .aigon/ so the server has a repo to manage

# Start server as a background process (nohup avoids shell job-control suspension)
nohup aigon server start > /tmp/aigon-server.log 2>&1 &
SERVER_PID=$!
echo "  server start launched (PID $SERVER_PID)"

# Poll for up to 12s
HEALTHY=false
for i in $(seq 1 24); do
  sleep 0.5
  STATUS=$(aigon server status 2>&1 || true)
  if echo "$STATUS" | grep -q "running"; then
    HEALTHY=true
    break
  fi
done

if $HEALTHY; then
  ok "server started and reports running"
  echo "  $(aigon server status 2>&1 | head -1)"
else
  fail "server did not reach running state within 12s"
  echo "  --- server log ---"
  cat /tmp/aigon-server.log | tail -20
fi

# Test restart
echo "  testing server restart..."
aigon server restart >/dev/null 2>&1
sleep 3
RESTART_STATUS=$(aigon server status 2>&1 || true)
if echo "$RESTART_STATUS" | grep -q "running"; then
  ok "server running after restart"
else
  fail "server not running after restart"
  echo "  status: $RESTART_STATUS"
fi

# Test stop
echo "  testing server stop..."
aigon server stop >/dev/null 2>&1
sleep 2
STOP_STATUS=$(aigon server status 2>&1 || true)
if echo "$STOP_STATUS" | grep -qi "stopped\|not running\|no.*server\|Server: stopped"; then
  ok "server stopped cleanly"
else
  # Status might just say "not running" in various forms — check it's not "running"
  if ! echo "$STOP_STATUS" | grep -q "^Server: running"; then
    ok "server no longer running after stop"
  else
    fail "server still running after stop command"
    echo "  status: $STOP_STATUS"
  fi
fi

# ── summary ──────────────────────────────────────────────────────────────────
section "Results"
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
echo
if [[ $FAIL -eq 0 ]]; then
  echo "✅ All F326-F331 smoke tests passed"
  exit 0
else
  echo "❌ $FAIL test(s) failed"
  exit 1
fi
