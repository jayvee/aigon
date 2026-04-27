#!/usr/bin/env sh
# Mock agent binary for Aigon e2e tests. Sleeps briefly, writes + commits a
# trivial implementation file, exits 0. Used via MOCK_AGENT_BIN to exercise
# the buildAgentCommand wrapper (shell trap + heartbeat sidecar) without
# spawning a real agent.
#
# Profiles (via MOCK_AGENT_PROFILE):
#   happy        — normal sleep + commit + exit 0
#   never-submit — sleep for a very long time (no agent-status)
#   error-mid    — sleep briefly then exit 1 (triggers agent-status error)

PROFILE="${MOCK_AGENT_PROFILE:-happy}"
SLEEP_SEC="${MOCK_AGENT_SLEEP_SEC:-1}"

case "$PROFILE" in
  never-submit)
    sleep 3600
    ;;
  error-mid)
    sleep "$SLEEP_SEC"
    exit 1
    ;;
  *)
    # happy
    sleep "$SLEEP_SEC"

    DUMMY="mock-agent-bin-impl.js"
    cat > "$DUMMY" <<'EOF'
// mock agent bin output — substantive file so feature-submit evidence passes.
module.exports = { mock: true };
EOF

    GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null \
        git -c user.email=mock@aigon.test -c user.name="Mock Agent" \
        add "$DUMMY" >/dev/null 2>&1 || true
    GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null \
        git -c user.email=mock@aigon.test -c user.name="Mock Agent" \
        commit -m "feat: mock agent implementation" >/dev/null 2>&1 || true

    exit 0
    ;;
esac
