    // ── Terminal panel ────────────────────────────────────────────────────────

    // Per-user prefs (localStorage)
    function getTerminalClickTarget() {
      return localStorage.getItem(lsKey('terminalClickTarget')) || 'dashboard';
    }
    function setTerminalClickTarget(val) {
      localStorage.setItem(lsKey('terminalClickTarget'), val);
    }
    function getTerminalFont() {
      return localStorage.getItem(lsKey('terminalFont')) || '"SF Mono","Cascadia Code",ui-monospace,monospace';
    }
    function setTerminalFont(val) {
      localStorage.setItem(lsKey('terminalFont'), val);
    }
    function getTerminalFontSize() {
      return parseInt(localStorage.getItem(lsKey('terminalFontSize')), 10) || 13;
    }
    function setTerminalFontSize(val) {
      localStorage.setItem(lsKey('terminalFontSize'), String(val));
    }

    // Build xterm.js theme from CSS custom properties
    function buildXtermTheme() {
      const s = getComputedStyle(document.documentElement);
      const v = (k) => s.getPropertyValue(k).trim();
      return {
        background:       v('--term-bg')            || '#0c0d10',
        foreground:       v('--term-fg')            || '#e8e9ec',
        cursor:           v('--term-cursor')        || '#4d9fff',
        cursorAccent:     v('--term-cursor-accent') || '#0c0d10',
        selectionBackground: v('--term-selection')  || 'rgba(77,159,255,.22)',
        black:            v('--term-black')         || '#1c1d21',
        red:              v('--term-red')           || '#e06c75',
        green:            v('--term-green')         || '#98c379',
        yellow:           v('--term-yellow')        || '#e5c07b',
        blue:             v('--term-blue')          || '#61afef',
        magenta:          v('--term-magenta')       || '#c678dd',
        cyan:             v('--term-cyan')          || '#56b6c2',
        white:            v('--term-white')         || '#abb2bf',
        brightBlack:      v('--term-bright-black')  || '#3e4452',
        brightRed:        v('--term-bright-red')    || '#e06c75',
        brightGreen:      v('--term-bright-green')  || '#98c379',
        brightYellow:     v('--term-bright-yellow') || '#e5c07b',
        brightBlue:       v('--term-bright-blue')   || '#61afef',
        brightMagenta:    v('--term-bright-magenta')|| '#c678dd',
        brightCyan:       v('--term-bright-cyan')   || '#56b6c2',
        brightWhite:      v('--term-bright-white')  || '#c8ccd4',
      };
    }

    const termState = {
      sessionName: null, startedAt: null,
      elapsedTimer: null,
      specPath: null, specTitle: null, specStage: null,
      specPoller: null, specContentHash: null,
      xterm: null, fitAddon: null, sseSource: null, ws: null,
    };

    function destroyXterm() {
      if (termState.sseSource) { try { termState.sseSource.close(); } catch (_) {} termState.sseSource = null; }
      if (termState.ws) { try { termState.ws.close(); } catch (_) {} termState.ws = null; }
      if (termState.xterm) { try { termState.xterm.dispose(); } catch (_) {} termState.xterm = null; }
      termState.fitAddon = null;
    }

    function createXtermInstance(container) {
      const hasXterm = typeof Terminal !== 'undefined';
      if (!hasXterm) return null;

      const term = new Terminal({
        cursorBlink: true,
        fontSize: getTerminalFontSize(),
        lineHeight: 1.4,
        fontFamily: getTerminalFont(),
        theme: buildXtermTheme(),
        allowProposedApi: true,
        scrollback: 5000,
        convertEol: true,
      });

      // FitAddon — resize terminal to container
      const fitAddon = typeof FitAddon !== 'undefined'
        ? new FitAddon.FitAddon()
        : null;
      if (fitAddon) term.loadAddon(fitAddon);

      // WebGL renderer — fallback to canvas silently
      if (typeof WebglAddon !== 'undefined') {
        try {
          const webgl = new WebglAddon.WebglAddon();
          webgl.onContextLoss(() => webgl.dispose());
          term.loadAddon(webgl);
        } catch (_) {}
      }

      // Unicode11 — proper wide-character support
      if (typeof Unicode11Addon !== 'undefined') {
        const u11 = new Unicode11Addon.Unicode11Addon();
        term.loadAddon(u11);
        term.unicode.activeVersion = '11';
      }

      // WebLinks — URL detection with hover underline
      if (typeof WebLinksAddon !== 'undefined') {
        term.loadAddon(new WebLinksAddon.WebLinksAddon());
      }

      // Image — sixel image rendering
      if (typeof ImageAddon !== 'undefined') {
        try { term.loadAddon(new ImageAddon.ImageAddon()); } catch (_) {}
      }

      term.open(container);
      if (fitAddon) fitAddon.fit();

      termState.xterm = term;
      termState.fitAddon = fitAddon;
      return { term, fitAddon };
    }

    async function connectPtyStream(sessionName) {
      let token;
      try {
        const r = await fetch('/api/pty-token');
        const d = await r.json();
        token = d.token;
      } catch (_) {
        connectSessionStream(sessionName);
        return;
      }
      const term = termState.xterm;
      if (!term) return;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${location.host}/api/session/pty/${encodeURIComponent(sessionName)}?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      termState.ws = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      };
      ws.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) {
          try { term.write(new Uint8Array(e.data)); } catch (_) {}
        }
      };
      ws.onclose = () => {
        termState.ws = null;
        if (termState.xterm) termState.xterm.writeln('\r\n\x1b[33m[Session ended]\x1b[0m');
        const dot = document.getElementById('panel-status-dot');
        if (dot) dot.className = 'panel-status-dot';
      };
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(new TextEncoder().encode(data));
        }
      });
      term.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        }
      });
    }

    function connectSessionStream(sessionName) {
      if (termState.sseSource) { try { termState.sseSource.close(); } catch (_) {} }
      const term = termState.xterm;
      if (!term) return;

      let prevOutput = null;
      const src = new EventSource('/api/session/stream?name=' + encodeURIComponent(sessionName));

      src.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (typeof data.output === 'string' && data.output !== prevOutput) {
            prevOutput = data.output;
            term.reset();
            term.write(data.output);
          }
        } catch (_) {}
      };

      src.addEventListener('end', () => {
        src.close();
        termState.sseSource = null;
        if (termState.xterm) {
          termState.xterm.writeln('\r\n\x1b[33m[Session ended]\x1b[0m');
        }
        const dot = document.getElementById('panel-status-dot');
        if (dot) dot.className = 'panel-status-dot';
      });

      src.onerror = () => {
        if (src.readyState === EventSource.CLOSED) {
          termState.sseSource = null;
        }
      };

      termState.sseSource = src;

      // Wire keyboard input → /api/session/terminal-input
      term.onKey(({ key }) => {
        if (!termState.sessionName) return;
        const isEnter = key === '\r';
        fetch('/api/session/terminal-input', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: termState.sessionName, text: isEnter ? '' : key, enter: isEnter }),
        }).catch(() => {});
      });
    }

    function openTerminalPanel(label, command, sessionName, staticContent, specContext) {
      const panelOverlay = document.getElementById('terminal-panel-overlay');
      const panel = document.getElementById('terminal-panel');
      const container = document.getElementById('terminal-container');

      document.getElementById('panel-title').textContent = label || 'Terminal';
      document.getElementById('panel-session-name').textContent = sessionName || '';
      const dot = document.getElementById('panel-status-dot');
      dot.className = 'panel-status-dot ' + (sessionName ? 'running' : '');

      clearInterval(termState.elapsedTimer);
      destroyXterm();

      termState.sessionName = sessionName || null;
      termState.startedAt = Date.now();
      termState.specPath = specContext ? specContext.path : null;
      termState.specTitle = specContext ? specContext.title : null;
      termState.specStage = specContext ? specContext.stage : null;
      container.innerHTML = '';

      const viewSpecBtn = document.getElementById('panel-view-spec');
      if (viewSpecBtn) viewSpecBtn.style.display = termState.specPath ? '' : 'none';
      const copyBtn = document.getElementById('panel-copy-session');
      if (copyBtn) copyBtn.style.display = sessionName ? '' : 'none';

      if (termState.specPoller) { clearInterval(termState.specPoller); termState.specPoller = null; }
      termState.specContentHash = null;

      // Show panel
      panelOverlay.style.display = '';
      panelOverlay.classList.add('open');
      panel.classList.add('open');
      document.body.style.overflow = 'hidden';

      if (document.getElementById('spec-drawer').classList.contains('open')) {
        document.body.classList.add('split-view');
      }

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
        const xtermResult = createXtermInstance(container);
        if (xtermResult) {
          xtermResult.term.writeln(staticContent);
        } else {
          const pre = document.createElement('pre');
          pre.style.cssText = 'color:var(--term-fg);padding:12px;font-family:var(--mono);font-size:12px;margin:0;overflow:auto;height:100%;background:var(--term-bg)';
          pre.textContent = staticContent;
          container.appendChild(pre);
        }
      } else if (sessionName && getTerminalClickTarget() === 'dashboard') {
        const xtermResult = createXtermInstance(container);
        if (xtermResult) {
          connectPtyStream(sessionName);
          // Resize observer keeps fit in sync
          const ro = new ResizeObserver(() => {
            try { if (termState.fitAddon) termState.fitAddon.fit(); } catch (_) {}
          });
          ro.observe(container);
        } else {
          container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-secondary);font-size:13px;font-family:var(--mono)">xterm.js not loaded — check your network connection</div>';
        }
      } else {
        // External terminal mode or no session
        container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-secondary);font-size:13px;font-family:var(--mono)">Session opened in your terminal</div>';
        dot.className = 'panel-status-dot';
      }

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
      if (!document.getElementById('spec-drawer').classList.contains('open')) {
        document.body.style.overflow = '';
      }
      if (termState.specPoller) { clearInterval(termState.specPoller); termState.specPoller = null; }
      clearInterval(termState.elapsedTimer);
      destroyXterm();
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

    function zoomTerminal(delta) {
      if (!termState.xterm) return;
      const next = Math.max(8, Math.min(24, (termState.xterm.options.fontSize || 13) + delta));
      termState.xterm.options.fontSize = next;
      setTerminalFontSize(next);
      try { if (termState.fitAddon) termState.fitAddon.fit(); } catch (_) {}
    }

    const _copyIcon = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="1.5" width="9" height="11" rx="1.5"/><path d="M5.5 4H3a1.5 1.5 0 00-1.5 1.5v9A1.5 1.5 0 003 16h7a1.5 1.5 0 001.5-1.5V13"/></svg>';

    async function copySessionName() {
      const name = termState.sessionName;
      if (!name) return;
      const btn = document.getElementById('panel-copy-session');
      try {
        await navigator.clipboard.writeText(name);
        btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2 8 6 12 14 4"/></svg>';
        btn.style.color = 'var(--success)';
        setTimeout(() => { btn.innerHTML = _copyIcon; btn.style.color = ''; }, 1500);
      } catch (_) {}
    }

    function toggleTerminalFullscreen() {
      const panel = document.getElementById('terminal-panel');
      panel.classList.toggle('fullscreen');
      const btn = document.getElementById('panel-fullscreen');
      if (btn) btn.textContent = panel.classList.contains('fullscreen') ? '⤡' : '⤢';
      // Re-fit xterm after fullscreen transition
      requestAnimationFrame(() => {
        try { if (termState.fitAddon) termState.fitAddon.fit(); } catch (_) {}
      });
    }

    document.getElementById('panel-close').onclick = () => { hideStopConfirm(); closeTerminalPanel(); };
    document.getElementById('panel-back').onclick = () => { hideStopConfirm(); closeDrawer(); closeTerminalPanel(); };
    document.getElementById('panel-stop').onclick = () => showStopConfirm();
    document.getElementById('panel-stop-cancel').onclick = () => hideStopConfirm();
    document.getElementById('panel-stop-kill').onclick = () => stopTerminalSession();
    document.getElementById('panel-zoom-out').onclick = () => zoomTerminal(-1);
    document.getElementById('panel-zoom-in').onclick = () => zoomTerminal(1);
    document.getElementById('panel-fullscreen').onclick = () => toggleTerminalFullscreen();
    document.getElementById('panel-copy-session').onclick = () => copySessionName();
    document.getElementById('panel-view-spec').onclick = () => {
      if (termState.specPath) {
        openDrawer(termState.specPath, termState.specTitle || 'Spec', termState.specStage || 'inbox');
      }
    };
    document.getElementById('terminal-panel-overlay').onclick = () => closeTerminalPanel();

    document.addEventListener('keydown', (e) => {
      const panel = document.getElementById('terminal-panel');
      if (!panel.classList.contains('open')) return;
      if (e.key === 'Escape') {
        if (document.body.classList.contains('split-view')) {
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

    /**
     * Research findings markdown viewer — replaces the old peek.js file mode (F355).
     * Opens the terminal drawer shell and renders `/api/spec` content as HTML.
     */
    async function openResearchFindingsPeek(findingsPath, title) {
      openTerminalPanel(title || 'Research findings', null, null, 'Loading…', null);
      const container = document.getElementById('terminal-container');
      try {
        const res = await fetch('/api/spec?path=' + encodeURIComponent(findingsPath), { cache: 'no-store' });
        const data = await res.json();
        destroyXterm();
        container.innerHTML = '';
        if (!res.ok || data.error) {
          const pre = document.createElement('pre');
          pre.style.cssText = 'color:var(--term-fg);padding:12px;font-family:var(--mono);font-size:12px;margin:0;overflow:auto;height:100%;background:var(--term-bg)';
          pre.textContent = 'No findings file found';
          container.appendChild(pre);
          return;
        }
        const content = data.content || '';
        if (typeof marked !== 'undefined') {
          const wrap = document.createElement('div');
          wrap.className = 'findings-markdown';
          wrap.style.cssText = 'padding:16px;overflow:auto;height:100%;background:var(--term-bg);color:var(--text-primary);font-size:13px;line-height:1.5';
          wrap.innerHTML = marked.parse(content);
          wrap.querySelectorAll('input[type="checkbox"]').forEach((cb) => { cb.disabled = true; });
          container.appendChild(wrap);
        } else {
          const pre = document.createElement('pre');
          pre.style.cssText = 'color:var(--term-fg);padding:12px;font-family:var(--mono);font-size:12px;margin:0;overflow:auto;height:100%;background:var(--term-bg)';
          pre.textContent = content;
          container.appendChild(pre);
        }
      } catch (_) {
        destroyXterm();
        container.innerHTML = '';
        const pre = document.createElement('pre');
        pre.style.cssText = 'color:var(--term-fg);padding:12px;font-family:var(--mono);font-size:12px;margin:0;overflow:auto;height:100%;background:var(--term-bg)';
        pre.textContent = 'No findings file found';
        container.appendChild(pre);
      }
    }

