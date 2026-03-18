    // ── Settings view ──────────────────────────────────────────────────────────

    function renderSettings() {
      document.getElementById('monitor-summary').style.display = 'none';
      document.getElementById('repo-header').style.display = 'none';
      document.getElementById('repo-sidebar').style.display = 'none';
      document.getElementById('repo-select-mobile').style.display = 'none';
      setHealth();
      const data = state.data || {};
      document.getElementById('updated-text').textContent = 'Updated ' + relTime(data.generatedAt || new Date().toISOString());

      const reposRoot = document.getElementById('repos');
      const empty = document.getElementById('empty');
      reposRoot.className = '';
      reposRoot.innerHTML = '';
      empty.style.display = 'none';

      const area = document.createElement('div');
      area.className = 'settings-area';

      // Repos section
      const section = document.createElement('div');
      section.className = 'settings-section';
      section.innerHTML = '<h3>Registered Repositories</h3><p>Repos monitored by the Aigon dashboard. Toggle visibility to focus on specific repos.</p>';

      const repos = readConductorReposFromGlobalConfig_client();
      const list = document.createElement('div');
      list.className = 'repo-list';

      if (repos.length === 0) {
        list.innerHTML = '<div class="settings-empty">No repos registered.</div>';
      } else {
        repos.forEach(repoPath => {
          const hidden = isRepoHidden(repoPath);
          const item = document.createElement('div');
          item.className = 'repo-list-item' + (hidden ? ' repo-hidden' : '');
          const displayPath = repoPath.replace(/^\/Users\/[^/]+\//, '~/');

          // Visibility toggle
          const visBtn = document.createElement('button');
          visBtn.className = 'repo-list-vis' + (hidden ? ' hidden-state' : '');
          visBtn.title = hidden ? 'Show in dashboard' : 'Hide from dashboard';
          visBtn.textContent = hidden ? '\u{1F441}\u{FE0F}\u200D\u{1F5E8}\u{FE0F}' : '\u{1F441}\u{FE0F}';
          visBtn.textContent = hidden ? '○' : '●';
          visBtn.onclick = () => {
            toggleRepoVisibility(repoPath);
            renderSettings();
            render();
          };

          item.innerHTML = '<span class="repo-list-path" title="' + escHtml(repoPath) + '">' + escHtml(displayPath) + '</span>';
          const removeBtn = document.createElement('button');
          removeBtn.className = 'repo-list-remove';
          removeBtn.title = 'Remove repo';
          removeBtn.textContent = '\u00d7';
          removeBtn.onclick = async () => {
            if (!confirm('Remove ' + displayPath + ' from the dashboard?')) return;
            removeBtn.disabled = true;
            try {
              const res = await fetch('/api/repos/remove', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ path: repoPath })
              });
              const payload = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(payload.error || 'Failed');
              showToast('Removed: ' + displayPath);
              await requestRefresh();
            } catch (e) {
              showToast('Remove failed: ' + e.message, null, null, {error:true});
              removeBtn.disabled = false;
            }
          };
          item.insertBefore(visBtn, item.firstChild);
          item.appendChild(removeBtn);
          list.appendChild(item);
        });
      }
      section.appendChild(list);

      // Add repo form
      const form = document.createElement('div');
      form.className = 'add-repo-form';
      const input = document.createElement('input');
      input.className = 'add-repo-input';
      input.type = 'text';
      input.placeholder = '/path/to/repo or ~/src/my-project';
      const addBtn = document.createElement('button');
      addBtn.className = 'btn btn-primary';
      addBtn.textContent = 'Add';
      addBtn.style.padding = '7px 16px';

      async function addRepo() {
        const val = input.value.trim();
        if (!val) return;
        addBtn.disabled = true;
        input.disabled = true;
        try {
          const res = await fetch('/api/repos/add', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: val })
          });
          const payload = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(payload.error || 'Failed');
          input.value = '';
          showToast('Added: ' + val);
          await requestRefresh();
        } catch (e) {
          showToast('Add failed: ' + e.message, null, null, {error:true});
        } finally {
          addBtn.disabled = false;
          input.disabled = false;
          input.focus();
        }
      }

      addBtn.onclick = addRepo;
      input.onkeydown = (e) => { if (e.key === 'Enter') addRepo(); };
      form.appendChild(input);
      form.appendChild(addBtn);
      section.appendChild(form);

      area.appendChild(section);

      // ── Notifications section ─────────────────────────────────────────────
      const NOTIF_TYPE_LABELS = {
        'agent-waiting': 'Agent waiting',
        'agent-submitted': 'Agent submitted',
        'all-submitted': 'All agents submitted (features)',
        'all-research-submitted': 'All agents submitted (research)',
        'error': 'Errors'
      };
      const notifSection = document.createElement('div');
      notifSection.className = 'settings-section';
      notifSection.innerHTML = '<h3>Notifications</h3><p>macOS notifications are delivered only while the dashboard is running.</p>';

      async function loadAndRenderNotifToggles() {
        let cfg = { enabled: true, types: {} };
        try {
          const r = await fetch('/api/settings/notifications');
          cfg = await r.json();
        } catch (_) {}

        notifSection.querySelectorAll('.toggle-row').forEach(r => r.remove());

        function makeToggleRow(label, checked, disabled, onChange) {
          const row = document.createElement('div');
          row.className = 'toggle-row';
          const labelDiv = document.createElement('div');
          labelDiv.className = 'toggle-row-label';
          labelDiv.textContent = label;
          const sw = document.createElement('label');
          sw.className = 'toggle-switch';
          const inp = document.createElement('input');
          inp.type = 'checkbox';
          inp.checked = checked;
          if (disabled) inp.disabled = true;
          inp.onchange = () => onChange(inp.checked);
          const track = document.createElement('span');
          track.className = 'toggle-track';
          sw.appendChild(inp);
          sw.appendChild(track);
          row.appendChild(labelDiv);
          row.appendChild(sw);
          return { row, inp };
        }

        // Master toggle
        const { row: masterRow, inp: masterInp } = makeToggleRow('Enable macOS notifications', cfg.enabled, false, async (val) => {
          try {
            await fetch('/api/settings/notifications', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: val }) });
          } catch (_) {}
          loadAndRenderNotifToggles();
        });
        notifSection.appendChild(masterRow);

        // Per-type toggles
        Object.entries(NOTIF_TYPE_LABELS).forEach(([type, label]) => {
          const { row, inp } = makeToggleRow(label, cfg.types[type] !== false, !cfg.enabled, async (val) => {
            try {
              await fetch('/api/settings/notifications', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ types: { [type]: val } }) });
            } catch (_) {}
          });
          row.style.paddingLeft = '24px';
          notifSection.appendChild(row);
        });
      }

      loadAndRenderNotifToggles();
      area.appendChild(notifSection);

      reposRoot.appendChild(area);
    }

    function readConductorReposFromGlobalConfig_client() {
      return (state.data && state.data.repos) ? state.data.repos.map(r => r.path) : [];
    }

