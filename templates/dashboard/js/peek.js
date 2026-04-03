    // ── Peek panel — streaming tmux session output viewer ───────────────────

    const peekState = {
      mode: 'session',
      sessionName: null,
      findingsPath: null,
      offset: 0,
      poller: null,
      userScrolled: false,
    };

    // Strip ANSI escape sequences for clean display
    function stripAnsi(str) {
      return str.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')  // CSI sequences (including DEC private ?2026h)
                .replace(/\x1b\][^\x07]*\x07/g, '')       // OSC sequences
                .replace(/\x1b[()][A-Z0-9]/g, '')          // charset sequences
                .replace(/\x1b[\x20-\x2f]*[\x40-\x7e]/g, '') // other escapes
                .replace(/[\x00-\x08\x0b\x0e-\x1f\x7f]/g, ''); // control chars (keep \t \n \r)
    }

    function setPeekMode(mode) {
      const output = document.getElementById('peek-output');
      const inputForm = document.getElementById('peek-input-form');
      const statusDot = document.getElementById('peek-status-dot');
      peekState.mode = mode;
      if (mode === 'file') {
        output.style.whiteSpace = 'normal';
        output.style.wordBreak = 'normal';
        output.style.fontFamily = 'inherit';
        inputForm.style.display = 'none';
        statusDot.className = 'panel-status-dot';
      } else {
        output.style.whiteSpace = 'pre-wrap';
        output.style.wordBreak = 'break-all';
        output.style.fontFamily = 'var(--mono)';
        inputForm.style.display = 'flex';
      }
    }

    function setPeekOutputHtml(html) {
      const output = document.getElementById('peek-output');
      output.innerHTML = html;
      output.scrollTop = 0;
    }

    function showPeekPanel() {
      const overlay = document.getElementById('peek-panel-overlay');
      const panel = document.getElementById('peek-panel');
      overlay.style.display = '';
      overlay.classList.add('open');
      panel.classList.add('open');
      document.body.style.overflow = 'hidden';
    }

    function openPeekPanel(sessionName) {
      closePeekPanel(); // clean up any previous peek

      peekState.mode = 'session';
      peekState.sessionName = sessionName;
      peekState.findingsPath = null;
      peekState.offset = 0;
      peekState.userScrolled = false;

      setPeekMode('session');
      document.getElementById('peek-title').textContent = 'Peek — ' + sessionName;
      document.getElementById('peek-session-name').textContent = sessionName;
      document.getElementById('peek-bytes').textContent = '';
      document.getElementById('peek-output').textContent = '';
      document.getElementById('peek-input').value = '';

      showPeekPanel();

      // Track user scroll — pause auto-scroll when user scrolls up
      const output = document.getElementById('peek-output');
      output.onscroll = function() {
        const atBottom = output.scrollHeight - output.scrollTop - output.clientHeight < 40;
        peekState.userScrolled = !atBottom;
      };

      // Start polling
      pollPeek();
      peekState.poller = setInterval(pollPeek, 1500);
    }

    async function openResearchFindingsPeek(findingsPath, title) {
      closePeekPanel();

      peekState.sessionName = null;
      peekState.findingsPath = findingsPath;
      peekState.offset = 0;
      peekState.userScrolled = false;

      setPeekMode('file');
      document.getElementById('peek-title').textContent = 'Peek — ' + title;
      document.getElementById('peek-session-name').textContent = title;
      document.getElementById('peek-bytes').textContent = '';
      setPeekOutputHtml('<span style="color:var(--text-tertiary)">Loading…</span>');

      showPeekPanel();

      try {
        const res = await fetch('/api/spec?path=' + encodeURIComponent(findingsPath), { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok || data.error) {
          setPeekOutputHtml('<p>No findings file found</p>');
          return;
        }
        const content = data.content || '';
        if (typeof marked !== 'undefined') {
          setPeekOutputHtml(marked.parse(content));
          document.getElementById('peek-output').querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.disabled = true; });
        } else {
          document.getElementById('peek-output').textContent = content;
        }
      } catch (_) {
        setPeekOutputHtml('<p>No findings file found</p>');
      }
    }

    async function pollPeek() {
      if (peekState.mode !== 'session' || !peekState.sessionName) return;
      if (hasActivePeekSelection()) return;
      try {
        const url = '/api/session-peek?name=' + encodeURIComponent(peekState.sessionName) + '&since=' + peekState.offset;
        const res = await fetch(url, { cache: 'no-store' });
        const data = await res.json();

        if (!res.ok) {
          if (data.alive === false) {
            setPeekOutput(document.getElementById('peek-output').textContent + '\n[session ended]');
            stopPeekPoller();
            document.getElementById('peek-status-dot').className = 'panel-status-dot';
          }
          return;
        }

        if (data.output !== undefined) {
          // capture-pane returns full screen snapshot — replace, don't append
          setPeekOutput(stripAnsi(data.output));
        }
        if (data.offset !== undefined) {
          peekState.offset = data.offset;
        }
        document.getElementById('peek-bytes').textContent = formatBytes(peekState.offset);
      } catch (e) {
        // Network error — keep polling
      }
    }

    function setPeekOutput(text) {
      const output = document.getElementById('peek-output');
      output.textContent = text;

      // Auto-scroll to bottom unless user scrolled up
      if (!peekState.userScrolled) {
        output.scrollTop = output.scrollHeight;
      }
    }

    function hasActivePeekSelection() {
      const output = document.getElementById('peek-output');
      const selection = window.getSelection ? window.getSelection() : null;
      if (!output || !selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
      const range = selection.getRangeAt(0);
      const common = range.commonAncestorContainer;
      const node = common && common.nodeType === Node.TEXT_NODE ? common.parentNode : common;
      return !!(node && output.contains(node));
    }

    function formatBytes(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / 1048576).toFixed(1) + ' MB';
    }

    function stopPeekPoller() {
      if (peekState.poller) { clearInterval(peekState.poller); peekState.poller = null; }
    }

    function closePeekPanel() {
      stopPeekPoller();

      // No cleanup needed — capture-pane is stateless (no pipe-pane to stop)

      peekState.mode = 'session';
      peekState.sessionName = null;
      peekState.findingsPath = null;
      peekState.offset = 0;

      const overlay = document.getElementById('peek-panel-overlay');
      const panel = document.getElementById('peek-panel');
      overlay.classList.remove('open');
      panel.classList.remove('open');
      if (!document.getElementById('terminal-panel').classList.contains('open') &&
          !document.getElementById('spec-drawer').classList.contains('open')) {
        document.body.style.overflow = '';
      }
    }

    // Wire up peek panel controls
    document.getElementById('peek-close').onclick = closePeekPanel;
    document.getElementById('peek-panel-overlay').onclick = closePeekPanel;
    document.getElementById('peek-fullscreen').onclick = function() {
      var panel = document.getElementById('peek-panel');
      panel.classList.toggle('fullscreen');
      this.textContent = panel.classList.contains('fullscreen') ? '⤡' : '⤢';
    };

    // Send input to tmux session
    document.getElementById('peek-input-form').onsubmit = async function(e) {
      e.preventDefault();
      var input = document.getElementById('peek-input');
      var text = input.value;
      if (!text || peekState.mode !== 'session' || !peekState.sessionName) return;
      input.value = '';
      try {
        var resp = await fetch('/api/session-input', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: peekState.sessionName, text: text })
        });
        var result = await resp.json();
        console.log('[peek] send-input response:', result);
        if (!result.ok) showToast('Send failed: ' + (result.error || 'unknown'), null, null, {error: true});
      } catch (err) {
        showToast('Send failed: ' + err.message, null, null, {error: true});
      }
    };

    // ESC closes peek panel
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && document.getElementById('peek-panel').classList.contains('open')) {
        closePeekPanel();
      }
    }, true);
