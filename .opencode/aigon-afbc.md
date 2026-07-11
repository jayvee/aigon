---
description: Create feedback <title> (shortcut for feedback-create)
argument-hint: "<title>"
---
# aigon-feedback-create

Legacy no-op. Feedback intake now lives in research with `origin: customer-feedback`.

## Step 1: Do not create a feedback item

```bash
aigon feedback-create $ARGUMENTS
```

## Argument resolution

This command prints the deprecation notice and exits without creating a file.

## Expected result

- No feedback file is created
- The command output tells you to use `aigon research-create` with `origin: customer-feedback`

## Follow-up

Capture the input as research instead.
