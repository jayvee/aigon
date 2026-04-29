    // ── API helpers ───────────────────────────────────────────────────────────

    async function requestAttach(repoPath, featureId, agentId, tmuxSession){
      try {
        const res = await fetch('/api/attach', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ repoPath, featureId, agentId, tmuxSession })
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || ('HTTP ' + res.status));
        showToast(payload.message || 'Session opened in terminal');
      } catch (e) {
        showToast('View failed: ' + e.message, null, null, {error:true});
      }
    }

    async function requestRefresh() {
      const btn = document.getElementById('refresh-btn');
      if (btn) btn.disabled = true;
      try {
        const res = await fetch('/api/refresh', { method: 'POST', cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const next = await res.json();
        state.failures = 0;
        state.data = applyForceProOverride(next);
        if (typeof window.__aigonSyncStatusFingerprint === 'function') {
          window.__aigonSyncStatusFingerprint();
        }
        render();
      } catch (e) {
        state.failures += 1;
        setHealth();
        showToast('Refresh failed: ' + e.message, null, null, {error:true});
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    async function fetchPrStatus(repoPath, featureId) {
      const repoToken = encodeURIComponent(String(repoPath || '').trim());
      const featureToken = encodeURIComponent(String(featureId || '').trim());
      if (!repoToken || !featureToken) {
        throw new Error('repoPath and featureId are required');
      }
      const res = await fetch('/api/repos/' + repoToken + '/features/' + featureToken + '/pr-status', {
        method: 'GET',
        cache: 'no-store'
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.error || ('HTTP ' + res.status));
      }
      return payload;
    }

    async function requestAction(action, args, repoPath, btn) {
      const key = action + ':' + (args || []).join(':');
      if (state.pendingActions.has(key)) return;
      state.pendingActions.add(key);
      const origText = btn ? btn.textContent : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="run-next-spinner"></span>' + escHtml(origText);
      }
      const label = (action || '').replace(/^(feature|research)-/, '');
      const processingToast = showToast('Processing ' + label + '…', null, null, { processing: true });

      // For feature-close / research-close: open the live-log panel before the
      // fetch so the user sees feedback within 200ms, before the HTTP response.
      const isClose = action === 'feature-close' || action === 'research-close';
      const actionId = isClose
        ? (action + '-' + ((args || [])[0] || '') + '-' + Date.now())
        : null;
      if (isClose && actionId && window.openCloseLogPanel) {
        const entityLabel = ((args || [])[0] || '');
        window.openCloseLogPanel(actionId, entityLabel);
      }

      try {
        const body = { action, args: args || [] };
        if (repoPath) body.repoPath = repoPath;
        if (actionId) body.actionId = actionId;
        let res;
        try {
          res = await fetch('/api/action', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
          });
        } catch (netErr) {
          throw new Error('Cannot reach dashboard server — is it still running? (' + netErr.message + ')');
        }
        let payload = {};
        const rawText = await res.text();
        try { payload = JSON.parse(rawText); } catch (_) { payload = { error: rawText }; }
        if (!res.ok) throw new Error(payload.error || ('HTTP ' + res.status + (rawText ? ': ' + rawText.slice(0, 120) : '')));
        const exitFailed = payload.exitCode !== undefined && payload.exitCode !== 0;
        const stderrStr = String(payload.stderr || '');
        const stderrError = !exitFailed && stderrStr && /^fatal:|❌/m.test(stderrStr) && !/failed to push some refs/i.test(stderrStr);
        if (exitFailed) {
          showToast('Action failed (exit ' + payload.exitCode + ') — check Logs', 'Logs', () => { state.view = 'logs'; localStorage.setItem(lsKey('view'), 'logs'); render(); }, { error: true });
          if (isClose && actionId && window.finalizeCloseLogPanel) {
            window.finalizeCloseLogPanel(actionId, { ok: false, error: payload.error || 'exit ' + payload.exitCode });
          }
        } else if (payload.agentWarning) {
          showToast('Warning: ' + payload.agentWarning, 'Logs', () => { state.view = 'logs'; localStorage.setItem(lsKey('view'), 'logs'); render(); }, { error: true });
          if (isClose && actionId && window.finalizeCloseLogPanel) {
            window.finalizeCloseLogPanel(actionId, { ok: true });
          }
        } else if (stderrError) {
          showToast('Done with warnings — check Logs', 'Logs', () => { state.view = 'logs'; localStorage.setItem(lsKey('view'), 'logs'); render(); });
          if (isClose && actionId && window.finalizeCloseLogPanel) {
            window.finalizeCloseLogPanel(actionId, { ok: true });
          }
        } else {
          if (action === 'feature-close') state.closeFailedFeatures.delete(String((args || [])[0]));
          showToast('Done: ' + (payload.command || action));
          if (isClose && actionId && window.finalizeCloseLogPanel) {
            window.finalizeCloseLogPanel(actionId, { ok: true });
          }
        }
        // feature 234: when the backend signals it is about to restart (lib/*.js
        // changes merged), show a transient "Reloading backend…" banner. The
        // existing poll loop will automatically reconnect when the new server
        // comes online and showServerRestartBanner() clears itself.
        if (payload && payload.serverRestarting) {
          showServerRestartBanner();
          return; // skip refresh — the server is about to die
        }
        await requestRefresh();
      } catch (e) {
        if (action === 'feature-close') {
          const featureId = (args || [])[0];
          let agentId = (args || [])[1];
          // Autonomous plan passes no agentId in args — infer from live feature data
          if (!agentId) {
            const fid = String(featureId);
            outer: for (const repo of (state.data && state.data.repos || [])) {
              for (const f of (repo.features || [])) {
                if (String(f.id) === fid && f.agents && f.agents.length > 0) {
                  agentId = f.agents[0].id;
                  break outer;
                }
              }
            }
          }
          if (!agentId) {
            agentId = window.__AIGON_DEFAULT_AGENT__ || 'cc';
          }
          state.closeFailedFeatures.set(String(featureId), { agentId, repoPath });
          if (actionId && window.finalizeCloseLogPanel) {
            window.finalizeCloseLogPanel(actionId, {
              ok: false, error: e.message,
              _featureId: featureId, _agentId: agentId, _repoPath: repoPath
            });
          }
          showToast(
            'Close failed — use "Close with agent" on the card',
            null, null,
            { error: true, persistent: true }
          );
          render();
        } else {
          showToast('Action failed: ' + e.message, null, null, {error:true});
          if (isClose && actionId && window.finalizeCloseLogPanel) {
            window.finalizeCloseLogPanel(actionId, { ok: false, error: e.message });
          }
        }
        if (btn) { btn.disabled = false; btn.textContent = origText || btn._origText || action; }
      } finally {
        if (processingToast) processingToast.remove();
        state.pendingActions.delete(key);
      }
    }

    async function requestFeatureNudge(featureId, payload, repoPath, btn) {
      const pendingKey = 'feature-nudge:' + String(featureId || '');
      if (state.pendingActions.has(pendingKey)) return null;
      state.pendingActions.add(pendingKey);
      const origText = btn ? btn.textContent : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="run-next-spinner"></span>' + escHtml(origText || 'Send nudge');
      }
      const processingToast = showToast('Sending nudge…', null, null, { processing: true });
      try {
        const res = await fetch('/api/feature/' + encodeURIComponent(String(featureId || '')) + '/nudge', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            repoPath,
            agentId: payload && payload.agentId ? payload.agentId : '',
            role: payload && payload.role ? payload.role : 'do',
            message: payload && payload.message ? payload.message : '',
          })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          const err = new Error(body.error || ('HTTP ' + res.status));
          err.paneTail = body.paneTail || '';
          throw err;
        }
        showToast(body.message || 'Nudge delivered');
        await requestRefresh();
        return body;
      } catch (e) {
        showToast('Nudge failed: ' + e.message, null, null, { error: true });
        if (e.paneTail) openTerminalPanel('Nudge delivery check', 'tmux capture-pane', null, e.paneTail);
        return null;
      } finally {
        if (processingToast) processingToast.remove();
        state.pendingActions.delete(pendingKey);
        if (btn) {
          btn.disabled = false;
          btn.textContent = origText || 'Send nudge';
        }
      }
    }

    async function requestFeatureAutonomousRun(featureId, options, repoPath, btn) {
      const opts = options || {};
      const agents = Array.isArray(opts.agents) ? opts.agents : [];
      const stopAfter = opts.stopAfter || 'close';
      const evalAgent = opts.evalAgent || '';
      const reviewAgent = opts.reviewAgent || '';
      const models = typeof opts.models === 'string' ? opts.models.trim() : '';
      const efforts = typeof opts.efforts === 'string' ? opts.efforts.trim() : '';
      const reviewModel = typeof opts.reviewModel === 'string' ? opts.reviewModel.trim() : '';
      const reviewEffort = typeof opts.reviewEffort === 'string' ? opts.reviewEffort.trim() : '';
      const workflow = typeof opts.workflow === 'string' ? opts.workflow.trim() : '';
      if (!featureId || agents.length === 0) {
        showToast('Start autonomously failed: missing feature or agents', null, null, { error: true });
        return;
      }
      const origText = btn ? btn.textContent : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="run-next-spinner"></span>' + escHtml(origText);
      }
      const processingToast = showToast('Starting autonomous run…', null, null, { processing: true });
      try {
        const body = { agents, stopAfter };
        if (repoPath) body.repoPath = repoPath;
        if (evalAgent) body.evalAgent = evalAgent;
        if (reviewAgent) body.reviewAgent = reviewAgent;
        if (models) body.models = models;
        if (efforts) body.efforts = efforts;
        if (reviewModel) body.reviewModel = reviewModel;
        if (reviewEffort) body.reviewEffort = reviewEffort;
        if (workflow) body.workflow = workflow;
        const res = await fetch('/api/features/' + encodeURIComponent(String(featureId)) + '/run', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || ('HTTP ' + res.status));
        showToast('Autonomous run started');
        await requestRefresh();
      } catch (e) {
        showToast('Start autonomously failed: ' + e.message, null, null, { error: true });
      } finally {
        if (processingToast) processingToast.remove();
        if (btn) {
          btn.disabled = false;
          btn.textContent = origText || 'Start autonomously';
        }
      }
    }

    async function requestFeatureOpen(featureId, agentId, repoPath, btn, pType, mode, launchOptions) {
      const origOpen = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.innerHTML = '<span class="run-next-spinner"></span>' + escHtml(origOpen); }
      try {
        const body = { featureId, agentId };
        if (repoPath) body.repoPath = repoPath;
        if (pType) body.pipelineType = pType;
        if (mode) body.mode = mode;
        const lo = launchOptions || {};
        if (lo.model) body.model = lo.model;
        if (lo.effort) body.effort = lo.effort;
        const res = await fetch('/api/feature-open', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || ('HTTP ' + res.status));
        showToast(payload.message || 'Agent started');
      } catch (e) {
        showToast('Start agent failed: ' + e.message, null, null, {error:true});
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = origOpen || btn._origText || 'Start'; }
      }
    }

    async function requestSpecReviewLaunch(endpoint, entityId, agentId, repoPath, btn, launchOptions) {
      const origText = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.innerHTML = '<span class="run-next-spinner"></span>' + escHtml(origText); }
      try {
        const body = { entityId, agentId };
        if (repoPath) body.repoPath = repoPath;
        const lo = launchOptions || {};
        if (lo.model) body.model = lo.model;
        if (lo.effort) body.effort = lo.effort;
        const res = await fetch('/api/' + endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || ('HTTP ' + res.status));
        showToast(payload.message || 'Agent started');
      } catch (e) {
        showToast('Start agent failed: ' + e.message, null, null, {error:true});
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = origText || btn._origText || 'Start'; }
      }
    }

    async function requestAgentFlagAction(action, payload, btn) {
      const origFlag = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.innerHTML = '<span class="run-next-spinner"></span>' + escHtml(origFlag); }
      try {
        const res = await fetch('/api/agent-flag-action', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(Object.assign({ action }, payload || {}))
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
        showToast(body.message || 'Done');
        await requestRefresh();
      } catch (e) {
        showToast('Action failed: ' + e.message, null, null, { error: true });
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = origFlag || btn._origText || 'Run'; }
      }
    }

    async function requestRepoMainDevServerStart(repoPath, btn) {
      const token = encodeURIComponent(String(repoPath || '').trim());
      if (!token) return;
      const origText = btn ? btn.textContent : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="run-next-spinner"></span>';
      }
      const processingToast = showToast('Starting dev server…', null, null, { processing: true });
      try {
        const res = await fetch('/api/repos/' + token + '/dev-server/start', {
          method: 'POST',
          headers: { 'content-type': 'application/json' }
        });
        const payload = await res.json().catch(() => ({}));
        if (processingToast) processingToast.remove();
        if (!res.ok) throw new Error(payload.error || ('HTTP ' + res.status));
        if (payload.url) {
          window.open(payload.url, '_blank', 'noopener,noreferrer');
        }
        showToast(payload.message || 'Main dev server ready');
        await requestRefresh();
      } catch (e) {
        if (processingToast) processingToast.remove();
        showToast('Dev server failed: ' + e.message, null, null, { error: true });
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = origText || '';
        }
      }
    }

    async function requestAgentDevServerPoke(repoPath, featureId, agentId, btn) {
      const repoToken = encodeURIComponent(String(repoPath || '').trim());
      const featureToken = encodeURIComponent(String(featureId || '').trim());
      const agentToken = encodeURIComponent(String(agentId || '').trim());
      if (!repoToken || !featureToken || !agentToken) return;

      const pendingKey = `dev-poke:${repoPath}:${featureId}:${agentId}`;
      if (state.pendingActions.has(pendingKey)) return;
      state.pendingActions.add(pendingKey);
      const uiKey = `${repoPath}:${featureId}:${agentId}`;
      state.pendingDevServerPokes.add(uiKey);
      render();

      const origText = btn ? btn.textContent : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="run-next-spinner"></span>Starting preview…';
      }
      const processingToast = showToast('Starting preview…', null, null, { processing: true });

      try {
        const res = await fetch('/api/repos/' + repoToken + '/features/' + featureToken + '/agents/' + agentToken + '/dev-server/poke', {
          method: 'POST',
          headers: { 'content-type': 'application/json' }
        });
        const payload = await res.json().catch(() => ({}));
        if (processingToast) processingToast.remove();
        if (!res.ok) throw new Error(payload.error || ('HTTP ' + res.status));
        showToast(payload.message || 'Preview start requested');
        await requestRefresh();
      } catch (e) {
        if (processingToast) processingToast.remove();
        showToast('Preview start failed: ' + e.message, null, null, { error: true });
      } finally {
        state.pendingActions.delete(pendingKey);
        state.pendingDevServerPokes.delete(uiKey);
        render();
        if (btn) {
          btn.disabled = false;
          btn.textContent = origText || 'Start preview';
        }
      }
    }

    function formatSpecReconcileSkipReason(reason) {
      if (reason === 'destination-exists') return 'destination already exists';
      if (reason === 'expected-path-outside-docs') return 'expected path is outside docs/specs';
      if (reason === 'rename-failed') return 'rename failed';
      if (reason === 'missing-visible-spec') return 'visible spec was not found';
      if (reason === 'missing-workflow-state') return 'workflow state is missing';
      return reason || 'reconcile skipped';
    }

    async function requestSpecReconcile(repoPath, entityType, entityId, btn) {
      const pendingKey = `spec-reconcile:${repoPath || ''}:${entityType || ''}:${entityId || ''}`;
      if (state.pendingActions.has(pendingKey)) return;
      state.pendingActions.add(pendingKey);

      const origText = btn ? btn.textContent : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="run-next-spinner"></span>Reconcile';
      }
      const processingToast = showToast('Reconciling spec drift…', null, null, { processing: true });

      try {
        const res = await fetch('/api/spec-reconcile', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ repoPath, entityType, entityId })
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || ('HTTP ' + res.status));

        if (payload.moved) {
          showToast('Reconciled spec drift');
        } else if (payload.skipped) {
          showToast('Reconcile skipped: ' + formatSpecReconcileSkipReason(payload.skipped), null, null, { error: true });
        } else {
          showToast(payload.driftDetected === false ? 'Spec already reconciled' : 'Reconcile finished');
        }
        await requestRefresh();
      } catch (e) {
        showToast('Reconcile failed: ' + e.message, null, null, { error: true });
      } finally {
        if (processingToast) processingToast.remove();
        state.pendingActions.delete(pendingKey);
        if (btn) {
          btn.disabled = false;
          btn.textContent = origText || 'Reconcile';
        }
      }
    }

    // ── Session execution ─────────────────────────────────────────────────────

    async function executeNextAction(command, mode, repoPath, btn) {
      if (!command) return;
      const origText = btn ? btn.textContent : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="run-next-spinner"></span>' + escHtml(origText);
      }
      try {
        if (mode === 'fire-and-forget') {
          const res = await fetch('/api/session/run', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ command, cwd: repoPath || '' })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data.exitCode !== 0) {
            showToast('Failed: ' + command.split(' ').slice(0, 3).join(' '));
            if (data.stdout || data.stderr) {
              openTerminalPanel(command.split(' ').slice(0, 3).join(' '), command, null, (data.stdout || '') + (data.stderr ? '\r\n\x1b[31m' + data.stderr + '\x1b[0m' : ''));
            }
          } else {
            showToast('Done: ' + command.split(' ').slice(0, 3).join(' '));
            await requestRefresh();
          }
        } else if (mode === 'terminal') {
          // terminal mode — open a native terminal window via server-side openTerminalAppWithCommand
          const res = await fetch('/api/open-terminal', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ command, cwd: repoPath || '' })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            showToast('Failed to open terminal: ' + (data.error || 'Unknown error'));
          } else {
            openTerminalPanel(command.split(' ').slice(0, 4).join(' '), command, null, null);
          }
        } else {
          // agent mode — run synchronously and show output in panel
          const res = await fetch('/api/session/run', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ command, cwd: repoPath || '' })
          });
          const data = await res.json().catch(() => ({}));
          const output = (data.stdout || '') + (data.stderr ? '\n' + data.stderr : '');
          openTerminalPanel(command.split(' ').slice(0, 4).join(' '), command, null, output || 'Done.');
          if (res.ok) await requestRefresh();
        }
      } catch (e) {
        showToast('Error: ' + e.message);
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = origText; }
      }
    }

    async function postMarkComplete(entityId, entityType, signal, agentId, repoPath) {
      const entityPath = entityType === 'research' ? 'research' : 'features';
      const url = '/api/' + entityPath + '/' + encodeURIComponent(String(entityId || '')) + '/mark-complete';
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ signal, agentId, repoPath }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || ('HTTP ' + res.status));
        await requestRefresh();
      } catch (e) {
        showToast('Mark complete failed: ' + e.message, null, null, { error: true });
      }
    }
