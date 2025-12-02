<!-- description: Evaluate feature <ID> - submit for review -->
# ff-feature-eval

Run this command followed by the Feature ID.

```bash
ff feature-eval {{ARG_SYNTAX}}
```

This moves the feature from `03-in-progress/` to `04-in-evaluation/` for review.

This step is optional - you can go directly to `{{CMD_PREFIX}}feature-done` if not doing a multi-agent bake-off.
