
import * as H from './shared.js';
/** F519 action module: pause */

export async function open(ctx) {
  await H.requestAction(ctx.va.action, [ctx.feature.id, ...(ctx.va.agentId ? [ctx.va.agentId] : [])], ctx.repoPath, ctx.btn);
}



