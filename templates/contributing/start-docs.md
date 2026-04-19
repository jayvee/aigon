<!-- description: Start the Aigon docs site locally on port 3600 -->
# Start Docs

Start the Aigon docs site (Next.js) for local development at http://localhost:3600.

```bash
PORT=3600 npm run dev --prefix site
```

Notes:
- **Do NOT** use `aigon dev-server start` — it conflicts with the dashboard proxy.
- The dashboard runs separately at http://localhost:4100 via `aigon server`.
- Never hardcode port 3000 — always use 3600 for the docs site.
