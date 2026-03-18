    // ── Peek panel — streaming tmux session output viewer ───────────────────

    const peekState = {
      sessionName: null,
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

    function openPeekPanel(sessionName) {
      closePeekPanel(); // clean up any previous peek

      peekState.sessionName = sessionName;
      peekState.offset = 0;
      peekState.userScrolled = false;

      document.getElementById('peek-title').textContent = 'Peek — ' + sessionName;
      document.getElementById('peek-session-name').textContent = sessionName;
      document.getElementById('peek-bytes').textContent = '';
      document.getElementById('peek-output').textContent = '';
      document.getElementById('peek-input').value = '';

      const overlay = document.getElementById('peek-panel-overlay');
      const panel = document.getElementById('peek-panel');
      overlay.style.display = '';
      overlay.classList.add('open');
      panel.classList.add('open');
      document.body.style.overflow = 'hidden';

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

    async function pollPeek() {
      if (!peekState.sessionName) return;
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

      peekState.sessionName = null;
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
      if (!text || !peekState.sessionName) return;
      input.value = '';
      try {
        await fetch('/api/session-input', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: peekState.sessionName, text: text })
        });
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
