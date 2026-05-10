#!/usr/bin/env bash
# quick-f513-test.sh — In-container, < 90s F513 smoke.
#
# Validates the merge-init-into-apply feature (F513) end-to-end on a clean
# Linux container:
#   - aigon apply bootstraps a fresh repo (one verb, no prompt)
#   - aigon apply on an already-initialised repo is a no-op
#   - aigon init prints the deprecation warning and forwards
#   - aigon uninstall errors with the "did you mean: aigon remove?" hint
#   - aigon remove cleans the repo and preserves docs/specs/
#   - aigon remove --purge wipes .aigon/ but still preserves docs/specs/
#   - aigon apply registers the repo in ~/.aigon/config.json `repos`
#   - aigon remove deregisters it
#
# Run this INSIDE the container after `aigon` is installed. The host-side
# orchestrator is run-f513.sh.

set -uo pipefail   # NOT -e: we want to count failures, not bail on the first.

PASS=0
FAIL=0

pass()  { echo "  ✓ $1";     PASS=$((PASS+1)); }
fail()  { echo "  ✗ $1" >&2; FAIL=$((FAIL+1)); }
step()  { echo; echo "--- $1"; }

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "$1 is not on PATH — aborting"
    summary
    exit 1
  fi
}

summary() {
  echo
  echo "=========================================="
  if [[ "$FAIL" -eq 0 ]]; then
    echo "  ✅ F513 PASS — $PASS check(s)"
  else
    echo "  ❌ F513 FAIL — $FAIL failure(s), $PASS pass"
  fi
  echo "=========================================="
}

trap summary EXIT

require aigon
require git

REPO_DIR="$(mktemp -d)/demo-repo"
mkdir -p "$REPO_DIR"
cd "$REPO_DIR"
git init -q
git config user.email "test@example.com"
git config user.name "Test User"

# -----------------------------------------------------------------------------
step "1. aigon apply in a non-git dir errors with a clear message"
NOGIT=$(mktemp -d)
out="$(cd "$NOGIT" && aigon apply 2>&1 || true)"
if echo "$out" | grep -q "Not a Git repository"; then
  pass "apply in non-git dir errors cleanly"
else
  fail "apply in non-git dir should error; got: $out"
fi
if [[ ! -d "$NOGIT/.aigon" ]]; then
  pass "apply in non-git dir did not create .aigon/"
else
  fail "apply in non-git dir leaked .aigon/"
fi
rm -rf "$NOGIT"

# -----------------------------------------------------------------------------
step "2. aigon apply in a fresh git repo bootstraps (one verb, no prompt)"
out="$(aigon apply 2>&1 || true)"
if echo "$out" | grep -q "First-time setup"; then
  pass "first-time-setup banner shown"
else
  fail "first-time-setup banner missing; got:\n$out"
fi
[[ -d docs/specs/features/01-inbox ]] && pass "spec kanban lanes created" \
  || fail "spec kanban lanes missing"
[[ -f .aigon/applied-digest ]] && pass ".aigon/applied-digest written" \
  || fail ".aigon/applied-digest missing"
[[ -f .aigon/version ]] && pass ".aigon/version written" \
  || fail ".aigon/version missing"

# -----------------------------------------------------------------------------
step "3. second apply is silent on first-time path (no banner)"
out="$(aigon apply 2>&1 || true)"
if echo "$out" | grep -q "First-time setup"; then
  fail "second apply re-printed first-time banner"
else
  pass "second apply did not re-print first-time banner"
fi

# -----------------------------------------------------------------------------
step "4. aigon init prints deprecation warning and forwards"
out="$(aigon init 2>&1 || true)"
if echo "$out" | grep -qi "deprecated.*aigon apply"; then
  pass "aigon init shows deprecation hint pointing at apply"
else
  fail "aigon init missing deprecation hint; got:\n$out"
fi

# -----------------------------------------------------------------------------
step "5. aigon uninstall is gone — clear redirect to aigon remove"
out="$(aigon uninstall 2>&1 || true)"
if echo "$out" | grep -q "Did you mean: aigon remove"; then
  pass "aigon uninstall errors with 'did you mean' redirect"
else
  fail "aigon uninstall should redirect to aigon remove; got:\n$out"
fi

# -----------------------------------------------------------------------------
step "6. aigon apply auto-registers the repo in ~/.aigon/config.json"
ABS="$(pwd)"
if grep -q "$ABS" "$HOME/.aigon/config.json" 2>/dev/null; then
  pass "repo is in the global registry"
else
  fail "repo not in ~/.aigon/config.json after apply"
fi

# -----------------------------------------------------------------------------
step "7. aigon remove --dry-run previews without changes"
out="$(aigon remove --dry-run 2>&1 || true)"
echo "$out" | head -10
if echo "$out" | grep -q "dry-run"; then
  pass "remove --dry-run prints the preview marker"
else
  fail "remove --dry-run did not mark itself as a preview"
fi
[[ -d .aigon ]] && pass "remove --dry-run left .aigon/ in place" \
  || fail "remove --dry-run should not delete .aigon/"

# -----------------------------------------------------------------------------
step "8. aigon remove --force deregisters and preserves docs/specs/"
aigon remove --force >/dev/null 2>&1 || true
[[ -d docs/specs/features/01-inbox ]] && pass "docs/specs/ preserved after remove" \
  || fail "remove deleted docs/specs/ — should NEVER happen"
if grep -q "$ABS" "$HOME/.aigon/config.json" 2>/dev/null; then
  fail "remove did not deregister from ~/.aigon/config.json"
else
  pass "remove deregistered from global registry"
fi

# -----------------------------------------------------------------------------
step "9. aigon remove --purge wipes .aigon/ but keeps docs/specs/"
aigon apply >/dev/null 2>&1 || true
[[ -d .aigon ]] || fail "apply did not recreate .aigon/ for purge test"
aigon remove --purge --force >/dev/null 2>&1 || true
[[ ! -d .aigon ]] && pass ".aigon/ removed under --purge" \
  || fail ".aigon/ still present after --purge"
[[ -d docs/specs/features/01-inbox ]] && pass "docs/specs/ preserved under --purge" \
  || fail "--purge wrongly deleted docs/specs/"

# -----------------------------------------------------------------------------
exit "$FAIL"
