    // ── Spec drawer ──────────────────────────────────────────────────────────

    const drawerState = {
      path: null, content: '',
      title: '', stage: '', type: 'feature', repoPath: null, entityId: null,
      fontSize: Number(localStorage.getItem(lsKey('drawerFontSize')) || '13')
    };
    const drawerOverlay = document.getElementById('drawer-overlay');
    const drawerEl = document.getElementById('spec-drawer');
    const drawerTitle = document.getElementById('drawer-title');
    const drawerId = document.getElementById('drawer-id');
    const drawerStage = document.getElementById('drawer-stage');
    const drawerTabs = document.getElementById('drawer-tabs');
    const drawerPreview = document.getElementById('drawer-preview');
    const drawerDetailContent = document.getElementById('drawer-detail-content');
    const drawerSaveStatus = document.getElementById('drawer-save-status');
    const drawerFontSizeLabel = document.getElementById('drawer-font-size');

    const drawerDetailTabs = (typeof createDrawerDetailTabs === 'function')
      ? createDrawerDetailTabs({
        drawerEl,
        tabsEl: drawerTabs,
        detailEl: drawerDetailContent,
        getDrawerState: () => drawerState,
        onToggleSpecView: (showSpec) => {
          if (showSpec) {
            drawerDetailContent.style.display = 'none';
            drawerPreview.style.display = '';
          } else {
            drawerPreview.style.display = 'none';
            drawerDetailContent.style.display = '';
          }
        }
      })
      : null;

    function isSpecTabActive() {
      return !drawerDetailTabs || drawerDetailTabs.getActiveTab() === 'spec';
    }

    function applyDrawerFontSize() {
      const sz = drawerState.fontSize + 'px';
      drawerPreview.style.fontSize = sz;
      drawerFontSizeLabel.textContent = drawerState.fontSize;
      localStorage.setItem(lsKey('drawerFontSize'), String(drawerState.fontSize));
    }

    function parseFrontMatter(md) {
      const m = md.match(/^---\n([\s\S]*?)\n---\n?/);
      if (!m) return { fm: null, body: md };
      return { fm: m[1].trim(), body: md.slice(m[0].length) };
    }

    /**
     * frontmatter: escaped pre, no two-column table (naive `key:` split is unsafe).
     * Strips full-line # comments for display only — they are long and misaligned
     * in the feature template; full file remains on disk / Open in editor.
     * Inline value#tail comments are kept.
     */
    function displayFrontMatterStripped(fmText) {
      if (!fmText) return '';
      return fmText
        .split('\n')
        .filter((line) => {
          const t = line.trimStart();
          return !(t.length > 0 && t.charCodeAt(0) === 35); // starts with # after leading ws
        })
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    function renderFrontMatterBlock(fmText) {
      if (!fmText) return '';
      const stripped = displayFrontMatterStripped(fmText);
      const body = (stripped && stripped.length) ? stripped : fmText;
      const pre = escHtml(body);
      return (
        '<details class="fm-details">'
        + '<summary class="fm-summary">Metadata</summary>'
        + '<pre class="fm-yaml" aria-label="Spec front matter (YAML)">'
        + pre
        + '</pre></details>'
      );
    }

    function renderMarkdownPreview(md) {
      const { fm, body } = parseFrontMatter(md);
      const fmHtml = renderFrontMatterBlock(fm);
      if (typeof marked !== 'undefined') {
        drawerPreview.innerHTML = fmHtml + marked.parse(body);
        drawerPreview.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.disabled = true; });
      } else {
        drawerPreview.textContent = body;
      }
    }

    function specTypeFromPath(specPath) {
      if (!specPath) return 'feature';
      if (specPath.includes('/research/')) return 'research';
      if (specPath.includes('/feedback/')) return 'feedback';
      return 'feature';
    }

    function specIdFromPath(specPath) {
      const file = String(specPath || '').split('/').pop() || '';
      const match = file.match(/^(?:feature|research|feedback)-(\d+)-/);
      return match ? match[1] : null;
    }

    function openDrawer(specPath, title, stage, repoPath, options) {
      if (!specPath) return;
      const opts = options || {};
      drawerState.path = specPath;
      drawerState.title = title;
      drawerState.stage = stage;
      drawerState.type = specTypeFromPath(specPath);
      drawerState.repoPath = repoPath || null;
      drawerState.entityId = opts.entityId || specIdFromPath(specPath);
      drawerState._initialTab = opts.initialTab || null;
      drawerTitle.textContent = title;
      if (drawerId) {
        drawerId.textContent = drawerState.entityId ? `#${drawerState.entityId}` : '';
        drawerId.style.display = drawerState.entityId ? '' : 'none';
      }
      drawerStage.textContent = stage;
      drawerPreview.innerHTML = '<span style="color:var(--text-tertiary)">Loading…</span>';
      drawerDetailContent.innerHTML = '';
      drawerDetailContent.style.display = 'none';
      drawerPreview.style.display = '';
      drawerSaveStatus.textContent = '';
      if (drawerDetailTabs) drawerDetailTabs.reset();
      applyDrawerFontSize();
      drawerOverlay.classList.add('open');
      drawerEl.classList.add('open');
      document.body.style.overflow = 'hidden';
      // If terminal panel is also open, enter split-view so both headers are accessible
      if (document.getElementById('terminal-panel').classList.contains('open')) {
        document.body.classList.add('split-view');
      }

      fetch('/api/spec?path=' + encodeURIComponent(specPath))
        .then(r => r.json())
        .then(data => {
          if (data.error) { drawerPreview.textContent = 'Error: ' + data.error; return; }
          drawerState.content = data.content;
          renderMarkdownPreview(data.content);
        })
        .catch(e => { drawerPreview.textContent = 'Failed to load: ' + e.message; });
    }

    function closeDrawer() {
      drawerOverlay.classList.remove('open');
      drawerEl.classList.remove('open');
      document.body.classList.remove('split-view');
      document.body.classList.remove('drawer-wide');
      if (!document.getElementById('terminal-panel').classList.contains('open')) {
        document.body.style.overflow = '';
      }
      drawerState.path = null;
      drawerState.entityId = null;
      if (drawerId) {
        drawerId.textContent = '';
        drawerId.style.display = 'none';
      }
      if (drawerDetailTabs) drawerDetailTabs.reset();
      // Refit terminal after spec drawer closes (terminal panel goes back to right side)
      setTimeout(() => { if (termState.fitAddon) try { termState.fitAddon.fit(); } catch (e) {} }, 300);
    }

    document.getElementById('drawer-copy-name').onclick = () => {
      if (!drawerState.path) return;
      const basename = drawerState.path.split('/').pop().replace(/\.md$/, '');
      copyText(basename).then(() => showToast('Copied: ' + basename));
    };

    async function launchAiSession() {
      if (!drawerState.path) { showToast('No spec loaded'); return; }
      if (!drawerState.repoPath) { showToast('Repo path unknown — open spec from a kanban card', null, null, { error: true }); return; }
      const agentId = getAskAgent();
      const specPrompts = {
        feature: `Read the feature spec at ${drawerState.path} and let's discuss and refine it together. Help me improve the summary, acceptance criteria, and technical approach. Don't implement anything.`,
        research: `Read the research topic at ${drawerState.path} and let's discuss and refine it together. Help me sharpen the research questions and scope. Don't write any code.`,
        feedback: `Read the feedback item at ${drawerState.path} and let's discuss it together. Help me clarify the problem, assess severity, and decide on next steps.`,
      };
      const prompt = specPrompts[drawerState.type] || specPrompts.feature;
      const res = await fetch('/api/session/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repoPath: drawerState.repoPath, agentId, prompt })
      }).catch(() => null);
      if (!res || !res.ok) {
        const data = res ? await res.json().catch(() => ({})) : {};
        showToast('Failed to open terminal: ' + (data.error || 'Unknown'), null, null, { error: true });
        return;
      }
      openTerminalPanel('Use AI · ' + agentId, null, null, null, { path: drawerState.path, title: drawerState.title, stage: drawerState.stage });
    }

    // Event listeners
    drawerOverlay.onclick = closeDrawer;
    document.getElementById('drawer-close').onclick = closeDrawer;
    document.getElementById('drawer-use-ai').onclick = launchAiSession;

    // Font size controls
    document.getElementById('drawer-font-down').onclick = () => {
      drawerState.fontSize = Math.max(10, drawerState.fontSize - 1);
      applyDrawerFontSize();
    };
    document.getElementById('drawer-font-up').onclick = () => {
      drawerState.fontSize = Math.min(24, drawerState.fontSize + 1);
      applyDrawerFontSize();
    };

    document.getElementById('drawer-refresh').onclick = async () => {
      if (!drawerState.path) return;
      const btn = document.getElementById('drawer-refresh');
      btn.classList.remove('stale');
      termState.specContentHash = null; // reset so next poll re-baselines
      btn.textContent = '↺…';
      btn.disabled = true;
      const scrollTop = document.getElementById('drawer-body').scrollTop;
      try {
        const res = await fetch('/api/spec?path=' + encodeURIComponent(drawerState.path));
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        drawerState.content = data.content;
        renderMarkdownPreview(data.content);
        if (drawerDetailTabs) drawerDetailTabs.onDrawerRefresh();
        drawerSaveStatus.textContent = 'Refreshed';
        setTimeout(() => { if (drawerSaveStatus.textContent === 'Refreshed') drawerSaveStatus.textContent = ''; }, 2000);
        requestAnimationFrame(() => { document.getElementById('drawer-body').scrollTop = scrollTop; });
      } catch (e) {
        showToast('Refresh failed: ' + e.message);
      } finally {
        btn.textContent = '↺ Refresh';
        btn.disabled = false;
      }
    };

    document.getElementById('drawer-open-editor').onclick = async () => {
      try {
        await fetch('/api/open-in-editor', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: drawerState.path })
        });
      } catch (e) {
        showToast('Could not open editor: ' + e.message, null, null, {error:true});
      }
    };

    // Fullscreen toggle
    function toggleDrawerFullscreen() {
      drawerEl.classList.toggle('fullscreen');
      const btn = document.getElementById('drawer-fullscreen');
      btn.textContent = drawerEl.classList.contains('fullscreen') ? '⤡' : '⤢';
    }
    document.getElementById('drawer-fullscreen').onclick = toggleDrawerFullscreen;

    // Keyboard shortcuts for drawer
    document.addEventListener('keydown', (e) => {
      if (!drawerEl.classList.contains('open')) return;
      if (e.key === 'Escape') { closeDrawer(); return; }
      // Cmd+Shift+F to toggle fullscreen
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'f') {
        e.preventDefault();
        toggleDrawerFullscreen();
      }
    });

