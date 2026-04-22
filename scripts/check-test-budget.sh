#!/usr/bin/env bash
#
# check-test-budget.sh — enforce a hard ceiling on test-suite LOC.
#
# Why:
#   The aigon test suite has twice been bloated past 14,000 lines and
#   carpet-bombed back down. A hard numeric ceiling prevents silent growth.
#   If adding a new test would exceed the ceiling, the rule is: delete an
#   older, less-valuable test in the same commit. If nothing can be deleted,
#   stop and ask — do not raise the ceiling silently.
#
# Usage:
#   bash scripts/check-test-budget.sh           # check + print
#   CEILING=2500 bash scripts/check-test-budget.sh   # override (asked for once)
#
# Exit codes:
#   0 — under budget
#   1 — over budget (push should be blocked)

set -euo pipefail

# Default includes F308 pre-authorised +80 LOC for failover regression tests (spec 308)
# and F313 pre-authorised +40 LOC for spec-frontmatter recommendation regression tests.
CEILING="${CEILING:-2870}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -d tests ]; then
    echo "✅ No tests/ directory — test budget n/a"
    exit 0
fi

# If the ceiling was raised in HEAD (vs its parent), enforce that at least one
# test file was deleted in the same commit. This prevents the silent ratchet
# pattern where the ceiling rises with every incident.
# Extract numeric defaults from lines like: +CEILING="${CEILING:-2500}"
STAGED_CEILING_DELTA=$(git diff HEAD~1..HEAD -- scripts/check-test-budget.sh 2>/dev/null \
    | grep -E '^\+CEILING=' | head -1 | sed -E 's/^\+CEILING="\$\{CEILING:-([0-9]+)\}".*/\1/' || true)
OLD_CEILING=$(git diff HEAD~1..HEAD -- scripts/check-test-budget.sh 2>/dev/null \
    | grep -E '^\-CEILING=' | head -1 | sed -E 's/^\-CEILING="\$\{CEILING:-([0-9]+)\}".*/\1/' || true)
if [ -n "$STAGED_CEILING_DELTA" ] && [ -n "$OLD_CEILING" ] && [ "$STAGED_CEILING_DELTA" -gt "$OLD_CEILING" ] 2>/dev/null; then
    DELETED_TESTS=$(git diff HEAD~1..HEAD --name-only --diff-filter=D -- 'tests/**/*.test.js' 'tests/**/*.spec.js' 2>/dev/null || true)
    if [ -z "$DELETED_TESTS" ]; then
        echo "❌ Ceiling raise requires same-commit deletion of at least one test file."
        echo ""
        echo "   The CEILING default was raised from $OLD_CEILING to $STAGED_CEILING_DELTA but no test"
        echo "   files were deleted. Consider hardening the producer API (stricter types,"
        echo "   enums, or removed dead branches) rather than adding a regression test."
        echo ""
        echo "   To raise the ceiling: delete at least one test file in the same commit."
        exit 1
    fi
fi

CURRENT=$(find tests -name '*.js' -not -path '*/node_modules/*' -exec wc -l {} \; | awk '{sum+=$1} END {print sum+0}')

PCT=$(( CURRENT * 100 / CEILING ))

if [ "$CURRENT" -gt "$CEILING" ]; then
    echo "❌ Test suite is $CURRENT LOC, ceiling is $CEILING ($PCT% of budget)"
    echo ""
    echo "   Delete tests before adding new ones. Criteria for deletion:"
    echo "     - Duplicates another test's coverage"
    echo "     - Tests code that was removed or rewritten"
    echo "     - Tests implementation details rather than behavior"
    echo "     - Has not caught a regression in months"
    echo ""
    echo "   Consider whether the producer API can be hardened (stricter types, enums,"
    echo "   or removed dead branches) rather than adding a regression test."
    echo ""
    echo "   If nothing can be deleted, stop and ask the user before raising the ceiling."
    exit 1
fi

echo "✅ Test suite $CURRENT / $CEILING LOC ($PCT% of budget)"
