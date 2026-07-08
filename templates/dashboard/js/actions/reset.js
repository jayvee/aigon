
import { state } from '../state.js';
import * as H from './shared.js';
/** F519 action module: reset */

export async function open(ctx) {
  const { va, feature, repoPath, btn, pipelineType } = ctx;
  const id = feature.id;
  if (va.action === 'research-reset') {
    const msg = (va.metadata && va.metadata.confirmationMessage)
      || 'Reset this research topic? This cannot be undone.';
    const ok = await H.showDangerConfirm({
      title: 'Reset research #' + id + (feature.name ? ' — ' + feature.name : '') + '?',
      message: msg,
      confirmLabel: 'Reset research',
      cancelLabel: 'Cancel'
    });
    if (!ok) return;
    await H.requestAction('research-reset', [id], repoPath, btn);
    return;
  }
  const msg = (va.metadata && va.metadata.confirmationMessage)
    || 'Kill tmux sessions, remove the worktree and branch (including any uncommitted work on the branch), clear engine state, and move the spec back to Backlog. This cannot be undone.';
  const ok = await H.showDangerConfirm({
    title: 'Reset feature #' + id + (feature.name ? ' — ' + feature.name : '') + '?',
    message: msg,
    confirmLabel: 'Reset feature',
    cancelLabel: 'Cancel'
  });
  if (!ok) return;
  await H.requestAction('feature-reset', [id], repoPath, btn);
}



