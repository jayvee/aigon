/** F519 action module: set-autonomous */
import * as H from './shared.js';


async function handleSetActionModule(ctx) {
  const va = ctx.va;
  const setCard = ctx.setCard;
  const repoPath = ctx.repoPath;
  const btn = ctx.btn;
  const slug = String(setCard && setCard.slug || '');
  if (!slug) return;

  switch (va.action) {
    case 'set-autonomous-start': {
      const pick = await H.showAgentPicker(slug, 'set ' + slug, {
        title: 'Choose set agents',
        submitLabel: 'Start set',
        repoPath,
        taskType: 'implement',
        action: va.action,
        collectTriplet: true,
        includeSetReviewer: true,
      });
      if (!pick || !Array.isArray(pick.triplets) || pick.triplets.length === 0) return;
      const triplets = pick.triplets;
      const agentIds = triplets.map(t => t.id);
      const triArgs = H.tripletsToCliArgs(triplets);
      const modelsCsv = (triArgs.find(a => a.startsWith('--models=')) || '').slice('--models='.length) || '';
      const effortsCsv = (triArgs.find(a => a.startsWith('--efforts=')) || '').slice('--efforts='.length) || '';
      const reviewAgent = String(pick.reviewAgent || '').trim();
      const reviewModel = String(pick.reviewModel || '').trim();
      const reviewEffort = String(pick.reviewEffort || '').trim();
      const mergedModels = [modelsCsv, reviewAgent && reviewModel ? (`${reviewAgent}=${reviewModel}`) : ''].filter(Boolean).join(',');
      const mergedEfforts = [effortsCsv, reviewAgent && reviewEffort ? (`${reviewAgent}=${reviewEffort}`) : ''].filter(Boolean).join(',');
      const args = [slug, ...agentIds, '--stop-after=close'];
      if (reviewAgent) args.push(`--review-agent=${reviewAgent}`);
      if (mergedModels) args.push(`--models=${mergedModels}`);
      if (mergedEfforts) args.push(`--efforts=${mergedEfforts}`);
      try {
        if (typeof H.fetchBudget === 'function') {
          await H.fetchBudget();
          const warning = H.budgetWarningForAgents([...agentIds, reviewAgent].filter(Boolean));
          if (warning && !window.confirm(warning)) return;
        }
      } catch (_) { /* best-effort */ }
      await H.requestAction('set-autonomous-start', args, repoPath, btn);
      break;
    }
    case 'set-autonomous-reset': {
      const message = (va.metadata && va.metadata.confirmationMessage)
        || ('Reset set "' + slug + '"? This clears the set conductor state file and any in-flight set session.');
      const ok = await H.showDangerConfirm({
        title: 'Reset set "' + slug + '"?',
        message,
        confirmLabel: 'Reset set',
        cancelLabel: 'Cancel'
      });
      if (!ok) return;
      await H.requestAction('set-autonomous-reset', [slug], repoPath, btn);
      break;
    }
    case 'set-prioritise': {
      const msg = (va.metadata && va.metadata.confirmationMessage)
        || ('Prioritise all inbox members of set "' + slug + '" in dependency order?');
      const ok = await H.showConfirm({
        title: 'Prioritise set "' + slug + '"?',
        message: msg,
        confirmLabel: 'Prioritise set',
        cancelLabel: 'Cancel'
      });
      if (!ok) return;
      await H.requestAction('set-prioritise', [slug], repoPath, btn);
      break;
    }
    case 'set-autonomous-stop':
    case 'set-autonomous-resume':
      await H.requestAction(va.action, [slug], repoPath, btn);
      break;
    default:
      await H.requestAction(va.action, [slug], repoPath, btn);
  }
}

export async function open(ctx) {
  await handleSetActionModule(ctx);
}



