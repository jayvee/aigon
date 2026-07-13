# Feature interaction contract

The executable feature interaction source is `FEATURE_INTERACTION_DEFINITION` in
`lib/feature-workflow-rules.js`. Its state metadata compiles lifecycle lanes,
phases, labels, and severity; its transitions compile the XState machine; and
its action definitions compile machine validation and dashboard descriptors.

The dashboard receives `uiContract.contractVersion = 1` on every non-lean
feature row. The contract separates `decisions.actions` from `tools`, names zero
or one `decisions.primaryActionId`, carries server-owned `allowedDrops`, and
provides normalized blockers, agents, sessions, state, and presentation data.
Collectors may normalize observations through `runtime-facts.js`, but they must
not append, suppress, rank, or reclassify actions after projection.

Each action descriptor exposes its stable action ID, event type (when durable),
scope, group, ordering, intent, disabled reason, and interaction requirements.
`interaction.handler` identifies the registered command, API, or client adapter;
`interaction.surface` tells the current UI whether the action belongs on the
feature card, an agent row, or an input surface. Browser code renders these
fields and does not infer workflow policy from lifecycle or session state.

Compatibility fields (`validActions`, `cardHeadline`, `cardPresentation`, and
`closeReadiness`) remain available during migration. They are not the feature
dashboard's eligibility or primary-action authority.
