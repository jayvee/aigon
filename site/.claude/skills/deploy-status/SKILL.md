---
name: deploy-status
description: Show Cloudflare Pages deployment status for aigon.dev. Use when the user asks about deployments, whether the site is live, or if a change has been deployed.
disable-model-invocation: false
---

## Current Git State
- HEAD commit: !`git log -1 --format="%h %s (%ar)" HEAD`
- Remote HEAD: !`git log -1 --format="%h %s" origin/main`
- Sync status: !`git status --short --branch`

## Cloudflare Pages Deployments
- Recent deployments: !`wrangler pages deployment list --project-name aigon-site --env-file .env.local --json 2>/dev/null | python3 -c "import json,sys; deps=json.load(sys.stdin); [print(f'{d[\"Id\"][:8]} | commit:{d[\"Source\"][:8]} | {d[\"Environment\"]} | {d[\"Status\"]} | {d[\"Deployment\"]}') for d in deps[:5]]" 2>/dev/null || echo "(no token — add CLOUDFLARE_API_TOKEN to .env.local)"`

Report:
1. Whether the HEAD commit has been deployed to production
2. The status of the most recent deployment (success / failure / in progress)
3. The deployed commit SHA vs the current HEAD SHA
4. If they differ, note the gap and list undeployed commits
5. If no token, instruct the user to add `CLOUDFLARE_API_TOKEN=<token>` to `.env.local`
