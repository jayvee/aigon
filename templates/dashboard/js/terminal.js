    // ── Terminal panel ────────────────────────────────────────────────────────

    const termState = {
      sessionName: null, startedAt: null,
      elapsedTimer: null,
      specPath: null, specTitle: null, specStage: null,
      specPoller: null, specContentHash: null
    };

    function openTerminalPanel(label, command, sessionName, staticContent, specContext) {
      const panelOverlay = document.getElementById('terminal-panel-overlay');
      const panel = document.getElementById('terminal-panel');
      const container = document.getElementById('terminal-container');

      document.getElementById('panel-title').textContent = label || 'Terminal';
      document.getElementById('panel-session-name').textContent = sessionName || '';
      const dot = document.getElementById('panel-status-dot');
      dot.className = 'panel-status-dot ' + (sessionName ? 'running' : '');

      clearInterval(termState.elapsedTimer);

      termState.sessionName = sessionName || null;
      termState.startedAt = Date.now();
      termState.specPath = specContext ? specContext.path : null;
      termState.specTitle = specContext ? specContext.title : null;
      termState.specStage = specContext ? specContext.stage : null;
      container.innerHTML = '';

      // Show "View Spec" button only when launched with a spec context
      const viewSpecBtn = document.getElementById('panel-view-spec');
      if (viewSpecBtn) viewSpecBtn.style.display = termState.specPath ? '' : 'none';

      // Stop any previous spec poller
      if (termState.specPoller) { clearInterval(termState.specPoller); termState.specPoller = null; }
      termState.specContentHash = null;

      // Show panel
      panelOverlay.style.display = '';
      panelOverlay.classList.add('open');
      panel.classList.add('open');
      document.body.style.overflow = 'hidden';

      // Split-view: if spec drawer is already open alongside, position panels side by side
      if (document.getElementById('spec-drawer').classList.contains('open')) {
        document.body.classList.add('split-view');
      }

      // Start stale poller: detect when AI edits the spec so user knows to refresh
      if (termState.specPath) {
        termState.specPoller = setInterval(async () => {
          if (!document.getElementById('spec-drawer').classList.contains('open')) return;
          if (drawerState.path !== termState.specPath) return;
          try {
            const r = await fetch('/api/spec?path=' + encodeURIComponent(termState.specPath));
            const data = await r.json();
            if (data.error) return;
            const hash = data.content.length + '|' + data.content.slice(-200);
            if (termState.specContentHash === null) { termState.specContentHash = hash; return; }
            if (hash !== termState.specContentHash) {
              termState.specContentHash = hash;
              const refreshBtn = document.getElementById('drawer-refresh');
              if (refreshBtn && !refreshBtn.classList.contains('stale')) refreshBtn.classList.add('stale');
            }
          } catch (e) {}
        }, 3000);
      }

      if (staticContent) {
        // Show command output as preformatted text
        const pre = document.createElement('pre');
        pre.style.cssText = 'color:#ededef;padding:12px;font-family:var(--mono);font-size:12px;margin:0;overflow:auto;height:100%;background:#0a0a0b';
        pre.textContent = staticContent;
        container.appendChild(pre);
      } else {
        // Session opened in terminal app
        container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#888;font-size:13px;font-family:var(--mono)">Session opened in your terminal</div>';
        dot.className = 'panel-status-dot';
      }

      // Elapsed timer
      termState.elapsedTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - termState.startedAt) / 1000);
        const el = document.getElementById('panel-elapsed');
        if (el) el.textContent = elapsed < 60 ? elapsed + 's' : Math.floor(elapsed / 60) + 'm ' + (elapsed % 60) + 's';
      }, 1000);
    }

    function closeTerminalPanel() {
      const panelOverlay = document.getElementById('terminal-panel-overlay');
      const panel = document.getElementById('terminal-panel');
      panelOverlay.classList.remove('open');
      panel.classList.remove('open');
      document.body.classList.remove('split-view');
      hideStopConfirm();
      // Restore overflow only if spec drawer is also closed
      if (!document.getElementById('spec-drawer').classList.contains('open')) {
        document.body.style.overflow = '';
      }
      if (termState.specPoller) { clearInterval(termState.specPoller); termState.specPoller = null; }
      clearInterval(termState.elapsedTimer);
    }

    function showStopConfirm() {
      const sessionName = termState.sessionName;
      if (!sessionName) { closeTerminalPanel(); return; }
      const shortName = sessionName.length > 32 ? '…' + sessionName.slice(-29) : sessionName;
      document.getElementById('panel-kill-label').textContent = 'Kill ' + shortName + '?';
      document.getElementById('panel-actions-normal').style.display = 'none';
      document.getElementById('panel-actions-confirm').style.display = '';
    }
    function hideStopConfirm() {
      document.getElementById('panel-actions-normal').style.display = '';
      document.getElementById('panel-actions-confirm').style.display = 'none';
    }

    async function stopTerminalSession() {
      const sessionName = termState.sessionName;
      if (!sessionName) { closeTerminalPanel(); return; }
      hideStopConfirm();
      try {
        await fetch('/api/session/stop', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionName })
        });
        showToast('Session killed: ' + sessionName);
      } catch (e) {
        showToast('Stop failed: ' + e.message);
      }
      closeTerminalPanel();
    }

    function toggleTerminalFullscreen() {
      const panel = document.getElementById('terminal-panel');
      panel.classList.toggle('fullscreen');
      const btn = document.getElementById('panel-fullscreen');
      if (btn) btn.textContent = panel.classList.contains('fullscreen') ? '⤡' : '⤢';
    }

    document.getElementById('panel-close').onclick = () => { hideStopConfirm(); closeTerminalPanel(); };
    document.getElementById('panel-back').onclick = () => { hideStopConfirm(); closeDrawer(); closeTerminalPanel(); };
    document.getElementById('panel-stop').onclick = () => showStopConfirm();
    document.getElementById('panel-stop-cancel').onclick = () => hideStopConfirm();
    document.getElementById('panel-stop-kill').onclick = () => stopTerminalSession();
    document.getElementById('panel-fullscreen').onclick = () => toggleTerminalFullscreen();
    document.getElementById('panel-view-spec').onclick = () => {
      if (termState.specPath) {
        openDrawer(termState.specPath, termState.specTitle || 'Spec', termState.specStage || 'inbox');
      }
    };
    document.getElementById('terminal-panel-overlay').onclick = () => closeTerminalPanel();

    // Keyboard shortcut: Escape closes panels
    document.addEventListener('keydown', (e) => {
      const panel = document.getElementById('terminal-panel');
      if (!panel.classList.contains('open')) return;
      if (e.key === 'Escape') {
        if (document.body.classList.contains('split-view')) {
          // In split-view: ESC closes both panels at once → back to dashboard
          closeDrawer(); closeTerminalPanel();
        } else if (!document.getElementById('spec-drawer').classList.contains('open')) {
          closeTerminalPanel();
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'f') {
        e.preventDefault();
        toggleTerminalFullscreen();
      }
    }, true);

