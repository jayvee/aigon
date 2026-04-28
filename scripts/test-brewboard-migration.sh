#!/usr/bin/env bash
# Test that aigon doctor --fix correctly migrates a legacy brewboard state to the
# current install contract (F419-F422: AGENTS.md cleanup, vendored docs, install manifest).
#
# Usage: bash scripts/test-brewboard-migration.sh
# Exit 0 = pass, non-zero = fail.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURE_DIR="$REPO_ROOT/legacy-fixtures/brewboard"
AIGON_BIN="$REPO_ROOT/aigon-cli.js"

# Validate prerequisites
if ! command -v node &>/dev/null; then
  echo "❌ node not found in PATH" >&2
  exit 1
fi
if [ ! -f "$AIGON_BIN" ]; then
  echo "❌ aigon-cli.js not found at $AIGON_BIN" >&2
  exit 1
fi
if [ ! -d "$FIXTURE_DIR" ]; then
  echo "❌ Legacy fixture not found at $FIXTURE_DIR" >&2
  exit 1
fi

PASS=0
FAIL=0

pass() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }

assert_exists()    { [ -e "$1" ]     && pass "exists: $1"          || fail "missing: $1"; }
assert_absent()    { [ ! -e "$1" ]   && pass "absent: $1"          || fail "should not exist: $1"; }
assert_contains()  { grep -q "$2" "$1" && pass "contains '$2': $1" || fail "missing '$2' in: $1"; }
assert_not_contains() { ! grep -q "$2" "$1" && pass "no '$2' in: $1" || fail "found '$2' in: $1"; }

# ── Setup ────────────────────────────────────────────────────────────────────

TMPDIR_BASE="$(mktemp -d)"
WORK="$TMPDIR_BASE/brewboard"
trap 'rm -rf "$TMPDIR_BASE"' EXIT

cp -r "$FIXTURE_DIR" "$WORK"

# git init is required for migration backup (tar needs a consistent cwd)
git -C "$WORK" init -q
git -C "$WORK" add -A
git -C "$WORK" -c user.email="test@test.com" -c user.name="Test" commit -q -m "legacy state"

# ── Step 1: verify legacy preconditions ──────────────────────────────────────

echo ""
echo "Step 1: Legacy preconditions"
assert_exists  "$WORK/AGENTS.md"
assert_contains "$WORK/AGENTS.md" "AIGON_START"
assert_exists  "$WORK/docs/development_workflow.md"
assert_exists  "$WORK/docs/agents/claude.md"
assert_exists  "$WORK/docs/aigon-project.md"
assert_absent  "$WORK/.aigon/docs/development_workflow.md"
assert_absent  "$WORK/.aigon/install-manifest.json"

# ── Step 2: run doctor --fix ──────────────────────────────────────────────────

echo ""
echo "Step 2: aigon doctor --fix"
cd "$WORK"
node "$AIGON_BIN" doctor --fix 2>&1 | grep -E "^(✅|⚠️|❌|  )" | head -30 || true
cd "$REPO_ROOT"

# ── Step 3: verify post-migration state ──────────────────────────────────────

echo ""
echo "Step 3: Post-migration assertions"

# AGENTS.md — marker block removed (migration 2.59.0)
assert_exists  "$WORK/AGENTS.md"
assert_not_contains "$WORK/AGENTS.md" "AIGON_START"

# docs/aigon-project.md — deleted (migration 2.59.1)
assert_absent  "$WORK/docs/aigon-project.md"

# docs/development_workflow.md — moved to .aigon/docs/ (migration 2.60.0)
assert_absent  "$WORK/docs/development_workflow.md"
assert_exists  "$WORK/.aigon/docs/development_workflow.md"

# docs/agents/claude.md — moved to .aigon/docs/agents/ (migration 2.60.0)
assert_absent  "$WORK/docs/agents/claude.md"
assert_exists  "$WORK/.aigon/docs/agents/claude.md"

# install manifest created (migration 2.61.0)
assert_exists  "$WORK/.aigon/install-manifest.json"

# manifest is valid JSON with tracked files
MANIFEST_FILES=$(node -e "const m=JSON.parse(require('fs').readFileSync('$WORK/.aigon/install-manifest.json','utf8')); console.log(m.files.length)")
if [ "$MANIFEST_FILES" -gt 0 ]; then
  pass "manifest has $MANIFEST_FILES tracked file(s)"
else
  fail "manifest has 0 tracked files"
fi

# ── Step 4: idempotency — second doctor --fix must be a no-op ────────────────

echo ""
echo "Step 4: Idempotency check"
cd "$WORK"
IDEMPOTENT_OUT=$(node "$AIGON_BIN" doctor --fix 2>&1)
cd "$REPO_ROOT"

if echo "$IDEMPOTENT_OUT" | grep -q "Applied.*migrat\|✅ Migration"; then
  fail "second doctor --fix applied migrations (not idempotent)"
else
  pass "second doctor --fix is a no-op"
fi

# Manifest file count unchanged after second run
MANIFEST_FILES_2=$(node -e "const m=JSON.parse(require('fs').readFileSync('$WORK/.aigon/install-manifest.json','utf8')); console.log(m.files.length)")
if [ "$MANIFEST_FILES" -eq "$MANIFEST_FILES_2" ]; then
  pass "manifest file count stable after second run ($MANIFEST_FILES)"
else
  fail "manifest file count changed: $MANIFEST_FILES → $MANIFEST_FILES_2"
fi

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "────────────────────────────────────────────"
if [ "$FAIL" -eq 0 ]; then
  echo "✅ Brewboard legacy state successfully migrated to current contract ($PASS assertions passed)"
  exit 0
else
  echo "❌ $FAIL assertion(s) failed, $PASS passed"
  exit 1
fi
