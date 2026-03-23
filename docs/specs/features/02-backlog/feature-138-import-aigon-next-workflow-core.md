# Feature: import-aigon-next-workflow-core

## Summary

Bring the hardened Aigon Next workflow core into Aigon as an internal module without changing existing command behavior yet. This feature establishes the new engine, persistence model, action derivation, and effect lifecycle primitives inside the main codebase so read-side consumers and later write-side migrations can use a shared foundation.

## User Stories

- As a maintainer, I want the new workflow core available inside Aigon so we can begin incremental migration instead of rewriting everything at once.
- As a dashboard/board consumer, I want a single snapshot/action model to be available so state can be interpreted consistently.
- As an AI agent working in Aigon, I want the new engine code to live in one obvious place with clear boundaries.

## Acceptance Criteria

- A new internal workflow module is added to Aigon containing the core Aigon Next concepts:
  - workflow types
  - event/snapshot persistence
  - lock handling
  - action derivation
  - effect lifecycle model
- The imported core is wired so it can be used by Aigon code paths, but existing feature commands remain the default behavior.
- The imported core is isolated behind clear module boundaries and does not require immediate dashboard or command migration.
- Tests cover core read/write behavior for the imported module inside Aigon.
- Documentation is updated to explain the new internal workflow-core layer and its intended migration role.

## Validation

```bash
npm test
node -c aigon-cli.js
```

Module-level validation:

- Core workflow tests from the imported Aigon Next slice pass inside Aigon.
- Snapshot/action derivation works against a temporary repo path.

## Technical Approach

- Create a new module area such as `lib/workflow/`.
- Import or adapt the hardened Aigon Next code into that area.
- Keep framework-agnostic workflow logic separate from Aigon CLI/dashboard adapters.
- Do not replace existing commands yet; this feature is foundational only.
- Preserve a clean seam for later selective adoption by dashboard/board/commands.

## Dependencies

- Depends on the current Aigon Next prototype being stable enough to serve as the source for the core engine concepts.
- Pairs naturally with the next features that consume the new read-side model.

## Out of Scope

- Replacing `feature-start`
- Replacing `feature-close`
- Full dashboard migration
- Full workflow-engine cutover

## Open Questions

- Which parts of Aigon Next should be imported verbatim versus adapted to Aigon naming and file conventions?
- Should the imported core live behind an explicit feature flag from day one, or simply remain unused until the first consumer is wired up?

## Related

- `docs/aigon-next-prototype-bootstrap.md`
- `docs/architecture.md`

