/* dashboard-esm-processed */

// F679 contract card renderer — card composition.
//
// The versioned uiContract is the only semantic input: identity, state,
// actions, blockers, agents, sessions, and plans are server facts. Options
// carry view concerns only (density, badge text, a session Peek gate, and the
// caller's wiring hooks) — never workflow policy. Feature and research cards
// share these primitives end to end; entity vocabulary arrives in the
// contract's own labels.

import { escHtml } from './html.js';
import { actionBarHtml } from './actions-view.js';
import { activityHtml, blockersHtml, soloStatusBarAgent, statusBarHtml } from './activity-view.js';
import { runPlanHtml, setCyclePillsHtml, setPlanHtml } from './plan-view.js';

function severityOf(contract) {
  const severity = contract.state && contract.state.severity;
  return severity === 'error' || severity === 'warning' ? severity : 'normal';
}

// One dominant state line: the server headline verb, falling back to the
// state label. Identity renders once — no slug echo, no entity-type label.
function headHtml(contract, options) {
  const entity = contract.entity || {};
  const showKey = entity.kind !== 'feature-set' && entity.displayKey;
  const kind = entity.kind === 'feature-set'
    ? '<span class="ccard-kind">Feature set</span>'
    : '';
  const badge = options.badgeLabel
    ? '<span class="ccard-badge"'
      + (options.badgeTitle ? ' title="' + escHtml(options.badgeTitle) + '" aria-label="' + escHtml(options.badgeTitle) + '"' : '')
      + '>' + escHtml(options.badgeLabel) + '</span>'
    : '';
  return '<div class="ccard-head">'
    + '<div class="ccard-identity">'
    + kind
    + (showKey ? '<span class="ccard-key">' + escHtml(entity.displayKey) + '</span>' : '')
    + '<h3 class="ccard-title">' + escHtml(entity.title || entity.name || entity.id) + '</h3>'
    + '</div>' + badge + '</div>';
}

function stateLineHtml(contract) {
  const headline = contract.presentation && contract.presentation.headline;
  const text = (headline && (headline.verb || headline.label)) || (contract.state && contract.state.label) || '';
  if (!text) return '';
  return '<div class="ccard-state"><span class="ccard-state-dot" aria-hidden="true"></span>'
    + '<span class="ccard-state-text">' + escHtml(text) + '</span></div>';
}

function contextHtml(contract) {
  const context = contract.presentation && contract.presentation.contextLine;
  return context ? '<p class="ccard-context">' + escHtml(context) + '</p>' : '';
}

/**
 * Feature / research card body. Returns an HTML string; the caller owns the
 * card element, drag behavior, and event wiring.
 */
export function renderContractCardBody(contract, options = {}) {
  const compact = options.density === 'compact';
  const idleStack = options.setStackIdle === true;
  const soloAgent = soloStatusBarAgent(contract);
  const inner = [
    // suppressIdentity: the host already names this entity (e.g. a set's
    // "Current feature" heading) — titles appear exactly once.
    options.suppressIdentity ? '' : headHtml(contract, options),
    idleStack ? '' : (soloAgent ? statusBarHtml(contract, options) : stateLineHtml(contract)),
    idleStack ? '' : (compact ? '' : contextHtml(contract)),
    idleStack ? '' : blockersHtml(contract),
    idleStack || compact ? '' : activityHtml(contract, options),
    idleStack || compact ? '' : runPlanHtml(contract, options),
    (idleStack || options.suppressActions) ? '' : actionBarHtml(contract, {
      compact,
      suppressOverflow: Boolean(soloAgent),
    }),
  ].filter(Boolean).join('');
  return '<div class="ccard ccard-' + escHtml((contract.entity && contract.entity.kind) || 'feature')
    + ' is-severity-' + severityOf(contract)
    + (idleStack ? ' is-set-stack-idle' : '')
    + ' is-' + (compact ? 'compact' : 'expanded') + '">' + inner + '</div>';
}

/**
 * Feature-set card body: title once, spec-cycle and conductor pills, member
 * progress, and the current member's complete embedded contract.
 */
export function renderSetContractCardBody(contract, options = {}) {
  const pres = contract.presentation || {};
  const planPres = contract.plan && contract.plan.presentation;
  const memberCount = (contract.plan && contract.plan.members || []).length;
  const badgeLabel = options.badgeLabel
    || (memberCount ? memberCount + ' feature' + (memberCount === 1 ? '' : 's') : null);
  const inner = [
    headHtml(contract, { ...options, badgeLabel }),
    pres.suppressStateLine ? '' : stateLineHtml(contract),
    setCyclePillsHtml(contract, options),
    blockersHtml(contract),
    setPlanHtml(contract, {
      ...options,
      suppressMemberList: (planPres && planPres.suppressMemberList) || options.suppressMemberList === true,
      suppressProgress: planPres && planPres.suppressProgress === true,
      renderEmbedded: embedded => renderContractCardBody(embedded, {
        ...options,
        badgeLabel: null,
        density: 'expanded',
        suppressActions: true,
        suppressIdentity: true,
      }),
    }),
    options.suppressActions ? '' : actionBarHtml(contract, {}),
  ].filter(Boolean).join('');
  return '<div class="ccard ccard-feature-set is-severity-' + severityOf(contract) + ' is-expanded">' + inner + '</div>';
}
