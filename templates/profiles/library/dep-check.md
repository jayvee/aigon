**Worktrees do not share dependencies with the main repo.** Before running or testing, check if dependencies need to be installed:

```bash
# Detect and install dependencies
if [ -f "Cargo.toml" ]; then cargo build
elif [ -f "go.mod" ]; then go mod download
elif [ -f "requirements.txt" ]; then pip install -r requirements.txt
elif [ -f "pyproject.toml" ]; then pip install -e .
elif [ -f "package.json" ]; then npm install
fi
```
