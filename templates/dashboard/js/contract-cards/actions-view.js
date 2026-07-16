/* dashboard-esm-processed */

// F679 contract card renderer — action bar and overflow menu.
//
// Eligibility, labels, ordering hints, intent, and the single primary action
// are server facts on the contract. This module only partitions and styles;
// it never appends, suppresses, re-ranks, or re-labels an action. Buttons emit
// the legacy dispatch hooks (`kcard-va-btn`, `data-va-action`, `data-agent`)
// so the caller's existing validated /api/action wiring handles every click.

import { escHtml } from './html.js';

function isDanger(action) {
  return action.intent === 'danger' || Boolean(action.interaction && action.interaction.destructive);
}

/** Card-surface actions only; agent-surface actions render inside agent rows. */
export function cardSurfaceActions(contract) {
  const decisions = (contract.decisions && contract.decisions.actions) || [];
  const tools = contract.tools || [];
  return decisions.concat(tools)
    .filter(action => !action.interaction || action.interaction.surface !== 'agent')
    .filter(action => action.scope !== 'agent' && action.scope !== 'session')
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

/**
 * Partition per the approved gallery hierarchy: one primary (server-named),
 * a small number of visible secondaries, everything else in overflow.
 */
export function partitionCardActions(contract, options = {}) {
  const all = cardSurfaceActions(contract);
  const primaryId = contract.decisions && contract.decisions.primaryActionId;
  const primary = primaryId
    ? all.find(action => action.actionId === primaryId && !action.disabled && !action.agentId) || null
    : null;
  const secondaryBudget = options.compact ? (primary ? 0 : 1) : (primary ? 1 : 2);
  const secondary = all
    .filter(action => action !== primary && action.group !== 'tool' && !isDanger(action) && !action.agentId)
    .slice(0, secondaryBudget);
  const overflow = all.filter(action => action !== primary && !secondary.includes(action));
  return { primary, secondary, overflow };
}

export function agentSurfaceActions(contract, agentId = null) {
  const decisions = (contract.decisions && contract.decisions.actions) || [];
  const tools = contract.tools || [];
  return decisions.concat(tools)
    .filter(action => action.interaction && action.interaction.surface === 'agent')
    .filter(action => agentId == null || action.agentId === agentId)
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

/**
 * Solo status rows own agent actions plus feature-level tools explicitly
 * scoped to the active session. Card decisions remain in the footer.
 */
export function soloSessionActions(contract) {
  const decisions = (contract.decisions && contract.decisions.actions) || [];
  const tools = contract.tools || [];
  const sessionActions = decisions.concat(tools)
    .filter(action => action.scope === 'session' && action.interaction && action.interaction.surface !== 'agent');
  return agentSurfaceActions(contract).concat(sessionActions)
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

export function actionButtonHtml(action, cls) {
  const classes = [cls, 'kcard-va-btn'];
  if (isDanger(action)) classes.push('is-danger');
  const reason = action.disabled ? (action.unavailableReason || 'Action unavailable') : '';
  return '<button type="button" class="' + classes.join(' ') + '"'
    + ' data-va-action="' + escHtml(action.actionId) + '"'
    + (action.agentId ? ' data-agent="' + escHtml(action.agentId) + '"' : '')
    + (action.disabled ? ' disabled' : '')
    + (reason ? ' title="' + escHtml(reason) + '"' : '')
    + '>' + escHtml(action.label) + '</button>';
}

/**
 * Overflow reuses the legacy `.kcard-overflow` structure so the pipeline's
 * existing toggle wiring, fixed-position menu, and outside-click dismissal
 * apply to preview cards without new code paths.
 */
export function overflowMenuHtml(actions, label = 'More actions') {
  if (!actions.length) return '';
  const items = actions
    .map(action => actionButtonHtml(action, 'kcard-overflow-item' + (isDanger(action) ? ' btn-danger' : '')))
    .join('');
  return '<div class="kcard-overflow ccard-overflow">'
    + '<button class="btn btn-overflow kcard-overflow-toggle" type="button" aria-label="' + escHtml(label) + '" title="' + escHtml(label) + '">⋯</button>'
    + '<div class="kcard-overflow-menu">' + items + '</div></div>';
}

export function actionBarHtml(contract, options = {}) {
  const { primary, secondary, overflow } = partitionCardActions(contract, options);
  let html = '';
  if (primary) html += actionButtonHtml(primary, 'ccard-action is-primary');
  html += secondary.map(action => actionButtonHtml(action, 'ccard-action')).join('');
  if (!options.suppressOverflow) html += overflowMenuHtml(overflow, 'More card actions');
  if (!html) return '';
  return '<div class="ccard-actions kcard-transitions">' + html + '</div>';
}
