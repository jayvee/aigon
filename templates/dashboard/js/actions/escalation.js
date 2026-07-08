
import * as H from './shared.js';
/** F519 action module: escalation disposition (F646) */

function subcommandFromAction(action) {
  if (action === 'feature-escalation-follow-up') return 'follow-up';
  if (action === 'feature-escalation-reopen') return 'reopen';
  return 'accept';
}

function titleForSubcommand(subcommand) {
  if (subcommand === 'follow-up') return 'Spin off follow-up feature';
  if (subcommand === 'reopen') return 'Reopen for revision';
  return 'Accept escalation';
}

export async function open(ctx) {
  const { va, feature, repoPath, btn } = ctx;
  const meta = (va && va.metadata) || {};
  const subcommand = meta.subcommand || subcommandFromAction(va.action);
  const index = meta.escalationIndex;
  const category = meta.category || 'escalation';
  const id = String(feature.id || '').trim();

  if (!index) {
    H.showToast('Missing escalation index', null, null, { error: true });
    return;
  }

  const existing = document.getElementById('escalation-disposition-modal');
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.id = 'escalation-disposition-modal';
  backdrop.className = 'modal-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');

  const box = document.createElement('div');
  box.className = 'modal-box agent-picker-modal-box';

  const needsReason = subcommand === 'accept' || subcommand === 'reopen';
  const needsName = subcommand === 'follow-up';
  const reasonField = needsReason
    ? '<div class="form-field">' +
      '<label class="form-label" for="escalation-disposition-reason">Reason (required)</label>' +
      '<textarea id="escalation-disposition-reason" class="create-input create-input--full" rows="3" placeholder="Audit trail for this disposition"></textarea>' +
      '</div>'
    : '';
  const nameField = needsName
    ? '<div class="form-field">' +
      '<label class="form-label" for="escalation-disposition-name">Follow-up feature slug</label>' +
      '<input type="text" id="escalation-disposition-name" class="create-input create-input--full" placeholder="my-follow-up-feature" />' +
      '</div>'
    : '';

  box.innerHTML =
    '<h3>' + H.escHtml(titleForSubcommand(subcommand)) + '</h3>' +
    '<p class="modal-desc">Feature #' + H.escHtml(id) +
    ' · escalation ' + H.escHtml(String(index)) +
    ' · [' + H.escHtml(category) + ']</p>' +
    reasonField +
    nameField +
    '<p id="escalation-disposition-msg" class="settings-empty" data-hidden></p>' +
    '<div class="modal-actions modal-actions--spaced">' +
    '<button type="button" class="btn" id="escalation-disposition-cancel">Cancel</button>' +
    '<button type="button" class="btn btn-primary" id="escalation-disposition-submit">Confirm</button>' +
    '</div>';

  backdrop.appendChild(box);
  document.body.appendChild(backdrop);

  let busy = false;
  function closeModal() { backdrop.remove(); }
  function closeUnlessBusy() { if (!busy) closeModal(); }

  box.querySelector('#escalation-disposition-cancel').onclick = closeUnlessBusy;
  backdrop.onclick = (e) => { if (e.target === backdrop) closeUnlessBusy(); };

  const reasonEl = box.querySelector('#escalation-disposition-reason');
  const nameEl = box.querySelector('#escalation-disposition-name');
  if (reasonEl && meta.reasonPreview) reasonEl.value = String(meta.reasonPreview);

  box.querySelector('#escalation-disposition-submit').onclick = async () => {
    const msg = box.querySelector('#escalation-disposition-msg');
    msg.setAttribute('data-hidden', '');
    const args = [subcommand, id, String(index)];
    if (needsReason) {
      const reason = String((reasonEl && reasonEl.value) || '').trim();
      if (!reason) {
        msg.textContent = 'Reason is required';
        msg.removeAttribute('data-hidden');
        return;
      }
      args.push('--reason', reason);
    }
    if (needsName) {
      const name = String((nameEl && nameEl.value) || '').trim();
      if (!name) {
        msg.textContent = 'Follow-up slug is required';
        msg.removeAttribute('data-hidden');
        return;
      }
      args.push('--name', name);
    }

    busy = true;
    try {
      await H.requestAction('feature-escalation', args, repoPath, btn);
      closeModal();
    } finally {
      busy = false;
    }
  };
}
