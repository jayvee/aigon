<!-- description: List feedback items with filters -->
# aigon-feedback-list

List feedback items for triage.

## Step 1: Run the CLI command

```bash
aigon feedback-list {{ARG_SYNTAX}}
```

## Filter options

- Status: `--inbox`, `--triaged`, `--actionable`, `--done`, `--wont-fix`, `--duplicate`, `--all`
- Metadata: `--type <type>`, `--severity <severity>`, `--tag <tag>`

Examples:

```bash
aigon feedback-list --inbox
aigon feedback-list --all --type bug --severity high
aigon feedback-list --all --tag auth
```

## If no args are provided

The command defaults to active triage lanes:
- inbox
- triaged
- actionable

