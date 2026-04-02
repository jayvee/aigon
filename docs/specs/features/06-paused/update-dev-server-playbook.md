 - Use WATCHPACK_POLLING=true npm run dev -- --port 3003 (background it, log to /tmp/farline-dev-3003.log).
    This avoids EMFILE watch errors on this machine.
  - If port 3003 is in use, stop old Next.js processes first (lsof -i :3003 → kill PID).
  - Auth: middleware redirects to /login. For automatic dev login, set
    DEV_AUTO_LOGIN_EMAIL=john.viner@farline.ai in .env.local (AUTH_SECRET already set).
  - After start, verify with curl -I http://localhost:3003 (should 307 to /login or 200 once logged in).
  - Stop server with kill <pid> (may require elevated perm). Tail logs with tail -f /tmp/farline-dev-3003.log.