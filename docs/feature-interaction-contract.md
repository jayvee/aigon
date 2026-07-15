# Feature interaction contract

The executable feature interaction source is `FEATURE_INTERACTION_DEFINITION` in
`lib/feature-workflow-rules.js`. Its state metadata compiles lifecycle lanes,
phases, labels, and severity; its transitions compile the XState machine; and
its action definitions compile machine validation and dashboard descriptors.

The dashboard receives `uiContract.contractVersion = 3` on every interactive
feature, research, and feature-set card (F678). Research uses
`research-ui-contract.js` and sets `feature-set-ui-contract.js`; all three share
the validated envelope in `entity-ui-contract.js`. Done feature rows are exempt:
they ship the lean shape (F459/F469/F590) with no actions or sessions, so a
contract would be an empty envelope. The contract separates `decisions.actions`
from `tools`, names zero or one `decisions.primaryActionId`, carries server-owned
`allowedDrops`, and provides normalized blockers, agents, sessions, state, and
presentation data. Collectors may normalize observations through
`runtime-facts.js`, but they must not append, suppress, rank, or reclassify
actions after projection.

`entity` is server-owned identity: `kind`, `id`, `numericId` (null for sets and
pre-F667 slug-keyed specs — never a coerced NaN), `displayKey`, `title`, machine
`slug`, and `set` membership. The renderer must not rebuild any of these.

Sessions carry a normalized `sessionStatus` (`running`, `completed`, `stopped`,
`lost`, `failed`) and an `inspection` block whose `target` is `live-pane` while
running and `console-snapshot` once ended, so retained output stays reachable in
every terminal state. A session owned by an autonomous stage is marked
`stageOwned` with its `owningStageType`; it renders inside that stage and is not
repeated as a peer activity row. Actions marked `metadata.uiVisibility:
'internal'` are quarantined into `internalSignals` and never offered to an
operator.

Feature-set contracts expose `state.specCycle` — server-owned review and
revision status, pending feedback count, completed member count, latest commit,
and inspectable session references. Spec-cycle status is derived from member
snapshots and workflow events, never from whether a tmux session still exists. A
running set embeds its current member's complete feature contract at
`plan.currentFeatureContract`, review and revision stages intact, rather than
flattening it to a generic working row.

Anything that must repaint a card belongs in `entityUiContractFingerprint`,
which `computeStatusFingerprint` (`lib/dashboard-status-version.js`) folds in for
features, research, and sets — including nested member contracts. It hashes
repaint-relevant facts only; timestamps and prose stay out so cards do not
repaint on every poll.

Each action descriptor exposes its stable action ID, event type (when durable),
scope, group, ordering, intent, disabled reason, and interaction requirements.
`interaction.handler` identifies the registered command, API, or client adapter;
`interaction.surface` tells the current UI whether the action belongs on the
feature card, an agent row, or an input surface. Browser code renders these
fields and does not infer workflow policy from lifecycle or session state.

Compatibility fields (`validActions`, `cardHeadline`, `cardPresentation`, and
`closeReadiness`) remain available during migration. They are not the feature
dashboard's eligibility or primary-action authority.

The browser side of this contract is the production renderer
(`templates/dashboard/js/contract-cards/`): pure contract → HTML modules shared
verbatim by the production pipeline and the design gallery. It renders identity once, one dominant state line, agent
and session rows, plan stages in stable columns, and actions partitioned from
`decisions.primaryActionId` — and it dispatches through the same validated
`/api/action` and session Peek boundaries as the legacy card builder.

Duplicate or malformed contracts fail deterministically at the collector, which
raises the entity id rather than shipping a row the browser has to guess about.
Divergence between the legacy action source and the contract must be fixed in
the workflow definition or the projector — never deduped or patched in the
browser. F678 found two `PAUSE_FEATURE` candidates sharing an inbox/backlog
guard. Operators never saw a second Pause button, because the legacy browser
path deduped on `action + agentId` and hid the producer defect — the exact
patching this contract removes. Validation surfaced it immediately.
