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
        state.data = next;
        render();
      } catch (e) {
        state.failures += 1;
        setHealth();
        showToast('Refresh failed: ' + e.message, null, null, {error:true});
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    async function requestAction(action, args, repoPath, btn) {
      const key = action + ':' + (args || []).join(':');
      if (state.pendingActions.has(key)) return;
      state.pendingActions.add(key);
      if (btn) { btn.disabled = true; btn.textContent = '...'; }
      try {
        const body = { action, args: args || [] };
        if (repoPath) body.repoPath = repoPath;
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
        const stderrError = payload.stderr && /fatal:|error:|❌|Error:/i.test(String(payload.stderr));
        if (stderrError) {
          showToast('Action may have failed — check Console', 'Console', () => { state.view = 'console'; localStorage.setItem(lsKey('view'), 'console'); render(); }, { error: true });
        } else {
          showToast('Done: ' + (payload.command || action));
        }
        await requestRefresh();
      } catch (e) {
        showToast('Action failed: ' + e.message, null, null, {error:true});
        if (btn) { btn.disabled = false; btn.textContent = btn._origText || action; }
      } finally {
        state.pendingActions.delete(key);
      }
    }

    async function requestFeatureOpen(featureId, agentId, repoPath, btn, pType, mode) {
      if (btn) { btn.disabled = true; btn.textContent = '...'; }
      try {
        const body = { featureId, agentId };
        if (repoPath) body.repoPath = repoPath;
        if (pType) body.pipelineType = pType;
        if (mode) body.mode = mode;
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
        if (btn) { btn.disabled = false; btn.textContent = btn._origText || 'Start'; }
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

