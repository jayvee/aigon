    // ── Settings view ──────────────────────────────────────────────────────────

    function readConductorReposFromGlobalConfig_client() {
      return (state.data && state.data.repos) ? state.data.repos.map(r => r.path) : [];
    }

    function formatSettingsRepoPath(repoPath) {
      return String(repoPath || '').replace(/^\/Users\/[^/]+\//, '~/');
    }

    function getDefaultsSettingsRepo() {
      const repos = (state.data && state.data.repos) || [];
      const validRepoPaths = repos.map(r => r.path);
      if (state.settingsDefaultsRepo && validRepoPaths.includes(state.settingsDefaultsRepo)) return state.settingsDefaultsRepo;
      if (state.settingsRepo && state.settingsRepo !== 'all' && validRepoPaths.includes(state.settingsRepo)) return state.settingsRepo;
      if (state.selectedRepo && state.selectedRepo !== 'all' && validRepoPaths.includes(state.selectedRepo)) return state.selectedRepo;
      return repos[0] ? repos[0].path : '';
    }

    function getModelSettingsRepo() {
      const repos = (state.data && state.data.repos) || [];
      const validRepoPaths = repos.map(r => r.path);
      if (state.settingsModelRepo && validRepoPaths.includes(state.settingsModelRepo)) return state.settingsModelRepo;
      if (state.settingsRepo && state.settingsRepo !== 'all' && validRepoPaths.includes(state.settingsRepo)) return state.settingsRepo;
      if (state.selectedRepo && state.selectedRepo !== 'all' && validRepoPaths.includes(state.selectedRepo)) return state.selectedRepo;
      return repos[0] ? repos[0].path : '';
    }

    const settingsUiState = {
      drafts: {},
      focus: null,
      renderToken: 0,
      navScrollCleanup: null
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

    function scrollSettingsSection(sectionId) {
      const section = document.getElementById('settings-section-' + sectionId);
      if (!section) return;
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function makeSettingsShell() {
      const detailArea = document.getElementById('detail-area');
      const area = document.createElement('div');
      area.className = 'settings-area';

      const layout = document.createElement('div');
      layout.className = 'settings-layout';

      const nav = document.createElement('nav');
      nav.className = 'settings-nav';
      nav.setAttribute('aria-label', 'Settings sections');

      const content = document.createElement('div');
      content.className = 'settings-content';

      const sections = [];
      function addSection(id, label, title, description) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'settings-nav-btn';
        btn.textContent = label;
        btn.onclick = () => {
          setActiveSection(id);
          scrollSettingsSection(id);
        };
        nav.appendChild(btn);

        const section = document.createElement('section');
        section.className = 'settings-section settings-panel';
        section.id = 'settings-section-' + id;
        section.dataset.settingsSection = id;

        const heading = document.createElement('h3');
        heading.textContent = title;
        section.appendChild(heading);

        if (description) {
          const copy = document.createElement('p');
          copy.textContent = description;
          section.appendChild(copy);
        }

        content.appendChild(section);
        sections.push({ id: id, button: btn, section: section });
        return section;
      }

      function setActiveSection(activeId) {
        sections.forEach(item => {
          item.button.classList.toggle('active', item.id === activeId);
        });
      }

      function updateActiveSectionFromScroll() {
        if (!detailArea || sections.length === 0) return;
        const detailTop = detailArea.getBoundingClientRect().top;
        const anchorOffset = 120;
        let active = sections[0];

        sections.forEach(item => {
          const top = item.section.getBoundingClientRect().top - detailTop;
          if (top <= anchorOffset) active = item;
        });

        setActiveSection(active.id);
      }

      if (typeof settingsUiState.navScrollCleanup === 'function') {
        settingsUiState.navScrollCleanup();
        settingsUiState.navScrollCleanup = null;
      }
      if (detailArea) {
        const onScroll = () => updateActiveSectionFromScroll();
        detailArea.addEventListener('scroll', onScroll, { passive: true });
        settingsUiState.navScrollCleanup = () => detailArea.removeEventListener('scroll', onScroll);
      }

      layout.appendChild(nav);
      layout.appendChild(content);
      area.appendChild(layout);

      return {
        area: area,
        content: content,
        addSection: addSection,
        observeSection: () => {},
        setActiveSection: setActiveSection,
        syncActiveSection: updateActiveSectionFromScroll
      };
    }

    function renderDefaultsScopeSelector(section) {
      const wrap = document.createElement('div');
      wrap.className = 'settings-target-wrap';

      const label = document.createElement('div');
      label.className = 'settings-target-label';
      label.textContent = 'Compare values for';
      wrap.appendChild(label);

      const select = document.createElement('select');
      select.className = 'settings-target-select';
      const currentScope = getDefaultsSettingsRepo();

      ((state.data && state.data.repos) || []).forEach(repo => {
        const option = document.createElement('option');
        option.value = repo.path;
        option.textContent = repo.displayPath || repo.name || repo.path;
        select.appendChild(option);
      });

      select.value = currentScope;
      select.onchange = () => {
        state.settingsDefaultsRepo = select.value;
        localStorage.setItem(lsKey('settingsDefaultsRepo'), state.settingsDefaultsRepo);
        renderSettings();
      };
      wrap.appendChild(select);

      const hint = document.createElement('div');
      hint.className = 'settings-target-hint';
      hint.textContent = currentScope
        ? 'Shared settings stay on the left. Repository-specific values stay in the middle. The right column shows what Aigon will use.'
        : 'No repositories available for comparison.';
      wrap.appendChild(hint);

      section.appendChild(wrap);
    }

    function renderSettingsRepoSelector(section, options) {
      const opts = options || {};
      const repos = (state.data && state.data.repos) || [];
      const currentRepo = getModelSettingsRepo();
      const fallbackRepo = repos[0] ? repos[0].path : '';
      const selectedRepo = repos.some(repo => repo.path === currentRepo) ? currentRepo : fallbackRepo;

      const wrap = document.createElement('div');
      wrap.className = 'settings-target-wrap';

      const label = document.createElement('div');
      label.className = 'settings-target-label';
      label.textContent = opts.label || 'Select repository';
      wrap.appendChild(label);

      const select = document.createElement('select');
      select.className = 'settings-target-select';
      repos.forEach(repo => {
        const option = document.createElement('option');
        option.value = repo.path;
        option.textContent = repo.displayPath || repo.name || repo.path;
        select.appendChild(option);
      });
      select.value = selectedRepo;
      select.onchange = () => {
        state.settingsModelRepo = select.value;
        localStorage.setItem(lsKey('settingsModelRepo'), state.settingsModelRepo);
        renderSettings();
      };
      wrap.appendChild(select);

      const hint = document.createElement('div');
      hint.className = 'settings-target-hint';
      hint.textContent = selectedRepo
        ? 'Edit overrides for the selected repository and see the effective model that will be used.'
        : 'No repositories available for comparison.';
      wrap.appendChild(hint);

      section.appendChild(wrap);
      return selectedRepo;
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

    function renderDefaultsAndOverridesSection(section, globalSettingsData, repoSettingsData, repoPath) {
      const projectName = formatSettingsRepoPath(repoPath) || 'selected repo';
      const globalSettings = (globalSettingsData.settings || []).filter(d => !d.group);
      const repoSettings = (repoSettingsData && repoSettingsData.settings ? repoSettingsData.settings : []).filter(d => !d.group);

      function makeInput(def, scope, value, repoPathForUpdate, disabled) {
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
            await updateDashboardSetting(scope, def.key, input.value, repoPathForUpdate);
            delete settingsUiState.drafts[draftKey];
            showToast('Updated ' + def.label);
            render();
          } catch (e) { showToast('Update failed: ' + e.message, null, null, { error: true }); render(); }
        };
        return input;
      }

      function makeGeneralControl(def, scope, value, repoPathForUpdate, disabled) {
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
                await updateDashboardSetting(scope, def.key, nextValue, repoPathForUpdate);
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
                await updateDashboardSetting(scope, def.key, input.value, repoPathForUpdate);
                delete settingsUiState.drafts[draftKey];
                showToast('Updated ' + def.label); render();
              } catch (e) { showToast('Update failed: ' + e.message, null, null, { error: true }); render(); }
            };
            return input;
          } else {
            return makeInput(def, scope, value, repoPathForUpdate, disabled);
          }
        }

      function buildSettingsTable(defs, options) {
        const opts = options || {};
        const card = document.createElement('div');
        card.className = 'agent-model-card';
        const header = document.createElement('div');
        header.className = 'agent-model-header';
        header.textContent = opts.title;
        card.appendChild(header);

        const table = document.createElement('table');
        table.className = 'agent-model-table';
        let headHtml = '<thead><tr><th>Setting</th><th>' + escHtml(opts.defaultLabel || 'Shared') + '</th>';
        if (opts.showOverride) headHtml += '<th>' + escHtml(opts.overrideLabel || 'Repository') + '</th>';
        if (opts.showEffective) headHtml += '<th>' + escHtml(opts.effectiveLabel || 'Result') + '</th>';
        headHtml += '</tr></thead>';
        table.innerHTML = headHtml;

        const tbody = document.createElement('tbody');
        defs.forEach(def => {
          const tr = document.createElement('tr');

          const tdName = document.createElement('td');
          tdName.className = 'agent-model-task';
          tdName.innerHTML = escHtml(def.label) +
            (def.description ? ' <button type="button" class="settings-help settings-help-inline" data-settings-tooltip="' + escHtml(def.description) + '">?</button>' : '');
          tr.appendChild(tdName);

          const tdGlobal = document.createElement('td');
          tdGlobal.appendChild(makeGeneralControl(def, 'global', def.globalValue, opts.repoPath || '', !!opts.disableDefaults));
          tr.appendChild(tdGlobal);

          if (opts.showOverride) {
            const tdProject = document.createElement('td');
            tdProject.appendChild(makeGeneralControl(def, 'project', def.projectValue, opts.repoPath || '', false));
            tr.appendChild(tdProject);
          }

          if (opts.showEffective) {
            const tdEff = document.createElement('td');
            tdEff.className = 'agent-model-effective';
            const effCode = document.createElement('code');
            effCode.textContent = def.effectiveValue != null ? JSON.stringify(def.effectiveValue) : 'unset';
            tdEff.appendChild(effCode);
            tr.appendChild(tdEff);
          }

          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        card.appendChild(table);
        return card;
      }

      if (globalSettings.length > 0) {
        const globalSection = document.createElement('div');
        globalSection.className = 'settings-subsection';
        globalSection.innerHTML = '<h4>Shared settings</h4><p>These values apply to every repository unless a repository sets its own value.</p>';
        globalSection.appendChild(buildSettingsTable(globalSettings, {
          title: 'Shared settings',
          defaultLabel: 'Shared',
          showOverride: false,
          showEffective: false,
          disableDefaults: false
        }));
        section.appendChild(globalSection);
      }

      const repoSection = document.createElement('div');
      repoSection.className = 'settings-subsection';
      repoSection.innerHTML = '<h4>Repository settings</h4><p>Choose a repository, set any repository-specific values, and check the final result in the same row.</p>';
      renderDefaultsScopeSelector(repoSection);
      const compareCopy = document.createElement('div');
      compareCopy.className = 'settings-compare-intro';
      compareCopy.innerHTML = repoPath
        ? 'Selected repository: <strong>' + escHtml(projectName) + '</strong>. Left = shared value, middle = repository value, right = what Aigon will use.'
        : 'No repository selected.';
      repoSection.appendChild(compareCopy);

      if (repoSettings.length > 0) {
        repoSection.appendChild(buildSettingsTable(repoSettings, {
          title: 'Repository comparison',
          defaultLabel: 'Shared',
          overrideLabel: 'Repository',
          effectiveLabel: 'Result',
          showOverride: true,
          showEffective: true,
          disableDefaults: true,
          repoPath: repoPath
        }));
      }
      section.appendChild(repoSection);

      const rawSection = document.createElement('div');
      rawSection.className = 'settings-subsection';
      rawSection.innerHTML = '<h4>Resulting settings</h4><p>Read-only merged settings for ' + escHtml(projectName) + ' after repository values are applied.</p>';
      const pre = document.createElement('pre');
      pre.className = 'settings-json';
      pre.textContent = JSON.stringify((repoSettingsData && repoSettingsData.effective) || {}, null, 2);
      rawSection.appendChild(pre);
      section.appendChild(rawSection);
    }

    function renderModelCards(container, grouped, options) {
      const opts = options || {};
      if (grouped.length === 0) return;

      function makeInput(def, scope, value, repoPath, disabled) {
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

      const groupOrder = [];
      const groupMap = {};
      grouped.forEach(def => {
        if (!groupMap[def.group]) {
          groupMap[def.group] = { label: def.groupLabel || def.group, defs: [] };
          groupOrder.push(def.group);
        }
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

        let headHtml = '<thead><tr><th>Task</th><th>Default</th>';
        if (opts.showOverride) headHtml += '<th>Override</th>';
        if (opts.showEffective) headHtml += '<th>Effective</th>';
        headHtml += '</tr></thead>';
        table.innerHTML = headHtml;

        const tbody = document.createElement('tbody');
        g.defs.forEach(def => {
          const tr = document.createElement('tr');

          const tdTask = document.createElement('td');
          tdTask.className = 'agent-model-task';
          tdTask.textContent = def.label;
          tr.appendChild(tdTask);

          const tdGlobal = document.createElement('td');
          tdGlobal.appendChild(makeInput(def, 'global', def.globalValue, opts.repoPath || '', !!opts.disableDefaults));
          tr.appendChild(tdGlobal);

          if (opts.showOverride) {
            const tdProject = document.createElement('td');
            tdProject.appendChild(makeInput(def, 'project', def.projectValue, opts.repoPath || '', false));
            tr.appendChild(tdProject);
          }

          if (opts.showEffective) {
            const tdEff = document.createElement('td');
            tdEff.className = 'agent-model-effective';
            const effCode = document.createElement('code');
            effCode.textContent = def.effectiveValue != null ? def.effectiveValue : 'unset';
            tdEff.appendChild(effCode);
            tr.appendChild(tdEff);
          }

          tbody.appendChild(tr);
        });

        table.appendChild(tbody);
        card.appendChild(table);
        grid.appendChild(card);
      });

      container.appendChild(grid);
    }

    function renderModelsSection(section, globalSettingsData, repoSettingsData, repoPath) {
      const globalGrouped = (globalSettingsData.settings || []).filter(d => !!d.group);
      const repoGrouped = (repoSettingsData && repoSettingsData.settings ? repoSettingsData.settings : []).filter(d => !!d.group);

      if (globalGrouped.length === 0) {
        section.innerHTML += '<p class="settings-empty">No model settings found.</p>';
        return;
      }

      const globalSection = document.createElement('div');
      globalSection.className = 'settings-subsection';
      globalSection.innerHTML = '<h4>Global defaults</h4><p>Set the shared defaults for each model family. These apply to every repository until a repository overrides them.</p>';
      renderModelCards(globalSection, globalGrouped, { disableDefaults: false, showOverride: false, showEffective: false });
      section.appendChild(globalSection);

      const repoSection = document.createElement('div');
      repoSection.className = 'settings-subsection';
      repoSection.innerHTML = '<h4>Repository overrides</h4><p>Select a repository to override its model defaults and see the effective model that will be used.</p>';
      renderSettingsRepoSelector(repoSection, { label: 'Edit overrides for repository' });
      const compareCopy = document.createElement('div');
      compareCopy.className = 'settings-compare-intro';
      compareCopy.innerHTML = repoPath
        ? 'Selected repository: <strong>' + escHtml(formatSettingsRepoPath(repoPath)) + '</strong>. Override values here and confirm the effective model in the same row.'
        : 'No repository selected for model overrides.';
      repoSection.appendChild(compareCopy);
      if (repoGrouped.length > 0) {
        renderModelCards(repoSection, repoGrouped, { disableDefaults: true, showOverride: true, showEffective: true, repoPath: repoPath });
      } else {
        repoSection.innerHTML += '<p class="settings-empty">No repository-specific model settings found.</p>';
      }
      section.appendChild(repoSection);
    }

    function renderSettings() {
      captureSettingsUiState();
      const renderToken = ++settingsUiState.renderToken;
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

      const shell = makeSettingsShell();
      const area = shell.area;

      // Repos section
      const section = shell.addSection('repositories', 'Repositories', 'Repositories', 'Repos monitored by the dashboard. Toggle visibility, add new repos, or remove ones you no longer want to track.');

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
      shell.observeSection(section);

      // ── Notifications section ─────────────────────────────────────────────
      const NOTIF_TYPE_LABELS = {
        'agent-waiting': 'Agent waiting',
        'agent-submitted': 'Agent submitted',
        'all-submitted': 'All agents submitted (features)',
        'all-research-submitted': 'All agents submitted (research)',
        'error': 'Errors'
      };
      const notifSection = shell.addSection('notifications', 'Notifications', 'Notifications', 'macOS notifications are delivered only while the dashboard is running.');

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
      shell.observeSection(notifSection);

      const modelsSection = shell.addSection('models', 'Models', 'Models', 'Set global model defaults first, then choose a repository below to override them and see the effective model.');
      modelsSection.insertAdjacentHTML('beforeend', '<div class="settings-loading">Loading models...</div>');
      shell.observeSection(modelsSection);

      const defaultsSection = shell.addSection('defaults', 'Repository Settings', 'Repository Settings', 'Edit shared settings, then compare them with one repository at a time.');
      defaultsSection.insertAdjacentHTML('beforeend', '<div class="settings-loading">Loading settings...</div>');
      shell.observeSection(defaultsSection);

      shell.setActiveSection('repositories');
      requestAnimationFrame(() => shell.syncActiveSection());

      const repoPath = getDefaultsSettingsRepo();
      const modelRepoPath = getModelSettingsRepo();

      Promise.all([
        fetchDashboardSettings('', { globalOnly: true }),
        modelRepoPath ? fetchDashboardSettings(modelRepoPath, { globalOnly: false }) : Promise.resolve(null),
        fetchDashboardSettings('', { globalOnly: true }),
        repoPath ? fetchDashboardSettings(repoPath, { globalOnly: false }) : Promise.resolve(null)
      ])
        .then(([globalPayload, modelRepoPayload, globalDefaultsPayload, repoDefaultsPayload]) => {
          if (renderToken !== settingsUiState.renderToken) return;
          const loadingModels = modelsSection.querySelector('.settings-loading');
          if (loadingModels) loadingModels.remove();
          const loadingDefaults = defaultsSection.querySelector('.settings-loading');
          if (loadingDefaults) loadingDefaults.remove();
          renderModelsSection(modelsSection, globalPayload, modelRepoPayload, modelRepoPath);
          renderDefaultsAndOverridesSection(defaultsSection, globalDefaultsPayload, repoDefaultsPayload, repoPath);
          restoreDetailScrollTop(scrollTop);
          restoreSettingsUiState(reposRoot);
        })
        .catch(err => {
          if (renderToken !== settingsUiState.renderToken) return;
          modelsSection.innerHTML += '<p class="settings-empty">Failed to load model settings: ' + escHtml(err.message) + '</p>';
          defaultsSection.innerHTML += '<p class="settings-empty">Failed to load defaults and overrides: ' + escHtml(err.message) + '</p>';
          restoreDetailScrollTop(scrollTop);
        });

      reposRoot.appendChild(area);
      restoreDetailScrollTop(scrollTop);
      restoreSettingsUiState(reposRoot);
    }
