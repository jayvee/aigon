<!-- description: Prioritise feature <name> - assigns ID, moves to backlog -->
# aigon-feature-prioritise

Run this command followed by the feature name.

```bash
aigon feature-prioritise {{ARG_SYNTAX}}
```

This assigns an ID to the feature and moves it from `01-inbox/` to `02-backlog/`.

Next step - choose your mode:

**Solo mode** (single agent):
```bash
aigon feature-setup <ID>
```

**Arena mode** (multiple agents compete):
```bash
aigon feature-setup <ID> <agent1> <agent2> [agent3...]
```

Example arena: `aigon feature-setup 55 cc gg cx`
