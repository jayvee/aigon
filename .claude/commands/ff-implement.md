---
description: Switch context to worktree and implement spec
---
# ff-implement
Run this command followed by the Feature ID.

Example: `/ff-implement 01`

1. Find the directory named `../feature-{{args}}-cc-*` (ignore the suffix).
2. Switch your working directory to that folder using `cd`.
3. Read the spec in `../farline-flow/specs/features/in-progress/`.
4. Implement the feature according to the spec and commit your changes.
