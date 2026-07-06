# Implementation Log: Feature 609 - git-branch-backend-core
Agent: cc

## Status
Implemented: `git-branch` backend (`lib/spec-store/git-branch-backend.js`) storing canonical events as `meta.json` + `specs/<KEY>/events.jsonl` on an orphan branch via new tree-plumbing helpers in `git-plumbing.js` (throwaway index, never checked out); registered in factory + storage-config; branch added to engine/adapter cache keys; unit + two-clone convergence tests green; leases stay advisory (deferred to git-branch-cas-leases). One gotcha: git-branch stores raw JSONL, so it needs its own `parseEventsJsonl` (git-ref's `parseEventsPayload` mis-reads a leading `{` as the wrapped payload form).

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage
