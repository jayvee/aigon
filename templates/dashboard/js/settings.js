    // ── Settings view ──────────────────────────────────────────────────────────

    function showDoctorModal(repoPath, displayPath) {
      const existing = document.getElementById('doctor-modal');
      if (existing) existing.remove();

      const backdrop = document.createElement('div');
      backdrop.id = 'doctor-modal';
      backdrop.className = 'modal-backdrop';
      backdrop.setAttribute('role', 'dialog');
      backdrop.setAttribute('aria-modal', 'true');
      backdrop.setAttribute('aria-labelledby', 'doctor-modal-title');

      const box = document.createElement('div');
      box.className = 'modal-box doctor-modal-box';

      const header = document.createElement('div');
      header.className = 'doctor-modal-header';
      header.innerHTML = '<h3 id="doctor-modal-title"><span class="doctor-modal-icon">✚</span> Aigon Doctor</h3>' +
        '<span class="doctor-modal-repo">' + escHtml(displayPath) + '</span>';

      const output = document.createElement('pre');
      output.className = 'doctor-output';
      output.textContent = 'Running…';

      const actions = document.createElement('div');
      actions.className = 'modal-actions doctor-modal-actions';

      const fixBtn = document.createElement('button');
      fixBtn.className = 'btn btn-primary doctor-fix-btn';
      fixBtn.textContent = 'Fix Issues';
      fixBtn.style.display = 'none';

      const closeBtn = document.createElement('button');
      closeBtn.className = 'btn';
      closeBtn.textContent = 'Close';
      closeBtn.onclick = () => backdrop.remove();

      const rerunBtn = document.createElement('button');
      rerunBtn.className = 'btn doctor-rerun-btn';
      rerunBtn.textContent = 'Re-run';
      rerunBtn.style.display = 'none';

      actions.appendChild(fixBtn);
      actions.appendChild(rerunBtn);
      actions.appendChild(closeBtn);
      box.appendChild(header);
      box.appendChild(output);
      box.appendChild(actions);
      backdrop.appendChild(box);
      backdrop.onclick = (e) => { if (e.target === backdrop) backdrop.remove(); };
      document.body.appendChild(backdrop);

      async function runDoctor(fix) {
        output.textContent = fix ? 'Fixing…' : 'Running…';
        fixBtn.style.display = 'none';
        rerunBtn.style.display = 'none';
        output.className = 'doctor-output doctor-running';
        try {
          const res = await fetch('/api/doctor', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: repoPath, fix }),
          });
          const data = await res.json().catch(() => ({}));
          output.textContent = data.output || '(no output)';
          output.className = 'doctor-output' + (data.issueCount > 0 && !fix ? ' doctor-has-issues' : '');
          if (data.issueCount > 0 && !fix) {
            fixBtn.textContent = 'Fix ' + data.issueCount + ' Issue' + (data.issueCount === 1 ? '' : 's');
            fixBtn.style.display = '';
          }
          if (fix && data.fixCount > 0) {
            output.className = 'doctor-output doctor-fixed';
          }
          rerunBtn.style.display = '';
        } catch (e) {
          output.textContent = 'Error: ' + e.message;
          output.className = 'doctor-output doctor-has-issues';
          rerunBtn.style.display = '';
        }
      }

      fixBtn.onclick = () => runDoctor(true);
      rerunBtn.onclick = () => runDoctor(false);
      runDoctor(false);
    }

    function fmtSyncTime(iso) {
      if (!iso) return 'never';
      try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return iso;
        return d.toLocaleString();
      } catch (_) { return iso; }
    }

    function renderSyncPanel(scope, host) {
      // scope: { id, label, includes, excludes, statusUrl, configureCmd, backupCmd, restoreCmd, statusCmd }
      host.innerHTML = '';
      host.className = 'settings-panel sync-panel';

      const h = document.createElement('h4');
      h.className = 'sync-panel-title';
      h.textContent = scope.label;
      host.appendChild(h);

      if (scope.includes && scope.includes.length) {
        const inc = document.createElement('ul');
        inc.className = 'sync-panel-includes';
        scope.includes.forEach(item => {
          const li = document.createElement('li');
          li.textContent = item;
          inc.appendChild(li);
        });
        host.appendChild(inc);
      }

      if (scope.excludes) {
        const ex = document.createElement('p');
        ex.className = 'sync-panel-excludes';
        ex.textContent = 'Not included: ' + scope.excludes;
        host.appendChild(ex);
      }

      const meta = document.createElement('div');
      meta.className = 'sync-panel-meta';
      meta.textContent = 'Loading…';
      host.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'sync-panel-actions modal-actions';

      function termBtn(label, cls, command) {
        const b = document.createElement('button');
        b.className = 'btn ' + cls;
        b.type = 'button';
        b.textContent = label;
        b.onclick = async () => {
          try {
            const r = await fetch('/api/open-terminal', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ command })
            });
            if (!r.ok) {
              const e = await r.json().catch(() => ({}));
              showToast('Failed: ' + (e.error || r.status));
            } else {
              showToast('Opened terminal: ' + command);
            }
          } catch (e) {
            showToast('Error: ' + e.message);
          }
        };
        return b;
      }
      actions.appendChild(termBtn('Back up', 'btn-primary', scope.backupCmd));
      actions.appendChild(termBtn('Restore', 'btn-secondary', scope.restoreCmd));
      actions.appendChild(termBtn('Status', 'btn-secondary', scope.statusCmd));
      host.appendChild(actions);

      fetch(scope.statusUrl)
        .then(r => r.json())
        .then(s => {
          if (!s || s.error) {
            meta.textContent = 'Status unavailable';
            return;
          }
          if (!s.configured) {
            meta.innerHTML = '<span class="sync-panel-warn">Not set up.</span> Configure a remote: <code>' + escHtml(scope.configureCmd) + '</code>';
            return;
          }
          meta.innerHTML =
            '<div class="sync-panel-row"><span class="sync-panel-label">Remote</span><span class="sync-panel-value">' + escHtml(s.remote || '—') + '</span></div>' +
            '<div class="sync-panel-row"><span class="sync-panel-label">Last backed up</span><span class="sync-panel-value">' + escHtml(fmtSyncTime(s.lastPushAt)) + '</span></div>' +
            '<div class="sync-panel-row"><span class="sync-panel-label">Last restored</span><span class="sync-panel-value">' + escHtml(fmtSyncTime(s.lastPullAt)) + '</span></div>';
        })
        .catch(err => { meta.textContent = 'Status unavailable: ' + err.message; });
    }

    function renderSyncPanels(section) {
      const wrap = document.createElement('div');
      wrap.className = 'sync-panels';
      const projectHost = document.createElement('div');
      const settingsHost = document.createElement('div');
      wrap.appendChild(projectHost);
      wrap.appendChild(settingsHost);
      section.appendChild(wrap);

      const projectRepo = getDefaultsSettingsRepo() || '';
      const projectStatusUrl = '/api/sync/status' + (projectRepo ? ('?repoPath=' + encodeURIComponent(projectRepo)) : '');
      renderSyncPanel({
        id: 'project',
        label: 'This project',
        includes: ['Feature & research specs', 'Workflow state', 'Board layout', 'Migration history', 'Project config (.aigon/config.json)'],
        excludes: 'sessions, logs, caches, locks',
        statusUrl: projectStatusUrl,
        configureCmd: 'aigon sync configure <git-url>',
        backupCmd: 'aigon sync push',
        restoreCmd: 'aigon sync pull',
        statusCmd: 'aigon sync status',
      }, projectHost);
      renderSyncPanel({
        id: 'settings',
        label: 'Your settings',
        includes: ['Agent definitions & model assignments', 'Named workflow presets', 'Global preferences (~/.aigon/config.json)'],
        excludes: 'logs, caches, port assignments',
        statusUrl: '/api/settings-sync/status',
        configureCmd: 'aigon settings configure <git-url>',
        backupCmd: 'aigon settings push',
        restoreCmd: 'aigon settings pull',
        statusCmd: 'aigon settings status',
      }, settingsHost);
    }

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
          } else if (def.type === 'enum' || def.type === 'select') {
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
          const doctorBtn = document.createElement('button');
          doctorBtn.className = 'repo-list-doctor';
          doctorBtn.title = 'Run Aigon Doctor';
          doctorBtn.textContent = '✚';
          doctorBtn.onclick = () => showDoctorModal(repoPath, displayPath);

          item.insertBefore(visBtn, item.firstChild);
          item.appendChild(doctorBtn);
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

      // ── Schedule section (deferred kickoffs) ───────────────────────────────
      const scheduleSection = shell.addSection('schedule', 'Schedule', 'Scheduled kickoffs', 'Pending and past jobs for this dashboard. Jobs use ISO 8601 times with an explicit timezone; the server poller runs them after runAt (catch-up if the server was offline).');
      const scheduleToolbar = document.createElement('div');
      scheduleToolbar.className = 'settings-schedule-toolbar';
      const schedRepoLabel = document.createElement('span');
      schedRepoLabel.className = 'settings-target-label';
      schedRepoLabel.textContent = 'Repository';
      const schedRepoSelect = document.createElement('select');
      schedRepoSelect.className = 'settings-target-select';
      const schedAllWrap = document.createElement('label');
      schedAllWrap.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary)';
      const schedAll = document.createElement('input');
      schedAll.type = 'checkbox';
      const schedAllText = document.createElement('span');
      schedAllText.textContent = 'Show fired / cancelled / failed';
      schedAllWrap.appendChild(schedAll);
      schedAllWrap.appendChild(schedAllText);
      const schedRefresh = document.createElement('button');
      schedRefresh.type = 'button';
      schedRefresh.className = 'btn btn-secondary';
      schedRefresh.textContent = 'Refresh';
      scheduleToolbar.appendChild(schedRepoLabel);
      scheduleToolbar.appendChild(schedRepoSelect);
      scheduleToolbar.appendChild(schedAllWrap);
      scheduleToolbar.appendChild(schedRefresh);
      scheduleSection.appendChild(scheduleToolbar);
      const scheduleTableHost = document.createElement('div');
      scheduleTableHost.className = 'schedule-jobs-table-host';
      scheduleSection.appendChild(scheduleTableHost);

      function scheduleRepoOptions() {
        const repos = (state.data && state.data.repos) || [];
        schedRepoSelect.innerHTML = '';
        if (repos.length === 0) {
          const o = document.createElement('option');
          o.value = '';
          o.textContent = '(no repos — using server cwd)';
          schedRepoSelect.appendChild(o);
          schedRepoSelect.disabled = true;
          return '';
        }
        schedRepoSelect.disabled = false;
        repos.forEach((repo) => {
          const o = document.createElement('option');
          o.value = repo.path;
          o.textContent = repo.displayPath || repo.name || repo.path;
          schedRepoSelect.appendChild(o);
        });
        if (repos.length > 1) {
          const allOpt = document.createElement('option');
          allOpt.value = '__all__';
          allOpt.textContent = 'All repositories';
          schedRepoSelect.insertBefore(allOpt, schedRepoSelect.firstChild);
          schedRepoSelect.value = '__all__';
        } else {
          schedRepoSelect.value = repos[0].path;
        }
        return schedRepoSelect.value;
      }

      async function loadScheduleJobsTable() {
        scheduleTableHost.innerHTML = '<div class="settings-loading">Loading jobs…</div>';
        const all = schedAll.checked ? '1' : '0';
        const v = schedRepoSelect.value;
        let url = '/api/schedule/jobs?all=' + all;
        if (v && v !== '__all__') url += '&repoPath=' + encodeURIComponent(v);
        try {
          const res = await fetch(url, { cache: 'no-store' });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || res.statusText);
          const jobs = data.jobs || [];
          scheduleTableHost.innerHTML = '';
          if (jobs.length === 0) {
            scheduleTableHost.innerHTML = '<p class="settings-empty">No jobs for this filter.</p>';
            return;
          }
          const tbl = document.createElement('table');
          tbl.className = 'schedule-jobs-table';
          tbl.innerHTML = '<thead><tr><th>Repository</th><th>Status</th><th>Kind</th><th>ID</th><th>Run at</th><th></th></tr></thead>';
          const tb = document.createElement('tbody');
          jobs.forEach((j) => {
            const tr = document.createElement('tr');
            const cancelTd = document.createElement('td');
            if (j.status === 'pending') {
              const b = document.createElement('button');
              b.type = 'button';
              b.className = 'btn';
              b.textContent = 'Cancel';
              b.onclick = async () => {
                if (!confirm('Cancel this scheduled job?')) return;
                b.disabled = true;
                try {
                  const cr = await fetch('/api/schedule/cancel', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ repoPath: j.repoPath, jobId: j.jobId }),
                  });
                  const cd = await cr.json().catch(() => ({}));
                  if (!cr.ok) throw new Error(cd.error || cr.statusText);
                  showToast('Cancelled job');
                  await loadScheduleJobsTable();
                  if (typeof requestRefresh === 'function') requestRefresh();
                } catch (e) {
                  showToast('Cancel failed: ' + e.message, null, null, { error: true });
                  b.disabled = false;
                }
              };
              cancelTd.appendChild(b);
            } else {
              cancelTd.textContent = '—';
            }
            const err = j.error ? (' ' + String(j.error).slice(0, 80)) : '';
            tr.innerHTML = '<td>' + escHtml(j.displayPath || j.repoPath || '') + '</td>' +
              '<td>' + escHtml(j.status || '') + '</td>' +
              '<td>' + escHtml(j.kind || '') + '</td>' +
              '<td>#' + escHtml(String(j.entityId || '')) + '</td>' +
              '<td title="' + escHtml(String(j.runAt || '')) + '">' + escHtml(String(j.runAt || '')) + escHtml(err) + '</td>';
            tr.appendChild(cancelTd);
            tb.appendChild(tr);
          });
          tbl.appendChild(tb);
          scheduleTableHost.appendChild(tbl);
        } catch (e) {
          scheduleTableHost.innerHTML = '<p class="settings-empty">Failed to load: ' + escHtml(e.message) + '</p>';
        }
      }

      scheduleRepoOptions();
      schedRepoSelect.onchange = () => { loadScheduleJobsTable(); };
      schedAll.onchange = () => { loadScheduleJobsTable(); };
      schedRefresh.onclick = () => { loadScheduleJobsTable(); };
      shell.observeSection(scheduleSection);
      loadScheduleJobsTable();

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

      // ── Terminal section ───────────────────────────────────────────────────
      const termSection = shell.addSection('terminal', 'Terminal', 'Terminal', 'Configure how sessions open and the appearance of the in-dashboard terminal.');

      function renderTerminalSettings() {
        termSection.querySelectorAll('.term-settings-row').forEach(r => r.remove());

        // terminalClickTarget
        const targetRow = document.createElement('div');
        targetRow.className = 'term-settings-row';
        const targetLabel = document.createElement('div');
        targetLabel.className = 'term-settings-label';
        targetLabel.textContent = 'Session click target';
        const targetHint = document.createElement('div');
        targetHint.className = 'term-settings-hint';
        targetHint.textContent = 'Choose whether clicking a session opens it in this dashboard or in your external terminal app.';
        const targetCtrl = document.createElement('div');
        targetCtrl.className = 'term-target-control';
        const currentTarget = getTerminalClickTarget();
        const btnDash = document.createElement('button');
        btnDash.className = 'term-target-btn' + (currentTarget === 'dashboard' ? ' active' : '');
        btnDash.type = 'button';
        btnDash.textContent = 'In Dashboard';
        btnDash.dataset.val = 'dashboard';
        const btnExt = document.createElement('button');
        btnExt.className = 'term-target-btn' + (currentTarget === 'external' ? ' active' : '');
        btnExt.type = 'button';
        btnExt.textContent = 'External App';
        btnExt.dataset.val = 'external';
        [btnDash, btnExt].forEach(btn => {
          btn.onclick = () => {
            setTerminalClickTarget(btn.dataset.val);
            showToast('Terminal target: ' + btn.textContent);
            renderTerminalSettings();
          };
        });
        targetCtrl.appendChild(btnDash);
        targetCtrl.appendChild(btnExt);
        targetRow.appendChild(targetLabel);
        targetRow.appendChild(targetCtrl);
        targetRow.appendChild(targetHint);
        termSection.appendChild(targetRow);

        // Terminal engine (xterm vs wterm — experimental DOM-rendered terminal)
        const engineRow = document.createElement('div');
        engineRow.className = 'term-settings-row';
        const engineLabel = document.createElement('div');
        engineLabel.className = 'term-settings-label';
        engineLabel.textContent = 'Terminal engine';
        const engineHint = document.createElement('div');
        engineHint.className = 'term-settings-hint';
        engineHint.textContent = 'xterm.js is the default (canvas/WebGL). wterm is experimental — DOM-rendered, with native text selection and browser Cmd+F search inside the terminal.';
        const engineCtrl = document.createElement('div');
        engineCtrl.className = 'term-target-control';
        const currentEngine = getTerminalEngine();
        const btnXterm = document.createElement('button');
        btnXterm.className = 'term-target-btn' + (currentEngine === 'xterm' ? ' active' : '');
        btnXterm.type = 'button';
        btnXterm.textContent = 'xterm.js';
        btnXterm.dataset.val = 'xterm';
        const btnWterm = document.createElement('button');
        btnWterm.className = 'term-target-btn' + (currentEngine === 'wterm' ? ' active' : '');
        btnWterm.type = 'button';
        btnWterm.textContent = 'wterm (experimental)';
        btnWterm.dataset.val = 'wterm';
        if (typeof window.WTerm !== 'function') {
          btnWterm.disabled = true;
          btnWterm.title = 'wterm has not finished loading';
        }
        [btnXterm, btnWterm].forEach(btn => {
          btn.onclick = () => {
            setTerminalEngine(btn.dataset.val);
            showToast('Terminal engine: ' + btn.textContent + ' — takes effect on next panel open');
            renderTerminalSettings();
          };
        });
        engineCtrl.appendChild(btnXterm);
        engineCtrl.appendChild(btnWterm);
        engineRow.appendChild(engineLabel);
        engineRow.appendChild(engineCtrl);
        engineRow.appendChild(engineHint);
        termSection.appendChild(engineRow);

        // Font picker
        const fontRow = document.createElement('div');
        fontRow.className = 'term-settings-row';
        const fontLabel = document.createElement('div');
        fontLabel.className = 'term-settings-label';
        fontLabel.textContent = 'Terminal font';
        const fontSelect = document.createElement('select');
        fontSelect.className = 'term-font-select';
        const FONT_OPTIONS = [
          { label: 'SF Mono (system)',  value: '"SF Mono","Cascadia Code",ui-monospace,monospace' },
          { label: 'Cascadia Code',     value: '"Cascadia Code","SF Mono",ui-monospace,monospace' },
          { label: 'JetBrains Mono',    value: '"JetBrains Mono","SF Mono",ui-monospace,monospace' },
          { label: 'Fira Code',         value: '"Fira Code","SF Mono",ui-monospace,monospace' },
          { label: 'Menlo',             value: 'Menlo,"SF Mono",ui-monospace,monospace' },
          { label: 'Courier New',       value: '"Courier New",Courier,monospace' },
        ];
        const currentFont = getTerminalFont();
        FONT_OPTIONS.forEach(opt => {
          const o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.label;
          o.style.fontFamily = opt.value;
          if (opt.value === currentFont) o.selected = true;
          fontSelect.appendChild(o);
        });
        fontSelect.onchange = () => {
          setTerminalFont(fontSelect.value);
          showToast('Terminal font updated — takes effect on next panel open');
        };
        fontRow.appendChild(fontLabel);
        fontRow.appendChild(fontSelect);
        termSection.appendChild(fontRow);
      }

      renderTerminalSettings();
      shell.observeSection(termSection);

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

      // ── Agent Matrix section ───────────────────────────────────────────────
      const matrixSection = shell.addSection('agent-matrix', 'Agent Matrix', 'Agent Capability Matrix',
        'Read-only view of all agents and models. Rows: (agent, model). Columns: qualitative score per operation. Pricing is public API equivalent (value-for-money signal, not billing). Scores are populated by benchmarks (F371); — means no data yet. Quarantined models are greyed.');

      const matrixWrap = document.createElement('div');
      matrixWrap.className = 'matrix-section';
      const matrixLoading = document.createElement('div');
      matrixLoading.className = 'matrix-loading';
      matrixLoading.textContent = 'Loading matrix…';
      matrixWrap.appendChild(matrixLoading);
      matrixSection.appendChild(matrixWrap);

      const AGENT_COLORS = {
        cc: { bg: 'rgba(59,130,246,.18)', color: '#93c5fd', border: 'rgba(59,130,246,.45)' },
        gg: { bg: 'rgba(34,197,94,.16)',  color: '#86efac', border: 'rgba(34,197,94,.4)' },
        cx: { bg: 'rgba(168,85,247,.16)', color: '#d8b4fe', border: 'rgba(168,85,247,.4)' },
        cu: { bg: 'rgba(249,115,22,.16)', color: '#fdba74', border: 'rgba(249,115,22,.4)' },
        op: { bg: 'rgba(6,182,212,.15)',  color: '#67e8f9', border: 'rgba(6,182,212,.4)' },
        km: { bg: 'rgba(124,58,237,.18)', color: '#c4b5fd', border: 'rgba(124,58,237,.45)' },
      };

      function renderAgentBadge(agentId, displayName) {
        const c = AGENT_COLORS[agentId] || { bg: 'rgba(255,255,255,.08)', color: 'var(--text-secondary)', border: 'var(--border-default)' };
        const badge = document.createElement('span');
        badge.className = 'matrix-agent-badge';
        badge.style.cssText = 'background:' + c.bg + ';color:' + c.color + ';border:1px solid ' + c.border;
        badge.textContent = agentId.toUpperCase();
        badge.title = displayName;
        return badge;
      }

      function renderScoreCell(score, note) {
        const td = document.createElement('td');
        td.className = 'matrix-score-cell';
        if (score == null) {
          const dash = document.createElement('span');
          dash.className = 'matrix-score-none';
          dash.textContent = '—';
          td.appendChild(dash);
        } else {
          const badge = document.createElement('span');
          const s = Math.max(1, Math.min(5, Math.round(score)));
          badge.className = 'matrix-score-badge matrix-score-' + s;
          badge.textContent = Number.isInteger(score) ? String(score) : score.toFixed(1);
          td.appendChild(badge);
        }
        if (note) {
          const tip = document.createElement('div');
          tip.className = 'matrix-notes-tip';
          tip.textContent = note;
          td.appendChild(tip);
        }
        return td;
      }

      function renderPricingCell(pricing) {
        const td = document.createElement('td');
        td.className = 'matrix-pricing-cell';
        if (!pricing) {
          td.innerHTML = '<span class="matrix-pricing-na">—</span>';
        } else if (pricing.inputPerM === 0 && pricing.outputPerM === 0) {
          td.innerHTML = '<span class="matrix-pricing-free">free</span>';
        } else {
          td.innerHTML =
            '$' + pricing.inputPerM.toFixed(2) + ' / ' +
            '$' + pricing.outputPerM.toFixed(2);
          td.title = '$' + pricing.inputPerM + '/M input · $' + pricing.outputPerM + '/M output';
        }
        return td;
      }

      function buildMatrixLegend() {
        const SCORE_META = [
          { score: 1, color: '#ef4444', label: 'Poor' },
          { score: 2, color: '#f97316', label: 'Below avg' },
          { score: 3, color: '#eab308', label: 'Average' },
          { score: 4, color: '#3b82f6', label: 'Strong' },
          { score: 5, color: '#22c55e', label: 'Best' },
        ];
        const legend = document.createElement('div');
        legend.className = 'matrix-legend';
        const label = document.createElement('span');
        label.className = 'matrix-legend-label';
        label.textContent = 'Score scale:';
        legend.appendChild(label);
        SCORE_META.forEach(m => {
          const item = document.createElement('span');
          item.className = 'matrix-legend-item';
          const badge = document.createElement('span');
          badge.className = 'matrix-score-badge matrix-score-' + m.score;
          badge.textContent = String(m.score);
          const desc = document.createElement('span');
          desc.className = 'matrix-legend-desc';
          desc.textContent = m.label;
          item.appendChild(badge);
          item.appendChild(desc);
          legend.appendChild(item);
        });
        const dash = document.createElement('span');
        dash.className = 'matrix-legend-item matrix-legend-dash';
        dash.innerHTML = '<span class="matrix-score-none">—</span><span class="matrix-legend-desc">No data</span>';
        legend.appendChild(dash);
        return legend;
      }

      function renderMatrixTable(data) {
        matrixWrap.innerHTML = '';
        const rows = data.rows || [];
        const ops = data.operations || ['draft', 'spec_review', 'implement', 'review'];
        const opLabels = data.operationLabels || {};

        if (rows.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'matrix-empty';
          empty.textContent = 'No agent models registered.';
          matrixWrap.appendChild(empty);
          return;
        }

        matrixWrap.appendChild(buildMatrixLegend());

        const tableWrap = document.createElement('div');
        tableWrap.className = 'matrix-table-wrap';
        const table = document.createElement('table');
        table.className = 'matrix-table';

        // Header
        const thead = document.createElement('thead');
        const hrow = document.createElement('tr');
        ['Agent', 'Model'].concat(ops.map(op => opLabels[op] || op), ['Pricing ($/M in/out)', 'Sessions', 'Refreshed']).forEach(label => {
          const th = document.createElement('th');
          th.textContent = label;
          hrow.appendChild(th);
        });
        thead.appendChild(hrow);
        table.appendChild(thead);

        // Body — group rows by agent
        const tbody = document.createElement('tbody');
        let lastAgent = null;
        for (const row of rows) {
          // Agent group header when agent changes
          if (row.agentId !== lastAgent) {
            const ghrow = document.createElement('tr');
            ghrow.className = 'matrix-agent-group-header';
            const gtd = document.createElement('td');
            gtd.colSpan = 2 + ops.length + 3;
            gtd.appendChild(renderAgentBadge(row.agentId, row.agentDisplayName));
            const gname = document.createElement('span');
            gname.style.marginLeft = '8px';
            gname.textContent = row.agentDisplayName;
            gtd.appendChild(gname);
            ghrow.appendChild(gtd);
            tbody.appendChild(ghrow);
            lastAgent = row.agentId;
          }

          const tr = document.createElement('tr');
          tr.className = 'matrix-agent-group' + (row.quarantined ? ' matrix-row-quarantined' : '');

          // Agent cell (empty — agent shown in group header)
          const agentTd = document.createElement('td');
          agentTd.style.paddingLeft = '24px';
          if (row.quarantined) {
            const qbadge = document.createElement('span');
            qbadge.className = 'matrix-quarantine-badge';
            qbadge.textContent = 'Q';
            const qtip = document.createElement('div');
            qtip.className = 'matrix-notes-tip';
            qtip.textContent = row.quarantined.reason || 'Quarantined';
            qbadge.appendChild(qtip);
            agentTd.appendChild(qbadge);
          }
          tr.appendChild(agentTd);

          // Model cell
          const modelTd = document.createElement('td');
          if (row.modelValue === null) {
            const span = document.createElement('span');
            span.className = 'matrix-model-default';
            span.textContent = row.modelLabel;
            modelTd.appendChild(span);
          } else {
            const span = document.createElement('span');
            span.className = 'matrix-model-label' + (row.quarantined ? ' matrix-row-quarantined' : '');
            span.textContent = row.modelLabel;
            modelTd.appendChild(span);
          }
          tr.appendChild(modelTd);

          // Operation score cells
          for (const op of ops) {
            const score = (row.score && row.score[op] != null) ? row.score[op] : null;
            const note = (row.notes && row.notes[op]) || null;
            tr.appendChild(renderScoreCell(score, note));
          }

          // Pricing cell
          tr.appendChild(renderPricingCell(row.pricing));

          // Sessions cell
          const statsTd = document.createElement('td');
          statsTd.className = 'matrix-stats-cell';
          const sessions = row.stats ? (row.stats.features + row.stats.research) : 0;
          statsTd.textContent = sessions > 0 ? String(sessions) : '—';
          if (row.stats && sessions > 0) {
            statsTd.title = row.stats.features + ' features · ' + row.stats.research + ' research · $' + (row.stats.cost || 0).toFixed(4);
          }
          tr.appendChild(statsTd);

          // Refreshed cell
          const refreshTd = document.createElement('td');
          refreshTd.className = 'matrix-refresh-date';
          if (row.lastRefreshAt) {
            const d = new Date(row.lastRefreshAt);
            refreshTd.textContent = Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric' });
            refreshTd.title = row.lastRefreshAt;
          } else {
            refreshTd.textContent = '—';
          }
          tr.appendChild(refreshTd);

          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        tableWrap.appendChild(table);
        matrixWrap.appendChild(tableWrap);
      }

      // Fetch matrix data (best-effort — non-fatal on failure)
      const matrixRepoPath = repoPath || '';
      const matrixUrl = '/api/agent-matrix' + (matrixRepoPath ? '?repoPath=' + encodeURIComponent(matrixRepoPath) : '');
      fetch(matrixUrl)
        .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
        .then(data => {
          if (renderToken !== settingsUiState.renderToken) return;
          renderMatrixTable(data);
        })
        .catch(err => {
          if (renderToken !== settingsUiState.renderToken) return;
          matrixWrap.innerHTML = '<div class="matrix-empty">Failed to load matrix: ' + escHtml(err.message) + '</div>';
        });

      // ── Backup & Sync section ──────────────────────────────────────────────
      const syncSection = shell.addSection('sync', 'Backup & Sync', 'Backup & Sync',
        'Save aigon state to a private git remote and restore it on any machine. "This project" covers specs and workflow state for this repo. "Your settings" covers your global agent config and workflow presets.');
      shell.observeSection(syncSection);
      renderSyncPanels(syncSection);

      // Version section
      const versionSection = shell.addSection('version', 'Version', 'Version', 'Installed version and npm registry update status.');
      const uc = (state.data || {}).updateCheck;
      const stateLabels = { latest: 'up to date', 'update-available': 'update available', 'prerelease-available': 'prerelease available', unavailable: 'unavailable' };
      const stateCls = { latest: 'state-latest', 'update-available': 'state-update', 'prerelease-available': 'state-prerelease', unavailable: 'state-unavailable' };
      const ucState = (uc && uc.state) || 'unavailable';
      function vRow(label, value) {
        const row = document.createElement('div');
        row.className = 'version-row';
        row.innerHTML = '<span class="version-label">' + escHtml(label) + '</span><span class="version-value">' + escHtml(value || '—') + '</span>';
        return row;
      }
      const vPanel = document.createElement('div');
      vPanel.className = 'version-info settings-panel';
      vPanel.appendChild(vRow('Installed', (uc && uc.current) || '—'));
      if (uc) {
        if (uc.latestStable) vPanel.appendChild(vRow('Latest stable', uc.latestStable));
        if (uc.latestNext) vPanel.appendChild(vRow('Latest next', uc.latestNext));
        const stateRow = document.createElement('div');
        stateRow.className = 'version-row';
        stateRow.innerHTML = '<span class="version-label">Status</span><span class="version-state-badge ' + (stateCls[ucState] || 'state-unavailable') + '">' + escHtml(stateLabels[ucState] || ucState) + '</span>';
        vPanel.appendChild(stateRow);
        if (ucState === 'update-available' || ucState === 'prerelease-available') {
          vPanel.appendChild(vRow('Upgrade command', uc.upgradeCommand));
        }
        if (uc.error) vPanel.appendChild(vRow('Registry error', uc.error));
      } else {
        const checking = document.createElement('div');
        checking.className = 'version-row';
        checking.innerHTML = '<span class="version-label">Status</span><span class="version-value" style="color:var(--text-tertiary)">Checking…</span>';
        vPanel.appendChild(checking);
      }
      versionSection.appendChild(vPanel);

      reposRoot.appendChild(area);
      restoreDetailScrollTop(scrollTop);
      restoreSettingsUiState(reposRoot);
    }
