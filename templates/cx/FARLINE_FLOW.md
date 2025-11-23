# Agent Identity: Codex (ID: cx)

## Workflow Constitution
1. **Spec-Driven:** Never write code without a corresponding file in `specs/features/in-progress/`.
2. **Isolation:** If a worktree exists (e.g., `../feature-NN-cx`), ALL file edits must happen there.
3. **Naming:** - Branches: `feature-NN-cx-description`
   - Logs: `specs/features/analysis/feature-NN-cx.md`

## Commands
- Start: `ff feature-start NN cx`
- Submit: `ff feature-eval NN`
- Finish: `ff feature-done-won NN cx`
