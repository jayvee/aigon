#!/usr/bin/env bash
# init.sh — initialise a new site from the static-site-template
#
# Replaces all {{PLACEHOLDER}} tokens across project files, copies .env.local.example,
# and optionally sets up a git repository.
#
# Usage:
#   bash scripts/init.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║     static-site-template — site initialiser     ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "This script will replace all {{PLACEHOLDER}} tokens in your project files."
echo "You can re-run it safely — it only replaces tokens that still exist."
echo ""

# ── Prompt for values ────────────────────────────────────────────────────────

prompt() {
  local var="$1" label="$2" example="$3"
  read -rp "  $label (e.g. $example): " value
  eval "$var='$value'"
}

echo "Enter values for your project:"
echo ""
prompt SITE_NAME    "Site name"                 "My Portfolio"
prompt SITE_DOMAIN  "Domain (no https://)"      "example.com"
prompt CF_PROJECT   "Cloudflare Pages project"  "my-portfolio"
prompt PERSON_NAME  "Your name"                 "Jane Smith"
prompt PERSON_EMAIL "Contact email"             "hello@example.com"
prompt GITHUB_REPO  "GitHub repo (no https://)" "github.com/user/repo"

echo ""
echo "Replacing placeholders…"

# ── Platform-safe sed -i ─────────────────────────────────────────────────────

do_sed() {
  local pattern="$1" replacement="$2" file="$3"
  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "s|${pattern}|${replacement}|g" "$file"
  else
    sed -i "s|${pattern}|${replacement}|g" "$file"
  fi
}

# ── Files to process ─────────────────────────────────────────────────────────

FILES=(
  CLAUDE.md
  PRODUCT.md
  index.html
  scripts/watch-deploy.sh
  docs/deployment.md
  .claude/skills/deploy-status/SKILL.md
  .claude/skills/deploy-logs/SKILL.md
)

for FILE in "${FILES[@]}"; do
  if [[ -f "$FILE" ]]; then
    do_sed "{{SITE_NAME}}"    "$SITE_NAME"    "$FILE"
    do_sed "{{SITE_DOMAIN}}"  "$SITE_DOMAIN"  "$FILE"
    do_sed "{{CF_PROJECT}}"   "$CF_PROJECT"   "$FILE"
    do_sed "{{PERSON_NAME}}"  "$PERSON_NAME"  "$FILE"
    do_sed "{{PERSON_EMAIL}}" "$PERSON_EMAIL" "$FILE"
    do_sed "{{GITHUB_REPO}}"  "$GITHUB_REPO"  "$FILE"
    echo "  ✓ $FILE"
  fi
done

# ── .env.local ────────────────────────────────────────────────────────────────

if [[ ! -f ".env.local" ]]; then
  cp .env.local.example .env.local
  echo "  ✓ .env.local created from .env.local.example"
else
  echo "  - .env.local already exists, skipped"
fi

# ── Git init ─────────────────────────────────────────────────────────────────

echo ""
read -rp "Initialise a new git repository and make an initial commit? [y/N] " INIT_GIT
if [[ "$INIT_GIT" == "y" || "$INIT_GIT" == "Y" ]]; then
  if [[ -d ".git" ]]; then
    echo "  Git repo already exists — skipping git init"
  else
    git init
    git add .
    git commit -m "feat: initial site scaffold"
    echo "  ✓ Git repo initialised with initial commit"
  fi
fi

# ── Next steps ───────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║                  Next Steps                     ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "  1. Add your CLOUDFLARE_API_TOKEN to .env.local"
echo "     (get it from dash.cloudflare.com → My Profile → API Tokens)"
echo ""
echo "  2. Create a Cloudflare Pages project named: $CF_PROJECT"
echo "     dash.cloudflare.com → Pages → Create a project → Connect to Git"
echo ""
echo "  3. Push to GitHub and connect Cloudflare Pages to your repo:"
echo "     https://$GITHUB_REPO"
echo ""
echo "  4. Add your favicon.ico to the repo root, then uncomment the"
echo "     favicon <link> in index.html"
echo ""
echo "  5. Run 'wrangler login' (or set CLOUDFLARE_API_TOKEN) to enable"
echo "     deployment monitoring via scripts/watch-deploy.sh"
echo ""
echo "Happy building!"
echo ""
