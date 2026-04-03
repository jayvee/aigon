    // ── Settings view ──────────────────────────────────────────────────────────

    function readConductorReposFromGlobalConfig_client() {
      return (state.data && state.data.repos) ? state.data.repos.map(r => r.path) : [];
    }

    function getSettingsTargetRepo() {
      const repos = (state.data && state.data.repos) || [];
      if (repos.length === 0) return '';
      const validRepoPaths = repos.map(r => r.path);
      if (state.selectedRepo && state.selectedRepo !== 'all' && validRepoPaths.includes(state.selectedRepo)) return state.selectedRepo;
      if (state.settingsRepo && validRepoPaths.includes(state.settingsRepo)) return state.settingsRepo;
      return repos[0].path;
    }

    const settingsUiState = {
      drafts: {},
      focus: null,
      renderToken: 0
    };

    function settingsDraftKey(scope, key) {
      return scope + ':' + key;
    }

    function cssEsc(value) {
      if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value));
      return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    function readSettingsInputValue(type, input) {
      if (type === 'boolean') return !!input.checked;
      return input.value;
    }

    function writeSettingsInputValue(type, input, value) {
      if (type === 'boolean') input.checked = !!value;
      else input.value = value == null ? '' : String(value);
    }

    function captureSettingsUiState() {
      const active = document.activeElement;
      settingsUiState.focus = null;
      if (!active || !active.dataset) return;
      if (!active.dataset.settingsKey || !active.dataset.settingsScope) return;
      settingsUiState.focus = {
        key: active.dataset.settingsKey,
        scope: active.dataset.settingsScope,
        selectionStart: typeof active.selectionStart === 'number' ? active.selectionStart : null,
        selectionEnd: typeof active.selectionEnd === 'number' ? active.selectionEnd : null
      };
    }

    function restoreSettingsUiState(area) {
      const focus = settingsUiState.focus;
      if (!focus || !area) return;
      const selector = '[data-settings-key="' + cssEsc(focus.key) + '"][data-settings-scope="' + cssEsc(focus.scope) + '"]';
      const input = area.querySelector(selector);
      if (!input) return;
      input.focus({ preventScroll: true });
      if (typeof focus.selectionStart === 'number' && typeof input.setSelectionRange === 'function') {
        try {
          input.setSelectionRange(focus.selectionStart, focus.selectionEnd == null ? focus.selectionStart : focus.selectionEnd);
        } catch (_) {}
      }
    }

    function captureDetailScrollTop() {
      const detailArea = document.getElementById('detail-area');
      return detailArea ? detailArea.scrollTop : 0;
    }

    function restoreDetailScrollTop(scrollTop) {
      const detailArea = document.getElementById('detail-area');
      if (!detailArea) return;
      detailArea.scrollTop = scrollTop;
    }

    async function fetchDashboardSettings(repoPath, options) {
      const opts = options || {};
      const params = [];
      if (opts.globalOnly) params.push('globalOnly=1');
      else if (repoPath) params.push('repoPath=' + encodeURIComponent(repoPath));
      const qs = params.length ? ('?' + params.join('&')) : '';
      const res = await fetch('/api/settings' + qs, { cache: 'no-store' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || ('HTTP ' + res.status));
      return payload;
    }

    async function updateDashboardSetting(scope, key, value, repoPath) {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: scope, key: key, value: value, repoPath: repoPath })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || ('HTTP ' + res.status));
      return payload;
    }

    function renderConfigEditorSection(area, settingsData, repoPath) {
      const section = document.createElement('div');
      section.className = 'settings-section';
      const globalOnly = !!settingsData.globalOnly;
      const projectName = settingsData.projectName || (repoPath ? repoPath.split('/').filter(Boolean).pop() : 'selected repo');
      if (globalOnly) {
        section.innerHTML = '<h3>Global Defaults</h3><p>Editing <code>' + escHtml(settingsData.globalConfigPath || '~/.aigon/config.json') + '</code>. These defaults apply across repos unless a repo overrides them.</p>';
      } else {
        section.innerHTML = '<h3>Repo Overrides</h3><p>Editing overrides for <strong>' + escHtml(projectName) + '</strong> in <code>' + escHtml(settingsData.projectConfigPath || '.aigon/config.json') + '</code>.</p>';
      }

      const settings = settingsData.settings || [];
      const ungrouped = settings.filter(d => !d.group);
      const grouped = settings.filter(d => !!d.group);

      // Helper: create a text input wired to save on change
      function makeInput(def, scope, value, disabled) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'settings-input settings-input-compact';
        input.placeholder = 'Unset';
        input.dataset.settingsKey = def.key;
        input.dataset.settingsScope = scope;
        const draftKey = settingsDraftKey(scope, def.key);
        const draftValue = Object.prototype.hasOwnProperty.call(settingsUiState.drafts, draftKey) ? settingsUiState.drafts[draftKey] : value;
        writeSettingsInputValue(def.type, input, draftValue);
        input.disabled = !!disabled;
        input.oninput = () => { settingsUiState.drafts[draftKey] = input.value; };
        input.onchange = async () => {
          try {
            settingsUiState.drafts[draftKey] = input.value;
            await updateDashboardSetting(scope, def.key, input.value, repoPath);
            delete settingsUiState.drafts[draftKey];
            showToast('Updated ' + def.label.toLowerCase() + ' model');
            render();
          } catch (e) { showToast('Update failed: ' + e.message, null, null, { error: true }); render(); }
        };
        return input;
      }

      // ── General settings (table layout) ──
      if (ungrouped.length > 0) {
        // Helper: create a control element for a setting def + scope
        function makeGeneralControl(def, scope, value, disabled) {
          if (def.type === 'boolean') {
            const sw = document.createElement('label'); sw.className = 'toggle-switch';
            const input = document.createElement('input'); input.type = 'checkbox'; input.checked = !!value;
            input.dataset.settingsKey = def.key; input.dataset.settingsScope = scope;
            const draftKey = settingsDraftKey(scope, def.key);
            const draftValue = Object.prototype.hasOwnProperty.call(settingsUiState.drafts, draftKey) ? settingsUiState.drafts[draftKey] : value;
            if (draftValue != null) input.checked = !!draftValue;
            input.disabled = !!disabled;
            input.onchange = async () => {
              try {
                const nextValue = !!input.checked;
                settingsUiState.drafts[draftKey] = nextValue;
                await updateDashboardSetting(scope, def.key, nextValue, repoPath);
                delete settingsUiState.drafts[draftKey];
                showToast('Updated ' + def.label); render();
              } catch (e) { showToast('Update failed: ' + e.message, null, null, { error: true }); render(); }
            };
            const track = document.createElement('span'); track.className = 'toggle-track';
            sw.appendChild(input); sw.appendChild(track); return sw;
          } else if (def.type === 'enum') {
            const input = document.createElement('select'); input.className = 'settings-select settings-input-compact';
            const emptyOpt = document.createElement('option'); emptyOpt.value = ''; emptyOpt.textContent = ''; input.appendChild(emptyOpt);
            (def.options || []).forEach(opt => { const el = document.createElement('option'); el.value = opt; el.textContent = opt; input.appendChild(el); });
            input.dataset.settingsKey = def.key; input.dataset.settingsScope = scope;
            const draftKey = settingsDraftKey(scope, def.key);
            const draftValue = Object.prototype.hasOwnProperty.call(settingsUiState.drafts, draftKey) ? settingsUiState.drafts[draftKey] : value;
            input.value = draftValue == null ? '' : String(draftValue);
            input.disabled = !!disabled;
            input.onchange = async () => {
              try {
                settingsUiState.drafts[draftKey] = input.value;
                await updateDashboardSetting(scope, def.key, input.value, repoPath);
                delete settingsUiState.drafts[draftKey];
                showToast('Updated ' + def.label); render();
              } catch (e) { showToast('Update failed: ' + e.message, null, null, { error: true }); render(); }
            };
            return input;
          } else {
            return makeInput(def, scope, value, disabled);
          }
        }

        const card = document.createElement('div');
        card.className = 'agent-model-card';
        const header = document.createElement('div');
        header.className = 'agent-model-header';
        header.textContent = 'General';
        card.appendChild(header);

        const table = document.createElement('table');
        table.className = 'agent-model-table';
        let headHtml = '<thead><tr><th>Setting</th><th>Default</th>';
        if (!globalOnly) headHtml += '<th>Override</th>';
        headHtml += '<th>Effective</th></tr></thead>';
        table.innerHTML = headHtml;

        const tbody = document.createElement('tbody');
        ungrouped.forEach(def => {
          const tr = document.createElement('tr');

          const tdName = document.createElement('td');
          tdName.className = 'agent-model-task';
          tdName.innerHTML = escHtml(def.label) +
            (def.description ? ' <button type="button" class="settings-help settings-help-inline" data-settings-tooltip="' + escHtml(def.description) + '">?</button>' : '');
          tr.appendChild(tdName);

          const tdGlobal = document.createElement('td');
          tdGlobal.appendChild(makeGeneralControl(def, 'global', def.globalValue, !globalOnly));
          tr.appendChild(tdGlobal);

          if (!globalOnly) {
            const tdProject = document.createElement('td');
            tdProject.appendChild(makeGeneralControl(def, 'project', def.projectValue, false));
            tr.appendChild(tdProject);
          }

          const tdEff = document.createElement('td');
          tdEff.className = 'agent-model-effective';
          const effCode = document.createElement('code');
          effCode.textContent = def.effectiveValue != null ? JSON.stringify(def.effectiveValue) : 'unset';
          tdEff.appendChild(effCode);
          tr.appendChild(tdEff);

          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        card.appendChild(table);
        section.appendChild(card);
      }

      area.appendChild(section);

      // ── Grouped agent model settings ──
      if (grouped.length > 0) {
        const agentSection = document.createElement('div');
        agentSection.className = 'settings-section';
        agentSection.innerHTML = '<h3>Agent Models</h3><p>Model used for each task type. ' + (globalOnly ? 'Set global defaults here.' : 'Project overrides take precedence over global defaults.') + '</p>';

        // Collect groups in order
        const groupOrder = []; const groupMap = {};
        grouped.forEach(def => {
          if (!groupMap[def.group]) { groupMap[def.group] = { label: def.groupLabel || def.group, defs: [] }; groupOrder.push(def.group); }
          groupMap[def.group].defs.push(def);
        });

        const grid = document.createElement('div');
        grid.className = 'agent-model-grid';

        groupOrder.forEach(groupKey => {
          const g = groupMap[groupKey];
          const card = document.createElement('div');
          card.className = 'agent-model-card';

          const header = document.createElement('div');
          header.className = 'agent-model-header';
          header.textContent = g.label;
          card.appendChild(header);

          const table = document.createElement('table');
          table.className = 'agent-model-table';

          // Table header
          let headHtml = '<thead><tr><th>Task</th><th>Default</th>';
          if (!globalOnly) headHtml += '<th>Override</th>';
          headHtml += '<th>Effective</th></tr></thead>';
          table.innerHTML = headHtml;

          const tbody = document.createElement('tbody');
          g.defs.forEach(def => {
            const tr = document.createElement('tr');

            // Task name cell
            const tdTask = document.createElement('td');
            tdTask.className = 'agent-model-task';
            tdTask.textContent = def.label;
            tr.appendChild(tdTask);

            // Global default cell
            const tdGlobal = document.createElement('td');
            const globalInput = makeInput(def, 'global', def.globalValue, !globalOnly);
            tdGlobal.appendChild(globalInput);
            tr.appendChild(tdGlobal);

            // Project override cell (if not globalOnly)
            if (!globalOnly) {
              const tdProject = document.createElement('td');
              const projectInput = makeInput(def, 'project', def.projectValue, false);
              tdProject.appendChild(projectInput);
              tr.appendChild(tdProject);
            }

            // Effective value cell
            const tdEff = document.createElement('td');
            tdEff.className = 'agent-model-effective';
            const effCode = document.createElement('code');
            effCode.textContent = def.effectiveValue != null ? def.effectiveValue : 'unset';
            tdEff.appendChild(effCode);
            tr.appendChild(tdEff);

            tbody.appendChild(tr);
          });
          table.appendChild(tbody);
          card.appendChild(table);
          grid.appendChild(card);
        });

        agentSection.appendChild(grid);
        area.appendChild(agentSection);
      }

      const rawSection = document.createElement('div');
      rawSection.className = 'settings-section';
      rawSection.innerHTML = '<h3>' + (globalOnly ? 'Global Config' : 'Computed Config') + '</h3><p>' + (globalOnly ? 'Read-only view of the current global configuration file.' : 'Read-only merged configuration used by command execution.') + '</p>';
      const pre = document.createElement('pre');
      pre.className = 'settings-json';
      pre.textContent = JSON.stringify(settingsData.effective || {}, null, 2);
      rawSection.appendChild(pre);
      area.appendChild(rawSection);
    }

    function renderSettings() {
      const scrollTop = captureDetailScrollTop();
      document.getElementById('monitor-summary').style.display = 'none';
      document.getElementById('repo-header').style.display = 'none';
      document.getElementById('repo-sidebar').style.display = 'none';
      document.getElementById('repo-select-mobile').style.display = 'none';
      setHealth();
      const data = state.data || {};
      document.getElementById('updated-text').textContent = 'Updated ' + relTime(data.generatedAt || new Date().toISOString());

      // Preserve add-repo input state across re-renders (poll cycle destroys DOM)
      const existingInput = document.querySelector('.add-repo-input');
      const inputWasFocused = existingInput && document.activeElement === existingInput;
      const inputValue = existingInput ? existingInput.value : '';

      const reposRoot = document.getElementById('settings-view');
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

          const visBtn = document.createElement('button');
          visBtn.className = 'repo-list-vis' + (hidden ? ' hidden-state' : '');
          visBtn.title = hidden ? 'Show in dashboard' : 'Hide from dashboard';
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
      if (inputValue) input.value = inputValue;
      if (inputWasFocused) requestAnimationFrame(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); });
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
          return { row: row };
        }

        const masterRow = makeToggleRow('Enable macOS notifications', cfg.enabled, false, async (val) => {
          try {
            await fetch('/api/settings/notifications', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: val }) });
          } catch (_) {}
          loadAndRenderNotifToggles();
        });
        notifSection.appendChild(masterRow.row);

        Object.entries(NOTIF_TYPE_LABELS).forEach(([type, label]) => {
          const row = makeToggleRow(label, cfg.types[type] !== false, !cfg.enabled, async (val) => {
            try {
              await fetch('/api/settings/notifications', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ types: { [type]: val } }) });
            } catch (_) {}
          });
          row.row.style.paddingLeft = '24px';
          notifSection.appendChild(row.row);
        });
      }

      loadAndRenderNotifToggles();
      area.appendChild(notifSection);

      reposRoot.appendChild(area);
      restoreDetailScrollTop(scrollTop);
    }

    function renderConfigView() {
      captureSettingsUiState();
      const renderToken = ++settingsUiState.renderToken;
      const scrollTop = captureDetailScrollTop();
      document.getElementById('monitor-summary').style.display = 'none';
      document.getElementById('repo-header').style.display = 'none';
      setHealth();
      const data = state.data || {};
      document.getElementById('updated-text').textContent = 'Updated ' + relTime(data.generatedAt || new Date().toISOString());

      const configRoot = document.getElementById('config-view');
      const empty = document.getElementById('empty');
      configRoot.className = '';
      configRoot.innerHTML = '';
      empty.style.display = 'none';

      const area = document.createElement('div');
      area.className = 'settings-area';

      const intro = document.createElement('div');
      intro.className = 'settings-section';
      intro.innerHTML = '<h3>Config</h3><p>Select <strong>All Repos</strong> in the left sidebar to edit global defaults. Select a specific repo to edit only that repo\'s overrides.</p>';
      area.appendChild(intro);

      const targetRepo = getSettingsTargetRepo();
      const globalOnly = state.selectedRepo === 'all';

      const configSection = document.createElement('div');
      configSection.className = 'settings-section';
      configSection.innerHTML = '<h3>Loading config...</h3>';
      area.appendChild(configSection);

      fetchDashboardSettings(globalOnly ? '' : targetRepo, { globalOnly: globalOnly })
        .then(payload => {
          if (renderToken !== settingsUiState.renderToken) return;
          configSection.remove();
          renderConfigEditorSection(area, payload, globalOnly ? '' : targetRepo);
          restoreDetailScrollTop(scrollTop);
          restoreSettingsUiState(area);
        })
        .catch(err => {
          if (renderToken !== settingsUiState.renderToken) return;
          configSection.innerHTML = '<h3>Config</h3><p class="settings-empty">Failed to load config: ' + escHtml(err.message) + '</p>';
          restoreDetailScrollTop(scrollTop);
        });

      configRoot.appendChild(area);
      restoreDetailScrollTop(scrollTop);
      restoreSettingsUiState(area);
    }
