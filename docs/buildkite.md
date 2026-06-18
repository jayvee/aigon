# Buildkite Setup

This repo uses two Buildkite pipelines:

- `aigon-main-ci` — automatic on `main` pushes
- `aigon-release` — manual release pipeline

Both pipelines run on the self-hosted queue:

```text
self-hosted
```

## Pipeline files

Repo-managed pipeline definitions live in:

- `.buildkite/pipeline.yml`
- `.buildkite/release.pipeline.yml`

The Buildkite UI should use loader/upload steps that point at these files rather
than duplicating the full pipeline logic in the UI.

## Main CI

`aigon-main-ci` is the branch gate for `main`.

It runs:

```bash
npm ci
node -c aigon-cli.js
npm run test:core
```

The pipeline bootstraps Node through `fnm` inside the step itself, so the agent
does not depend on ad hoc local shell hooks.

## Release pipeline

`aigon-release` is manual-only.

It:

1. waits on a manual confirmation block
2. bootstraps Node through `fnm`
3. reads the npm publish token from 1Password via `op`
4. runs `npm run test:deploy`
5. runs `npm run release`

The current 1Password secret reference used by the release pipeline is:

```text
op://Aigon/Dev-Secrets/Secrets/NPM_TOKEN
```

No secret value is stored in git or in Buildkite.

## Self-hosted agent

The self-hosted Buildkite agent is installed via Homebrew:

```bash
brew install buildkite/buildkite/buildkite-agent@3
```

The agent must register with the queue tag:

```text
queue=self-hosted
```

`fnm` and `op` are expected to be installed via Homebrew and available from the
Homebrew prefix (for example `/opt/homebrew/bin` on Apple Silicon Macs).

## Rebuild checklist

On a fresh Mac:

1. install Homebrew
2. install `buildkite-agent@3`
3. install `fnm`
4. install `op`
5. sign `op` into 1Password with access to the `Aigon` vault
6. configure the Buildkite agent token and `queue=self-hosted`
7. start the agent service:

```bash
brew services start buildkite-agent@3
```

After that, the repo-managed pipelines should run without any extra local hook
files.
