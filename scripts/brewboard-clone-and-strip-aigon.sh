#!/usr/bin/env bash
# Clone brewboard-seed and strip all aigon artefacts, keeping only docs/specs markdown.
# Also injects PRODUCT.md (canonical product spec) from scripts/brewboard-product.md.
# Usage: brewboard-clone-and-strip-aigon.sh [target-dir]
#   target-dir defaults to ~/src/brewboard-no-aigon
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRODUCT_DOC="$SCRIPT_DIR/brewboard-product.md"

if [[ ! -f "$PRODUCT_DOC" ]]; then
  echo "Error: product doc not found at $PRODUCT_DOC" >&2
  exit 1
fi

SEED_URL="https://github.com/jayvee/brewboard-seed.git"
TARGET="${1:-$HOME/src/brewboard-no-aigon}"

if [[ -d "$TARGET" ]]; then
  echo "Error: target directory already exists: $TARGET" >&2
  exit 1
fi

echo "Cloning brewboard-seed → $TARGET"
git clone "$SEED_URL" "$TARGET"

echo "Stripping aigon components..."
rm -rf \
  "$TARGET/.aigon" \
  "$TARGET/.agents" \
  "$TARGET/.claude" \
  "$TARGET/.codex" \
  "$TARGET/.cursor" \
  "$TARGET/.gemini" \
  "$TARGET/.opencode" \
  "$TARGET/AGENTS.md"

# In docs/specs: keep only .md and .gitkeep, delete everything else
find "$TARGET/docs/specs" -type f ! -name "*.md" ! -name ".gitkeep" -delete

# Replace .gitignore with a clean Next.js version (no aigon-specific entries)
cat > "$TARGET/.gitignore" << 'EOF'
node_modules
.next/
.env*.local
next-env.d.ts
.env.local
.DS_Store
EOF

# Inject canonical product spec
cp "$PRODUCT_DOC" "$TARGET/PRODUCT.md"

# Commit the cleanup
cd "$TARGET"
git add -A
git commit -m "chore: strip aigon components, keep docs/specs markdown, add PRODUCT.md"

# Disconnect from any remote
git remote remove origin

echo ""
echo "Done. $TARGET is ready — aigon stripped, docs/specs preserved, PRODUCT.md injected, no remote configured."
