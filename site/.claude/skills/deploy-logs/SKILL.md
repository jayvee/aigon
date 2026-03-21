---
name: deploy-logs
description: Show Cloudflare Pages build logs for the most recent deployment. Use when a deploy is failing or the user wants to inspect what happened during a build.
disable-model-invocation: false
---

## Current Git State
- HEAD commit: !`git log -1 --format="%h %s (%ar)" HEAD`

## Most Recent Deployment ID
- Deployment list: !`wrangler pages deployment list --project-name aigon-site --env-file .env.local --json 2>/dev/null | python3 -c "import json,sys; deps=json.load(sys.stdin); d=deps[0]; print(f'ID: {d[\"Id\"]}\nCommit: {d[\"Source\"]}\nEnvironment: {d[\"Environment\"]}\nStatus: {d[\"Status\"]}\nURL: {d[\"Deployment\"]}\nBuild: {d[\"Build\"]}')" 2>/dev/null || echo "(no token — add CLOUDFLARE_API_TOKEN to .env.local)"`

Using the deployment ID above (if available), fetch the full build log:
- Run: `wrangler pages deployment tail --project-name aigon-site <deployment-id>` — or guide the user to the Cloudflare dashboard if unauthenticated.

Dashboard path: dash.cloudflare.com → Pages → aigon-site → Deployments → [most recent] → View build log

Summarise:
1. Whether the build succeeded or failed
2. Any error messages from the build log
3. Recommended next steps if the build failed
