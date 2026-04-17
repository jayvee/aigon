<!-- description: Start the docs site locally on port 3600 -->
# Start Docs Site

Start the aigon docs site (Fumadocs/Next.js) for local development.

```bash
PORT=3600 npm run dev --prefix site
```

The site runs at **http://localhost:3600** with docs at **/docs**.

**Do NOT** use `aigon dev-server start` — it conflicts with the dashboard proxy.

The dashboard runs separately at http://localhost:4100 via `aigon server`.
