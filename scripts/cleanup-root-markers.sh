#!/usr/bin/env bash
# One-off cleanup: strip aigon marker blocks from AGENTS.md and CLAUDE.md
# across all aigon-installed repos in ~/src.
#
# Run once after v2.50.2 rollout, then delete this script.
#
# Usage: bash scripts/cleanup-root-markers.sh [--dry-run]

set -euo pipefail

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

SRC_DIR="$HOME/src"
MARKER_RE='<!-- AIGON_START -->.*<!-- AIGON_END -->'

strip_markers() {
    local file="$1"
    [[ -f "$file" ]] || return 0
    grep -q '<!-- AIGON_START -->' "$file" || return 0

    # Strip marker block (multiline) and trim leading/trailing blank lines
    local cleaned
    cleaned=$(sed '/<!-- AIGON_START -->/,/<!-- AIGON_END -->/d' "$file")
    # Trim leading and trailing blank lines
    cleaned=$(echo "$cleaned" | sed '/./,$!d' | sed -e :a -e '/^$/{ $d; N; ba
}')

    if [[ -z "$cleaned" ]]; then
        if $DRY_RUN; then
            echo "  would DELETE $file (empty after strip)"
        else
            rm "$file"
            echo "  DELETED $file (was aigon-only)"
        fi
    else
        if $DRY_RUN; then
            echo "  would STRIP markers from $file"
        else
            printf '%s\n' "$cleaned" > "$file"
            echo "  STRIPPED markers from $file"
        fi
    fi
}

$DRY_RUN && echo "=== DRY RUN ==="
echo ""

count=0
for dir in "$SRC_DIR"/*/; do
    [[ -d "$dir/.aigon" ]] || continue
    project=$(basename "$dir")

    changed=false
    for f in "$dir/AGENTS.md" "$dir/CLAUDE.md"; do
        if [[ -f "$f" ]] && grep -q '<!-- AIGON_START -->' "$f"; then
            changed=true
            break
        fi
    done
    $changed || continue

    echo "[$project]"
    strip_markers "$dir/AGENTS.md"
    strip_markers "$dir/CLAUDE.md"
    count=$((count + 1))
done

echo ""
echo "Done. $count repo(s) cleaned."
$DRY_RUN && echo "(no files were modified — rerun without --dry-run to apply)"
