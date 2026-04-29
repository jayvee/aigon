# Feature: aigon-eval fixture feature

## Summary

Make one small deterministic code change for the aigon-eval harness.

## Acceptance Criteria

- [ ] Edit only `eval-fixture.txt`.
- [ ] Replace the text `before` with `after`.
- [ ] Commit the change before signalling implementation complete.

## Validation

```bash
grep -q '^after$' eval-fixture.txt
```
