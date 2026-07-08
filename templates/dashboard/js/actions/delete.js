
import { state } from '../state.js';
import * as H from './shared.js';
/** F519 action module: delete */

export async function open(ctx) {
  const { va, feature, repoPath, btn, pipelineType } = ctx;
  const id = feature.id;
  const deleteCmd = pipelineType === 'research' ? 'research-delete' : 'feature-delete';
  const entityLabel = pipelineType === 'research' ? 'research' : 'feature';
  let msg = va.metadata && va.metadata.confirmationMessage;
  if (msg && entityLabel === 'research' && /\bfeature\b/i.test(msg)) msg = null;
  if (!msg) msg = 'Delete this ' + entityLabel + ' spec and its workflow state? This cannot be undone.';
  const ok = await H.showDangerConfirm({
    title: 'Delete ' + entityLabel + ' #' + id + (feature.name ? ' — ' + feature.name : '') + '?',
    message: msg,
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel'
  });
  if (!ok) return;
  await H.requestAction(deleteCmd, [id], repoPath, btn);
}



