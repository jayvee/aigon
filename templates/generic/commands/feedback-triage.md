<!-- description: Triage feedback <ID> with AI-assisted recommendations -->
# aigon-feedback-triage

Run a triage loop for one feedback item with explicit human confirmation before writes.

## Step 1: Load context

Run:

```bash
aigon feedback-triage {{ARG1_SYNTAX}}
```

Then gather broader context:

```bash
aigon feedback-list --all
```

## Step 2: Produce triage recommendation

Use the feedback file content plus CLI output to propose:
- `type`
- `severity`
- `tags`
- duplicate candidates (based on title + summary similarity)
- next action: keep, mark duplicate, promote to feature, promote to research, wont-fix

When duplicates are plausible, include candidate IDs with rationale.

## Step 3: Ask for confirmation (required)

Before writing anything, present the proposed values and ask the user to confirm.

Do not apply triage changes until the user explicitly says yes.

## Step 4: Apply only after confirmation

After confirmation, run:

```bash
aigon feedback-triage {{ARG1_SYNTAX}} --type <type> --severity <severity> --tags <tag1,tag2> --status <status> [--duplicate-of <ID>] --apply --yes
```

Notes:
- Use `--severity none` to clear severity
- Use `--tags none` to clear tags
- Use `--duplicate-of none` to clear duplicate linkage
- Duplicate status requires `duplicate_of`

## Step 5: Verify outcome

Confirm the command output shows:
- front matter updates applied
- file moved to the correct feedback lifecycle folder for the new status

