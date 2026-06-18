/** F563 action module: review recovery primitives (cancel code review) */
import * as H from './shared.js';

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

export async function open(ctx) {
  const { va, feature, repoPath, btn } = ctx;
  const action = va.action;
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
