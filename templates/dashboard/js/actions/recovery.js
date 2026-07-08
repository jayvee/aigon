
import { state } from '../state.js';
import * as H from './shared.js';
/** F563/F569 action module: review recovery primitives and grouped autonomous recovery. */

const CANCEL_ACTIONS = new Set([
  'feature-cancel-code-review',
  'research-cancel-code-review',
]);

const CANCEL_COPY = {
  'feature-cancel-code-review': {
    title: 'Cancel code review?',
    message: (id) => 'End the in-progress code review for feature #' + id + '? The reviewer session stops and the feature returns to ready so you can pick a new reviewer.',
    confirmLabel: 'Cancel code review',
  },
  'research-cancel-code-review': {
    title: 'Cancel code review?',
    message: (id) => 'End the in-progress code review for research #' + id + '? The reviewer session stops and the topic returns to ready.',
    confirmLabel: 'Cancel code review',
  },
};

const RECOVERY_COPY = {
  'cancel-review': {
    title: 'Cancel review',
    detail: 'Stop the current code review and return the feature to ready so review can be run again.',
    confirm: true,
  },
  'rerun-review': {
    title: 'Re-run code review',
    detail: 'Start a fresh code review using the existing review command.',
  },
  'rerun-eval': {
    title: 'Re-run evaluation',
    detail: 'Run the current evaluation command again if it is available.',
  },
  'retry-close': {
    title: 'Retry close',
    detail: 'Retry the existing close operation when the feature is ready.',
  },
  'take-over-manually': {
    title: 'Take over manually',
    detail: 'Stop the autonomous controller and continue as the operator.',
  },
  'resume-automation': {
    title: 'Resume automation',
    detail: 'Restart AutoConductor from the current workflow state using persisted agents.',
  },
  'start-code-revision': {
    title: 'Start code revision',
    detail: 'Inject the code revision prompt into the implementing agent session.',
  },
  'reset': {
    title: 'Reset feature',
    detail: 'Reset workflow state for this feature. Use this only when safer recovery paths are not appropriate.',
    destructive: true,
    confirm: true,
  },
};

function esc(value) {
  return H.escHtml(String(value == null ? '' : value));
}

function formatDate(value) {
  if (!value) return 'n/a';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

function normalizeController(ctx) {
  const payloadController = ctx.va && ctx.va.payload && ctx.va.payload.controller ? ctx.va.payload.controller : {};
  const featureController = ctx.feature && ctx.feature.autonomousController ? ctx.feature.autonomousController : {};
  return { ...featureController, ...payloadController };
}

function operationCopy(operation) {
  const meta = RECOVERY_COPY[operation.kind] || {};
  return {
    title: meta.title || operation.label || operation.kind,
    detail: meta.detail || operation.command || operation.action || '',
    destructive: Boolean(operation.destructive || meta.destructive),
    confirm: Boolean(meta.confirm),
  };
}

function getOperations(ctx) {
  const ops = ctx.va && ctx.va.payload && Array.isArray(ctx.va.payload.operations)
    ? ctx.va.payload.operations
    : [];
  return ops.filter(op => op && op.kind && op.action);
}

function renderOperationButton(operation, role) {
  const copy = operationCopy(operation);
  const cls = copy.destructive
    ? 'btn btn-danger recovery-op-btn'
    : (role === 'recommended' ? 'btn btn-primary recovery-op-btn' : 'btn btn-secondary recovery-op-btn');
  return '<button type="button" class="' + cls + '" data-recovery-kind="' + esc(operation.kind) + '">' +
    '<span class="recovery-op-title">' + esc(copy.title) + '</span>' +
    (copy.detail ? '<span class="recovery-op-detail">' + esc(copy.detail) + '</span>' : '') +
  '</button>';
}

function renderOperationSection(title, operations, role) {
  if (!operations.length) {
    return '<section class="recovery-modal-section recovery-modal-section-empty">' +
      '<h4>' + esc(title) + '</h4>' +
      '<div class="recovery-empty">No current command available.</div>' +
    '</section>';
  }
  return '<section class="recovery-modal-section">' +
    '<h4>' + esc(title) + '</h4>' +
    '<div class="recovery-op-list">' + operations.map(op => renderOperationButton(op, role)).join('') + '</div>' +
  '</section>';
}

function buildDiagnosticsHtml(controller, va) {
  const rawReason = controller.reason || '';
  const humanReason = controller.reasonLabel || controller.error || va.reason || '';
  const updatedAt = controller.updatedAt || controller.endedAt || controller.startedAt || null;
  const sessionName = controller.sessionName || '';
  const sessionState = sessionName
    ? (controller.sessionRunning ? 'live' : 'exited')
    : 'n/a';
  const rows = [
    ['Controller status', controller.status || 'unknown'],
    ['Raw reason', rawReason || 'n/a'],
    ['Human reason', humanReason || 'n/a'],
    ['Last update', formatDate(updatedAt)],
    ['Session liveness', sessionName ? sessionName + ' (' + sessionState + ')' : sessionState],
    ['Workflow state', controller.workflowState || 'n/a'],
  ];
  return '<section class="recovery-modal-section">' +
    '<h4>Diagnostics</h4>' +
    '<dl class="recovery-diagnostics">' +
      rows.map(([label, value]) => '<div><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>').join('') +
    '</dl>' +
  '</section>';
}

function buildControllerLogHtml(controllerLog) {
  const log = controllerLog || {};
  if (!log.available) {
    return '<section class="recovery-modal-section">' +
      '<h4>Controller log</h4>' +
      '<div class="recovery-empty">' + esc(log.reason || 'Controller log is not available for this autonomous run.') + '</div>' +
    '</section>';
  }
  return '<section class="recovery-modal-section">' +
    '<h4>Controller log</h4>' +
    '<button type="button" class="btn btn-secondary" id="autonomous-controller-log-view">View controller log</button>' +
    '<div class="controller-log-view" id="autonomous-controller-log-viewer" hidden></div>' +
  '</section>';
}

function renderControllerLogView(target, data, controller, feature) {
  if (!data || !data.available) {
    target.innerHTML = '<div class="recovery-empty">' + esc((data && data.reason) || 'Controller log is not available for this autonomous run.') + '</div>';
    return;
  }
  const sessionName = data.sessionName || controller.sessionName || 'n/a';
  const content = data.content || '';
  target.innerHTML =
    '<dl class="recovery-diagnostics controller-log-meta">' +
      '<div><dt>Controller status</dt><dd>' + esc(controller.status || 'unknown') + '</dd></div>' +
      '<div><dt>Feature ID</dt><dd>' + esc(feature.id) + '</dd></div>' +
      '<div><dt>Session name</dt><dd>' + esc(sessionName) + '</dd></div>' +
    '</dl>' +
    (data.truncated ? '<div class="controller-log-truncated">Showing the latest captured output.</div>' : '') +
    '<pre class="controller-log-output">' + esc(content || '(captured output is empty)') + '</pre>';
}

async function viewControllerLog(ctx, controller, viewer, btn) {
  viewer.hidden = false;
  viewer.innerHTML = '<div class="recovery-empty">Loading controller log...</div>';
  btn.disabled = true;
  try {
    const url = '/api/features/' + encodeURIComponent(String(ctx.feature.id)) +
      '/controller-log?repoPath=' + encodeURIComponent(ctx.repoPath || '');
    const res = await fetch(url, { cache: 'no-store' });
    const data = await res.json();
    renderControllerLogView(viewer, data, controller, ctx.feature);
  } catch (e) {
    viewer.innerHTML = '<div class="recovery-empty">Controller log could not be loaded: ' + esc(e.message || e) + '</div>';
  } finally {
    btn.disabled = false;
  }
}

async function executeRecoveryOperation(ctx, operation, modal) {
  const copy = operationCopy(operation);
  if (copy.confirm) {
    const ok = await H.showConfirm({
      title: copy.title + '?',
      message: copy.detail || ('Run ' + operation.action + '?'),
      confirmLabel: copy.title,
      cancelLabel: 'Cancel',
      danger: copy.destructive || operation.kind === 'cancel-review',
    });
    if (!ok) return;
  }
  const btn = modal.querySelector('[data-recovery-kind="' + CSS.escape(operation.kind) + '"]') || ctx.btn;
  await H.requestAction(operation.action, [String(ctx.feature.id)], ctx.repoPath, btn);
  modal.remove();
}

function openAutonomousRecovery(ctx) {
  const { va, feature } = ctx;
  const operations = getOperations(ctx);
  const recommendedKind = va.payload && va.payload.recommendedRecoveryKind;
  const nextKind = va.payload && va.payload.nextRecoveryKind;
  const recommended = operations.filter(op => op.kind === recommendedKind);
  const destructive = operations.filter(op => op.destructive || operationCopy(op).destructive);
  const secondary = operations.filter(op =>
    op.kind !== recommendedKind
    && !destructive.includes(op)
  );
  const controller = normalizeController(ctx);
  const controllerLog = (va.payload && va.payload.controllerLog) || controller.controllerLog || null;

  const existing = document.getElementById('autonomous-recovery-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'autonomous-recovery-modal';
  modal.className = 'modal-backdrop';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'autonomous-recovery-title');

  const box = document.createElement('div');
  box.className = 'modal-box recovery-modal-box';
  const subtitle = 'Feature #' + feature.id + (feature.name ? ' ' + String(feature.name).replace(/-/g, ' ') : '');
  const nextHtml = nextKind
    ? '<div class="recovery-next-path">After this, use <strong>' + esc((RECOVERY_COPY[nextKind] && RECOVERY_COPY[nextKind].title) || nextKind) + '</strong>.</div>'
    : '';
  box.innerHTML =
    '<h3 id="autonomous-recovery-title">Recover autonomous run</h3>' +
    '<p class="modal-desc">' + esc(subtitle) + '</p>' +
    renderOperationSection('Recommended action', recommended, 'recommended') +
    nextHtml +
    renderOperationSection('Secondary actions', secondary, 'secondary') +
    buildDiagnosticsHtml(controller, va) +
    buildControllerLogHtml(controllerLog) +
    renderOperationSection('Destructive actions', destructive, 'destructive') +
    '<div class="modal-actions recovery-modal-actions">' +
      '<button type="button" class="btn" id="autonomous-recovery-close">Close</button>' +
    '</div>';
  modal.appendChild(box);
  document.body.appendChild(modal);

  function close() { modal.remove(); }
  box.querySelector('#autonomous-recovery-close').onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };
  box.querySelectorAll('[data-recovery-kind]').forEach((btn) => {
    btn.onclick = async () => {
      const kind = btn.getAttribute('data-recovery-kind');
      const operation = operations.find(op => op.kind === kind);
      if (!operation) return;
      await executeRecoveryOperation(ctx, operation, modal);
    };
  });
  const logBtn = box.querySelector('#autonomous-controller-log-view');
  const logViewer = box.querySelector('#autonomous-controller-log-viewer');
  if (logBtn && logViewer) {
    logBtn.onclick = () => viewControllerLog(ctx, controller, logViewer, logBtn);
  }
}

export async function open(ctx) {
  const { va, feature, repoPath, btn } = ctx;
  const action = va.action;
  if (action === 'autonomous-recover') {
    openAutonomousRecovery(ctx);
    return;
  }
  if (!CANCEL_ACTIONS.has(action)) return;

  const copy = CANCEL_COPY[action];
  const showConfirm = H.showConfirm || (typeof window.showConfirm === 'function' ? window.showConfirm : null);
  if (!showConfirm) {
    await H.requestAction(action, [String(feature.id)], repoPath, btn);
    return;
  }
  const ok = await showConfirm({
    title: copy.title,
    message: copy.message(feature.id),
    confirmLabel: copy.confirmLabel,
    cancelLabel: 'Keep reviewing',
    danger: true,
  });
  if (!ok) return;
  await H.requestAction(action, [String(feature.id)], repoPath, btn);
}
