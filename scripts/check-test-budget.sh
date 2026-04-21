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

CEILING="${CEILING:-2410}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -d tests ]; then
    echo "✅ No tests/ directory — test budget n/a"
    exit 0
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
    echo "   If nothing can be deleted, stop and ask the user before raising the ceiling."
    exit 1
fi

echo "✅ Test suite $CURRENT / $CEILING LOC ($PCT% of budget)"
