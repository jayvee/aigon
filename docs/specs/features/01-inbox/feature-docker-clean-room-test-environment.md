# Feature: docker-clean-room-test-environment

## Summary

Create a Dockerfile (and supporting scripts) that builds a minimal, clean Linux container with zero Aigon dependencies pre-installed. The purpose is to provide a fresh environment where a developer can manually step through the Getting Started guide and Brewboard tutorial end-to-end, validating that the documentation is accurate and the install process works from scratch.

This is not an automated test suite — it's a manual validation environment. The developer execs into the container and follows the docs as a new user would.

## User Stories
- [ ] As the maintainer, I want to spin up a clean Linux environment in seconds so I can verify the getting-started docs work end-to-end without needing a separate physical machine.
- [ ] As the maintainer, I want the container to have nothing pre-installed beyond a base OS so the test faithfully reproduces a first-time install experience.

## Acceptance Criteria
- [ ] **AC1** — A `Dockerfile` exists (e.g., `docker/clean-room/Dockerfile`) that builds a minimal Linux image (Ubuntu or Debian) with only the base OS — no Node.js, no git, no tmux, no aigon, no agent CLIs.
- [ ] **AC2** — A helper script (e.g., `docker/clean-room/run.sh`) builds the image and drops the user into an interactive shell inside the container.
- [ ] **AC3** — From inside the container, the user can follow the Getting Started guide step by step: install prerequisites (Node.js, git, tmux), clone aigon, `npm ci && npm link`, run `aigon --version`.
- [ ] **AC4** — From inside the container, the user can follow the Brewboard tutorial: clone the seed repo, `npm install`, `aigon init`, `aigon install-agent cc`, `aigon server start`, and access the dashboard from the host browser (port forwarded).
- [ ] **AC5** — The container has network access (to clone repos, install npm packages, and run agent CLIs that call external APIs).
- [ ] **AC6** — The container mounts or copies the local aigon source so the user is testing the current working copy, not a stale version.
- [ ] **AC7** — A `README.md` in the docker directory explains the purpose, how to build/run, and what to test.

## Validation
```bash
# Build the image
docker build -t aigon-clean-room docker/clean-room/
# Verify it starts
docker run --rm aigon-clean-room echo "clean-room OK"
```

## Technical Approach

**Base image:** `ubuntu:24.04` or `debian:bookworm-slim` — widely used, close to what a Linux developer would have. Do not install anything beyond what the base image ships with.

**Local source mount:** Bind-mount the aigon repo into the container (e.g., `-v $(pwd):/home/dev/src/aigon:ro`) so the user tests the current code. Alternatively, copy it at build time for a fully isolated test — but mount is simpler for iterating.

**Port forwarding:** The run script should forward port 4100 (dashboard) and 3000 (dev server) so the user can access the dashboard from the host browser.

**Agent API keys:** The user will need to provide their own API keys (e.g., `ANTHROPIC_API_KEY`) via env vars passed to `docker run -e`. The Dockerfile should not contain any secrets.

**Non-root user:** Create a non-root user (e.g., `dev`) inside the container to match a realistic developer environment. `sudo` should be available for installing packages (matching the Linux instructions in the getting-started guide).

**What the container does NOT include:**
- No Node.js, git, tmux, or any aigon prerequisites
- No aigon CLI
- No agent CLIs (Claude Code, Gemini CLI, etc.)
- No pre-configured shell (basic bash only)

## Dependencies
- Docker installed on the host machine
- Getting Started guide (`site/content/getting-started.mdx`)
- Brewboard tutorial (`site/content/guides/brewboard-tutorial.mdx`)

## Out of Scope
- Automated end-to-end test scripts that run the tutorial without human interaction
- macOS-specific testing (this is Linux only — macOS testing still requires a real Mac)
- CI/CD integration (this is a local developer tool, not a pipeline step)
- Agent CLI installation inside the Dockerfile (the user installs manually, following the docs)

## Open Questions
- Should we also forward the proxy port (80) for `.localhost` domain testing, or skip that since it requires elevated permissions inside the container?
- Is there value in a second Dockerfile variant that pre-installs prerequisites (Node, git, tmux) so the user can skip straight to the aigon install step?

## Related
- Getting Started guide: `site/content/getting-started.mdx`
- Brewboard tutorial: `site/content/guides/brewboard-tutorial.mdx`
- Proxy setup docs (newly added to getting-started)
