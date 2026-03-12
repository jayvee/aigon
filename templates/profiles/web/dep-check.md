**Worktrees do not share `node_modules/` with the main repo.** Before running or testing, check if dependencies need to be installed:

```bash
# Check if node_modules exists
test -d node_modules && echo "Dependencies installed" || echo "Need to install dependencies"
```

If missing, install them using the project's package manager:
```bash
# Detect and run the appropriate install command
if [ -f "pnpm-lock.yaml" ]; then pnpm install
elif [ -f "yarn.lock" ]; then yarn install
elif [ -f "bun.lockb" ]; then bun install
elif [ -f "package-lock.json" ]; then npm install
elif [ -f "package.json" ]; then npm install
fi
```
