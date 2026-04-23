<!-- description: Prioritise every inbox feature in a set — IDs assigned in dependency order -->
# aigon-set-prioritise

**CRITICAL:** Use the CLI below. Do not manually rename inbox specs or assign IDs — the command runs `feature-prioritise` per member in topological order so `depends_on` stays valid.

## When to use

- Several specs share the same `set: <slug>` and live in `01-inbox/` (no numeric id yet).
- Inbox specs reference each other with `depends_on` using **slugs** (or numeric ids for already-backlog features).

## Step 1: Run the CLI

```bash
aigon set-prioritise {{ARG_SYNTAX}}
```

Alias: `aigon asp <slug>`.

This assigns sequential feature ids and moves each member to `02-backlog/` in an order consistent with intra-set dependencies.

## Step 2: Next steps

After prioritisation, start work on the first backlog member (or the whole set in Pro):

```
{{CMD_PREFIX}}feature-start <ID> <agent>
```

For set-level autonomous execution (Pro):

```
{{CMD_PREFIX}}set-autonomous-start <slug> <agents...>
```

## Prompt Suggestion

End with the suggested next command, using a real id from the CLI output:

`{{CMD_PREFIX}}feature-start <ID>`
