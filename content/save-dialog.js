/**
 * Content Script — Save Dialog
 * Shows after every capture: pick folder, create folder, add tags, then save.
 */
(function () {
  'use strict';
  const _br = globalThis.browser || globalThis.chrome;
  if (!_br) return;
  if (window.__sbSaveDialogLoaded) return;
  window.__sbSaveDialogLoaded = true;

  let _data = null;
  let _tags = [];
  let _overlay = null;
  let _tempId = null;

  _br.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'openSaveDialog') {
      _data = msg;
      _tempId = msg.tempId;
      _tags = [];
      _showDialog(msg);
    }
  });

  async function _showDialog(data) {
    // Fetch existing folders + tags from index
    let folders = [], suggestedTags = [];
    try {
      const res = await _br.runtime.sendMessage({ action: 'getIndexData' });
      folders = res.folders || [];
      suggestedTags = res.tags || [];
    } catch { /* use empty */ }

    _overlay = _el('div', 'sb-sd-overlay');

    const panel = _el('div', 'sb-sd-panel');

    // Thumbnail
    const thumb = _el('div', 'sb-sd-thumb');
    const img = document.createElement('img');
    img.src = data.thumbnailDataUrl || data.dataUrl || '';
    img.alt = 'Screenshot preview';
    thumb.appendChild(img);

    // Body
    const body = _el('div', 'sb-sd-body');

    // Title
    const titleRow = _el('div', 'sb-sd-title-row');
    titleRow.innerHTML = `
      <div class="sb-sd-icon">📷</div>
      <div>
        <div class="sb-sd-heading">Save Screenshot</div>
        <div class="sb-sd-sub">${_esc(new URL(data.pageUrl || location.href).hostname)}</div>
      </div>`;
    body.appendChild(titleRow);

    // Folder section
    const folderSection = _el('div', 'sb-sd-section');
    folderSection.innerHTML = `<label class="sb-sd-label"><i>📁</i> Folder</label>`;

    const folderSelect = document.createElement('select');
    folderSelect.className = 'sb-sd-select';
    folderSelect.innerHTML = `<option value="">— No folder —</option>` +
      folders.map(f => `<option value="${_esc(f)}">${_esc(f)}</option>`).join('') +
      `<option value="__new__">➕ Create new folder…</option>`;

    const newFolderRow = _el('div', 'sb-sd-new-folder-row');
    newFolderRow.style.display = 'none';
    const newFolderInput = document.createElement('input');
    newFolderInput.type = 'text';
    newFolderInput.placeholder = 'New folder name…';
    newFolderInput.className = 'sb-sd-input';
    newFolderRow.appendChild(newFolderInput);

    folderSelect.addEventListener('change', () => {
      newFolderRow.style.display = folderSelect.value === '__new__' ? 'flex' : 'none';
      if (folderSelect.value === '__new__') setTimeout(() => newFolderInput.focus(), 50);
    });

    folderSection.appendChild(folderSelect);
    folderSection.appendChild(newFolderRow);
    body.appendChild(folderSection);

    // Tags section
    const tagSection = _el('div', 'sb-sd-section');
    tagSection.innerHTML = `<label class="sb-sd-label"><i>🏷</i> Tags</label>`;

    const tagChips = _el('div', 'sb-sd-tag-chips');
    tagSection.appendChild(tagChips);

    const tagInputRow = _el('div', 'sb-sd-tag-input-row');
    const tagInput = document.createElement('input');
    tagInput.type = 'text';
    tagInput.placeholder = 'Type tag and press Enter…';
    tagInput.className = 'sb-sd-input';
    tagInput.setAttribute('list', 'sb-sd-tag-suggestions');

    const datalist = document.createElement('datalist');
    datalist.id = 'sb-sd-tag-suggestions';
    suggestedTags.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      datalist.appendChild(opt);
    });
    document.body.appendChild(datalist);

    const tagAddBtn = document.createElement('button');
    tagAddBtn.className = 'sb-sd-tag-add-btn';
    tagAddBtn.textContent = 'Add';

    const addTag = () => {
      const val = tagInput.value.trim();
      if (!val || _tags.includes(val)) { tagInput.value = ''; return; }
      _tags.push(val);
      tagInput.value = '';
      _renderTags(tagChips);
    };

    tagInput.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } });
    tagAddBtn.addEventListener('click', addTag);

    tagInputRow.appendChild(tagInput);
    tagInputRow.appendChild(tagAddBtn);
    tagSection.appendChild(tagInputRow);
    body.appendChild(tagSection);

    // Action buttons
    const actions = _el('div', 'sb-sd-actions');

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'sb-sd-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', _close);

    const editBtn = document.createElement('button');
    editBtn.className = 'sb-sd-btn';
    editBtn.textContent = '✏️ Edit';
    editBtn.addEventListener('click', () => {
      _br.runtime.sendMessage({
        action: 'switchToAnnotation',
        tempId: _tempId,
        pageUrl: _data.pageUrl,
        pageTitle: _data.pageTitle,
        captureType: _data.captureType
      });
      _tempId = null; // Prevent cancel on close
      _close();
    });

    const saveBtn = document.createElement('button');
    saveBtn.className = 'sb-sd-btn primary';
    saveBtn.textContent = '💾 Save Screenshot';
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';

      const folderPath = folderSelect.value === '__new__'
        ? newFolderInput.value.trim()
        : folderSelect.value;

      try {
        await _br.runtime.sendMessage({
          action:        'confirmSave',
          tempId:        _tempId,
          sourceUrl:     _data.pageUrl,
          pageTitle:     _data.pageTitle,
          captureType:   _data.captureType,
          hasAnnotations: _data.hasAnnotations || false,
          folderPath,
          tags: [..._tags]
        });
        _tempId = null; // prevent cancelSave in _close
      } catch (err) {
        console.error('[SB] Save failed:', err);
      }
      _close();
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(editBtn);
    actions.appendChild(saveBtn);
    body.appendChild(actions);

    panel.appendChild(thumb);
    panel.appendChild(body);
    _overlay.appendChild(panel);
    document.body.appendChild(_overlay);

    // Close on backdrop click
    _overlay.addEventListener('click', e => { if (e.target === _overlay) _close(); });
    document.addEventListener('keydown', _onKey);

    setTimeout(() => _overlay.classList.add('visible'), 10);

    function _renderTags(container) {
      container.innerHTML = _tags.map(t =>
        `<span class="sb-sd-chip">${_esc(t)}<span class="sb-sd-chip-x" data-tag="${_esc(t)}">×</span></span>`
      ).join('');
      container.querySelectorAll('.sb-sd-chip-x').forEach(btn => {
        btn.addEventListener('click', () => {
          _tags = _tags.filter(x => x !== btn.dataset.tag);
          _renderTags(container);
        });
      });
    }
  }

  function _onKey(e) { if (e.key === 'Escape') _close(); }

  function _close() {
    document.removeEventListener('keydown', _onKey);
    document.getElementById('sb-sd-tag-suggestions')?.remove();
    if (_tempId) { _br.runtime.sendMessage({ action: 'cancelSave', tempId: _tempId }).catch(() => {}); _tempId = null; }
    if (_overlay) { _overlay.classList.remove('visible'); setTimeout(() => { _overlay?.remove(); _overlay = null; }, 250); }
    window.__sbSaveDialogLoaded = false;
  }

  function _el(tag, cls) { const e = document.createElement(tag); e.className = cls; return e; }
  function _esc(s) { if(!s) return ''; return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }
})();
