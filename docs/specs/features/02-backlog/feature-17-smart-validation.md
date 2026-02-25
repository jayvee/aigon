# Feature 17: Smart Validation

## Summary

LLM-powered acceptance criteria evaluation and profile-aware validation scripts. Enhances the Ralph loop (Feature 16) by going beyond exit-code-based validation — using an LLM to evaluate whether subjective acceptance criteria are actually met, and providing a framework for custom project validation.

This is the bridge between "did the tests pass?" and "did we actually build what was asked for?"

## User Stories

- [ ] As a developer, I want the agent to automatically check acceptance criteria against the actual code changes so I know if the feature is truly done
- [ ] As a developer, I want to define custom validation scripts per project so the loop validates what matters to my stack
- [ ] As a developer, I want objective criteria (tests pass, builds succeed) auto-checked without LLM calls
- [ ] As a developer, I want the spec's checkboxes updated automatically as criteria are verified

## Acceptance Criteria

- [ ] Parse `- [ ]` checkboxes from feature spec's Acceptance Criteria section
- [ ] Classify criteria as objective (testable via commands) or subjective (needs LLM evaluation)
- [ ] Objective criteria checked via command output (test results, build status, lint output)
- [ ] Subjective criteria evaluated by LLM against git diff, test output, and implementation log
- [ ] Update spec file: `- [ ]` becomes `- [x]` when criteria verified
- [ ] Custom validation script support via `.aigon/validation.sh`
- [ ] Profile-specific validation presets (web: npm test/build/lint, iOS: xcodebuild, etc.)
- [ ] Validation results returned in structured format for Ralph loop consumption
- [ ] Dry-run mode that shows what would be checked without running

## Technical Approach

### Criteria Parser

Extract acceptance criteria from feature spec markdown:

```javascript
function parseAcceptanceCriteria(specContent) {
  const criteria = [];
  const lines = specContent.split('\n');
  let inSection = false;

  for (const line of lines) {
    if (line.match(/^## Acceptance Criteria/)) { inSection = true; continue; }
    if (inSection && line.match(/^## /)) break;
    const match = line.match(/^- \[([ x])\] (.+)$/);
    if (match) {
      criteria.push({
        checked: match[1] === 'x',
        text: match[2],
        type: classifyCriterion(match[2])
      });
    }
  }
  return criteria;
}
```

### Criterion Classification

```javascript
function classifyCriterion(text) {
  // Objective: can be verified by command output
  const objectivePatterns = [
    /tests? pass/i, /builds? succeed/i, /lint/i,
    /type.?check/i, /no errors/i, /compiles/i
  ];
  if (objectivePatterns.some(p => p.test(text))) return 'objective';

  // Subjective: needs LLM evaluation
  return 'subjective';
}
```

### LLM Evaluation

For subjective criteria, send evaluation prompt to agent's model:

```
Given this acceptance criterion: "{criterion text}"

Code changes (git diff):
{diff output}

Test results:
{test output}

Implementation log:
{log summary}

Does this implementation satisfy the criterion?
Answer: YES or NO
Reasoning: (brief explanation)
```

### Custom Validation Scripts

Projects define `.aigon/validation.sh`:

```bash
#!/bin/bash
# Exit 0 for success, non-zero for failure
npm test || exit 1
npm run lint || exit 2
npm run type-check || exit 3
exit 0
```

### Profile Validation Presets

Extend existing profile placeholders:

| Profile | Commands |
|---------|----------|
| web | `npm test`, `npm run build`, `npm run lint` |
| api | test suite + endpoint smoke test |
| ios | `xcodebuild test` |
| android | `./gradlew test` |
| library | test suite + build |
| generic | `.aigon/validation.sh` or user-defined |

### Integration with Ralph (Feature 16)

Smart Validation is called at the end of each Ralph iteration as the validation step. Without Feature 17, Ralph uses simple exit codes. With Feature 17, Ralph gets:
- Granular criteria tracking (which criteria pass/fail per iteration)
- LLM evaluation of subjective criteria
- Auto-updated spec checkboxes

## Out of Scope

- Multi-agent coordination → Feature 18: Conductor
- The loop itself → Feature 16: Ralph
- CI/CD integration (local validation only)
- Caching validation results across iterations

## Open Questions

1. **LLM cost**: Evaluating criteria each iteration adds API calls. Use cheaper models for this?
2. **Accuracy**: How reliable is LLM evaluation of subjective criteria? Require human approval for subjective ones?
3. **Partial checking**: If 4/5 criteria pass, should the spec show 4 checked and 1 unchecked?

## Dependencies

- Feature 16: Ralph Wiggum Loop (primary consumer)
- Profile system (validation command presets)
- Feature spec format (checkbox convention)

## Related

- Feature 16: Ralph Wiggum Loop (enhanced by this feature)
- Feature 18: Conductor (uses validation results for multi-agent coordination)
