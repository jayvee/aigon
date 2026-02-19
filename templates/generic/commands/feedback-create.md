<!-- description: Create feedback <title> -->
# aigon-feedback-create

Create a new feedback item in `docs/specs/feedback/01-inbox/`.

## Step 1: Run the CLI command

```bash
aigon feedback-create {{ARG_SYNTAX}}
```

## Argument resolution

If no title is provided:
1. Ask the user for a short title
2. Re-run `aigon feedback-create "<title>"`

## Expected result

- A new file `feedback-<ID>-<slug>.md` is created in inbox
- Front matter includes the assigned ID and title
- The command output prints the next step (`aigon feedback-triage <ID>`)

## Follow-up

After creation, read the new file and fill in:
- `## Summary`
- `## Evidence`
- attribution fields (`reporter`, `source`)

