'use strict';

const state = {
  password: sessionStorage.getItem('sitedockPassword') || '',
  deployments: [],
  activeDeployment: null,
  activeFileContent: '',
  selectedUpload: null,
  manageMode: false,
  selectedDeploymentIds: new Set()
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const elements = {
  authScreen: $('#authScreen'),
  appShell: $('#appShell'),
  authForm: $('#authForm'),
  authError: $('#authError'),
  passwordInput: $('#passwordInput'),
  pageTitle: $('#pageTitle'),
  deploymentsView: $('#deploymentsView'),
  newView: $('#newView'),
  sitesGrid: $('#sitesGrid'),
  emptyState: $('#emptyState'),
  totalSites: $('#totalSites'),
  totalFiles: $('#totalFiles'),
  storageUsed: $('#storageUsed'),
  searchInput: $('#searchInput'),
  manageSitesButton: $('#manageSitesButton'),
  bulkActions: $('#bulkActions'),
  selectedCount: $('#selectedCount'),
  selectAllButton: $('#selectAllButton'),
  cancelManageButton: $('#cancelManageButton'),
  deleteSelectedButton: $('#deleteSelectedButton'),
  uploadForm: $('#uploadForm'),
  zipInput: $('#zipInput'),
  siteName: $('#siteName'),
  dropzone: $('#dropzone'),
  selectedFile: $('#selectedFile'),
  selectedFilename: $('#selectedFilename'),
  selectedFilesize: $('#selectedFilesize'),
  clearFileButton: $('#clearFileButton'),
  deployButton: $('#deployButton'),
  uploadError: $('#uploadError'),
  uploadProgress: $('#uploadProgress'),
  progressLabel: $('#progressLabel'),
  progressPercent: $('#progressPercent'),
  progressBar: $('#progressBar'),
  inspector: $('#inspector'),
  inspectorTitle: $('#inspectorTitle'),
  deploymentMeta: $('#deploymentMeta'),
  openLiveButton: $('#openLiveButton'),
  copyUrlButton: $('#copyUrlButton'),
  browserUrl: $('#browserUrl'),
  previewFrame: $('#previewFrame'),
  previewPanel: $('#previewPanel'),
  filesPanel: $('#filesPanel'),
  fileTree: $('#fileTree'),
  activeFilePath: $('#activeFilePath'),
  codeEmpty: $('#codeEmpty'),
  codeViewer: $('#codeViewer'),
  binaryViewer: $('#binaryViewer'),
  copyCodeButton: $('#copyCodeButton'),
  renameInput: $('#renameInput'),
  renameButton: $('#renameButton'),
  downloadZipButton: $('#downloadZipButton'),
  replaceZipButton: $('#replaceZipButton'),
  replaceZipInput: $('#replaceZipInput'),
  deleteButton: $('#deleteButton'),
  toast: $('#toast')
};

function authHeaders(extra = {}) {
  return { ...extra, ...(state.password ? { 'x-admin-password': state.password } : {}) };
}

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: authHeaders(options.headers || {}) });
  if (response.status === 401) {
    showAuth();
    throw new Error('Incorrect dashboard password.');
  }
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(payload?.error || payload || 'Request failed.');
  return payload;
}

function showAuth() {
  elements.authScreen.classList.remove('hidden');
  elements.appShell.classList.add('hidden');
  requestAnimationFrame(() => elements.passwordInput.focus());
}

function hideAuth() {
  elements.authScreen.classList.add('hidden');
  elements.appShell.classList.remove('hidden');
}

function formatBytes(bytes = 0) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);
  return `${value.toFixed(index === 0 || value >= 10 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value) {
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

function showToast(message, type = '') {
  elements.toast.textContent = message;
  elements.toast.className = `toast ${type}`.trim();
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => elements.toast.classList.add('hidden'), 2800);
}

function switchView(view) {
  const isDeployments = view === 'deployments';
  elements.deploymentsView.classList.toggle('active', isDeployments);
  elements.newView.classList.toggle('active', !isDeployments);
  elements.pageTitle.textContent = isDeployments ? 'Deployments' : 'New deployment';
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  if (!isDeployments) setTimeout(() => elements.siteName.focus(), 100);
}

async function loadDeployments() {
  const items = await api('/api/deployments');
  state.deployments = items;
  renderDeployments();
}

function filteredDeployments() {
  const query = elements.searchInput.value.trim().toLowerCase();
  return state.deployments.filter((item) => item.name.toLowerCase().includes(query) || item.id.includes(query));
}

function updateBulkActions(filtered = filteredDeployments()) {
  const selectedCount = state.selectedDeploymentIds.size;
  elements.bulkActions.classList.toggle('hidden', !state.manageMode);
  elements.manageSitesButton.classList.toggle('active', state.manageMode);
  elements.manageSitesButton.textContent = state.manageMode ? 'Done' : 'Manage sites';
  elements.selectedCount.textContent = `${selectedCount.toLocaleString()} selected`;
  elements.deleteSelectedButton.disabled = selectedCount === 0;

  const visibleIds = filtered.map((site) => site.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => state.selectedDeploymentIds.has(id));
  elements.selectAllButton.textContent = allVisibleSelected ? 'Clear visible' : 'Select all';
}

function renderDeployments() {
  const filtered = filteredDeployments();
  elements.totalSites.textContent = state.deployments.length.toLocaleString();
  elements.totalFiles.textContent = state.deployments.reduce((sum, item) => sum + (item.fileCount || 0), 0).toLocaleString();
  elements.storageUsed.textContent = formatBytes(state.deployments.reduce((sum, item) => sum + (item.sizeBytes || 0), 0));
  elements.emptyState.classList.toggle('hidden', state.deployments.length !== 0);

  elements.sitesGrid.innerHTML = filtered.map((site) => {
    const selected = state.selectedDeploymentIds.has(site.id);
    return `
      <article class="site-card ${state.manageMode ? 'manage-mode' : ''} ${selected ? 'selected' : ''}" data-site-id="${escapeHtml(site.id)}" tabindex="0" role="button" aria-label="${state.manageMode ? 'Select' : 'Inspect'} ${escapeHtml(site.name)}" aria-pressed="${state.manageMode ? String(selected) : 'false'}">
        <div class="site-thumb">
          <span class="live-pill">LIVE</span>
          <button class="site-select ${state.manageMode ? '' : 'hidden'}" type="button" data-action="select" aria-label="${selected ? 'Deselect' : 'Select'} ${escapeHtml(site.name)}"><span>✓</span></button>
          <iframe src="${escapeHtml(site.url)}" sandbox="" loading="lazy" title="${escapeHtml(site.name)} thumbnail"></iframe>
        </div>
        <div class="site-body">
          <div class="site-title-row">
            <h3>${escapeHtml(site.name)}</h3>
            <button class="site-delete" type="button" data-action="delete" aria-label="Delete ${escapeHtml(site.name)}" title="Delete deployment">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h10l-.7 11H7.7L7 9Zm3 2v7h2v-7h-2Zm4 0v7h2v-7h-2Z"/></svg>
            </button>
          </div>
          <p class="site-url">${escapeHtml(site.url.replace(/^https?:\/\//, ''))}</p>
          <div class="site-meta"><span>${site.fileCount.toLocaleString()} files · ${formatBytes(site.sizeBytes)}</span><span>Updated ${formatDate(site.updatedAt)}</span></div>
        </div>
      </article>
    `;
  }).join('');

  updateBulkActions(filtered);
}

function toggleDeploymentSelection(id) {
  if (state.selectedDeploymentIds.has(id)) state.selectedDeploymentIds.delete(id);
  else state.selectedDeploymentIds.add(id);
  renderDeployments();
}

function setManageMode(enabled) {
  state.manageMode = enabled;
  if (!enabled) state.selectedDeploymentIds.clear();
  renderDeployments();
}

async function deleteDeploymentById(id, { confirmFirst = true, refresh = true } = {}) {
  const site = state.deployments.find((item) => item.id === id);
  if (!site) return false;
  if (confirmFirst) {
    const confirmed = window.confirm(`Delete “${site.name}”? This permanently removes the site and its live URL.`);
    if (!confirmed) return false;
  }
  await api(`/api/deployments/${id}`, { method: 'DELETE' });
  state.selectedDeploymentIds.delete(id);
  if (state.activeDeployment?.id === id) closeInspector();
  if (refresh) await loadDeployments();
  return true;
}

async function deleteSelectedDeployments() {
  const ids = [...state.selectedDeploymentIds];
  if (!ids.length) return;
  const confirmed = window.confirm(`Delete ${ids.length} selected deployment${ids.length === 1 ? '' : 's'}? Their live URLs and stored files will be permanently removed.`);
  if (!confirmed) return;

  elements.deleteSelectedButton.disabled = true;
  elements.deleteSelectedButton.textContent = 'Deleting…';
  const results = await Promise.allSettled(ids.map((id) => deleteDeploymentById(id, { confirmFirst: false, refresh: false })));
  const deleted = results.filter((result) => result.status === 'fulfilled' && result.value).length;
  const failed = results.length - deleted;

  state.selectedDeploymentIds.clear();
  await loadDeployments();
  if (failed) showToast(`${deleted} deleted; ${failed} could not be deleted.`, 'error');
  else showToast(`${deleted} deployment${deleted === 1 ? '' : 's'} deleted.`);
  elements.deleteSelectedButton.textContent = 'Delete selected';
}

function selectUpload(file) {
  elements.uploadError.textContent = '';
  if (!file) {
    state.selectedUpload = null;
    elements.zipInput.value = '';
    elements.selectedFile.classList.add('hidden');
    elements.deployButton.disabled = true;
    return;
  }
  if (!file.name.toLowerCase().endsWith('.zip')) {
    elements.uploadError.textContent = 'Choose a .zip website file.';
    return;
  }
  if (file.size > 50 * 1024 * 1024) {
    elements.uploadError.textContent = 'The ZIP must be 50 MB or smaller.';
    return;
  }
  state.selectedUpload = file;
  elements.selectedFilename.textContent = file.name;
  elements.selectedFilesize.textContent = formatBytes(file.size);
  elements.selectedFile.classList.remove('hidden');
  elements.deployButton.disabled = false;
  if (!elements.siteName.value.trim()) elements.siteName.value = file.name.replace(/\.zip$/i, '').replace(/[-_]+/g, ' ');
}

function uploadWithProgress(url, method, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    if (state.password) xhr.setRequestHeader('x-admin-password', state.password);
    xhr.responseType = 'json';
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    xhr.addEventListener('load', () => {
      if (xhr.status === 401) showAuth();
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
      else reject(new Error(xhr.response?.error || 'Deployment failed.'));
    });
    xhr.addEventListener('error', () => reject(new Error('Network error while uploading.')));
    xhr.send(formData);
  });
}

async function deploySelectedFile(event) {
  event.preventDefault();
  if (!state.selectedUpload) return;
  elements.deployButton.disabled = true;
  elements.uploadError.textContent = '';
  elements.uploadProgress.classList.remove('hidden');
  elements.progressLabel.textContent = 'Uploading website…';

  const formData = new FormData();
  formData.append('siteZip', state.selectedUpload);
  formData.append('name', elements.siteName.value.trim());

  try {
    const deployed = await uploadWithProgress('/api/deployments', 'POST', formData, (percent) => {
      elements.progressPercent.textContent = `${percent}%`;
      elements.progressBar.style.width = `${percent}%`;
      if (percent === 100) elements.progressLabel.textContent = 'Extracting and publishing…';
    });
    elements.progressPercent.textContent = '100%';
    elements.progressBar.style.width = '100%';
    elements.progressLabel.textContent = 'Deployment live';
    await loadDeployments();
    selectUpload(null);
    elements.siteName.value = '';
    switchView('deployments');
    showToast('Website deployed successfully.');
    setTimeout(() => openInspector(deployed.id), 250);
  } catch (error) {
    elements.uploadError.textContent = error.message;
  } finally {
    elements.deployButton.disabled = !state.selectedUpload;
    setTimeout(() => {
      elements.uploadProgress.classList.add('hidden');
      elements.progressBar.style.width = '0';
      elements.progressPercent.textContent = '0%';
    }, 1000);
  }
}

function switchInspectorTab(tab) {
  $$('.tab').forEach((button) => button.classList.toggle('active', button.dataset.inspectorTab === tab));
  elements.previewPanel.classList.toggle('active', tab === 'preview');
  elements.filesPanel.classList.toggle('active', tab === 'files');
}

async function openInspector(id) {
  const site = state.deployments.find((item) => item.id === id);
  if (!site) return;
  state.activeDeployment = site;
  elements.inspectorTitle.textContent = site.name;
  elements.deploymentMeta.textContent = `${site.fileCount.toLocaleString()} files · ${formatBytes(site.sizeBytes)} · updated ${formatDate(site.updatedAt)}`;
  elements.openLiveButton.href = site.url;
  elements.browserUrl.textContent = site.url;
  elements.previewFrame.src = `${site.url}?preview=${Date.now()}`;
  elements.renameInput.value = site.name;
  elements.downloadZipButton.href = '#';
  elements.inspector.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  switchInspectorTab('preview');
  resetCodeViewer();

  try {
    const files = await api(`/api/deployments/${site.id}/files`);
    renderFileTree(files);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function closeInspector() {
  elements.inspector.classList.add('hidden');
  elements.previewFrame.src = 'about:blank';
  document.body.style.overflow = '';
  state.activeDeployment = null;
}

function renderFileTree(entries) {
  elements.fileTree.innerHTML = entries.map((entry) => {
    const depth = entry.path.split('/').length - 1;
    const name = entry.path.split('/').pop();
    const icon = entry.type === 'directory' ? '▾' : fileIcon(name);
    return `<button class="file-row ${entry.type === 'file' ? 'file' : 'directory'}" style="padding-left:${8 + depth * 14}px" ${entry.type === 'file' ? `data-path="${escapeHtml(entry.path)}"` : 'disabled'}><span class="file-icon">${icon}</span><span>${escapeHtml(name)}</span></button>`;
  }).join('');

  $$('.file-row.file', elements.fileTree).forEach((row) => row.addEventListener('click', () => inspectFile(row.dataset.path, row)));
}

function fileIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  if (['html', 'htm'].includes(ext)) return '◇';
  if (['css', 'scss', 'sass'].includes(ext)) return '#';
  if (['js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx'].includes(ext)) return 'JS';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext)) return '▧';
  if (['json', 'map'].includes(ext)) return '{}';
  return '·';
}

function resetCodeViewer() {
  elements.activeFilePath.textContent = 'Select a file';
  elements.codeEmpty.classList.remove('hidden');
  elements.codeViewer.classList.add('hidden');
  elements.binaryViewer.classList.add('hidden');
  elements.copyCodeButton.classList.add('hidden');
  state.activeFileContent = '';
}

async function inspectFile(filePath, row) {
  if (!state.activeDeployment) return;
  $$('.file-row.file', elements.fileTree).forEach((item) => item.classList.remove('active'));
  row.classList.add('active');
  elements.activeFilePath.textContent = filePath;
  elements.codeEmpty.classList.add('hidden');
  elements.codeViewer.classList.add('hidden');
  elements.binaryViewer.classList.add('hidden');
  elements.copyCodeButton.classList.add('hidden');

  const ext = filePath.split('.').pop().toLowerCase();
  const publicFileUrl = `${state.activeDeployment.url}${filePath.split('/').map(encodeURIComponent).join('/')}`;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext)) {
    elements.binaryViewer.innerHTML = `<img src="${escapeHtml(publicFileUrl)}" alt="${escapeHtml(filePath)}">`;
    elements.binaryViewer.classList.remove('hidden');
    return;
  }
  if (['woff', 'woff2', 'ttf', 'otf', 'mp4', 'webm', 'mp3', 'wav', 'pdf', 'zip'].includes(ext)) {
    elements.binaryViewer.innerHTML = `<div class="binary-card"><strong>Binary file</strong><span>${escapeHtml(filePath)} · open it through the live site to inspect it.</span></div>`;
    elements.binaryViewer.classList.remove('hidden');
    return;
  }

  try {
    const content = await api(`/api/deployments/${state.activeDeployment.id}/file?path=${encodeURIComponent(filePath)}`);
    state.activeFileContent = content;
    $('code', elements.codeViewer).textContent = content;
    elements.codeViewer.classList.remove('hidden');
    elements.copyCodeButton.classList.remove('hidden');
  } catch (error) {
    elements.binaryViewer.innerHTML = `<div class="binary-card"><strong>Cannot inspect this file</strong><span>${escapeHtml(error.message)}</span></div>`;
    elements.binaryViewer.classList.remove('hidden');
  }
}

async function replaceDeployment(file) {
  if (!state.activeDeployment || !file) return;
  if (!file.name.toLowerCase().endsWith('.zip')) return showToast('Choose a ZIP file.', 'error');
  const formData = new FormData();
  formData.append('siteZip', file);
  formData.append('name', elements.renameInput.value.trim() || state.activeDeployment.name);
  try {
    showToast('Replacing website files…');
    const updated = await uploadWithProgress(`/api/deployments/${state.activeDeployment.id}`, 'PUT', formData, () => {});
    await loadDeployments();
    closeInspector();
    showToast('Deployment replaced successfully.');
    setTimeout(() => openInspector(updated.id), 200);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    elements.replaceZipInput.value = '';
  }
}

async function renameDeployment() {
  if (!state.activeDeployment) return;
  const name = elements.renameInput.value.trim();
  if (!name) return showToast('Enter a deployment name.', 'error');
  try {
    const updated = await api(`/api/deployments/${state.activeDeployment.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name })
    });
    state.activeDeployment = updated;
    elements.inspectorTitle.textContent = updated.name;
    await loadDeployments();
    showToast('Deployment renamed.');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function deleteDeployment() {
  if (!state.activeDeployment) return;
  try {
    const deleted = await deleteDeploymentById(state.activeDeployment.id);
    if (deleted) showToast('Deployment deleted.');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function setupEvents() {
  elements.authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    state.password = elements.passwordInput.value;
    elements.authError.textContent = '';
    try {
      await loadDeployments();
      sessionStorage.setItem('sitedockPassword', state.password);
      hideAuth();
    } catch (error) {
      elements.authError.textContent = error.message;
    }
  });

  $$('.nav-item').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
  $('#newDeployButton').addEventListener('click', () => switchView('new'));
  $('#refreshButton').addEventListener('click', () => loadDeployments().then(() => showToast('Deployments refreshed.')).catch((error) => showToast(error.message, 'error')));
  $$('[data-open-uploader]').forEach((button) => button.addEventListener('click', () => switchView('new')));
  elements.searchInput.addEventListener('input', renderDeployments);
  elements.manageSitesButton.addEventListener('click', () => setManageMode(!state.manageMode));
  elements.cancelManageButton.addEventListener('click', () => setManageMode(false));
  elements.selectAllButton.addEventListener('click', () => {
    const visible = filteredDeployments();
    const allVisibleSelected = visible.length > 0 && visible.every((site) => state.selectedDeploymentIds.has(site.id));
    visible.forEach((site) => {
      if (allVisibleSelected) state.selectedDeploymentIds.delete(site.id);
      else state.selectedDeploymentIds.add(site.id);
    });
    renderDeployments();
  });
  elements.deleteSelectedButton.addEventListener('click', () => deleteSelectedDeployments().catch((error) => {
    elements.deleteSelectedButton.textContent = 'Delete selected';
    showToast(error.message, 'error');
  }));
  elements.sitesGrid.addEventListener('click', (event) => {
    const card = event.target.closest('.site-card');
    if (!card) return;
    const actionButton = event.target.closest('[data-action]');
    const id = card.dataset.siteId;

    if (actionButton?.dataset.action === 'delete') {
      event.stopPropagation();
      deleteDeploymentById(id).then((deleted) => {
        if (deleted) showToast('Deployment deleted.');
      }).catch((error) => showToast(error.message, 'error'));
      return;
    }

    if (state.manageMode || actionButton?.dataset.action === 'select') {
      event.stopPropagation();
      toggleDeploymentSelection(id);
      return;
    }

    openInspector(id);
  });
  elements.sitesGrid.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('button')) return;
    const card = event.target.closest('.site-card');
    if (!card) return;
    event.preventDefault();
    if (state.manageMode) toggleDeploymentSelection(card.dataset.siteId);
    else openInspector(card.dataset.siteId);
  });

  elements.zipInput.addEventListener('change', () => selectUpload(elements.zipInput.files[0]));
  elements.clearFileButton.addEventListener('click', () => selectUpload(null));
  elements.uploadForm.addEventListener('submit', deploySelectedFile);
  ['dragenter', 'dragover'].forEach((type) => elements.dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    elements.dropzone.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach((type) => elements.dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    elements.dropzone.classList.remove('dragging');
  }));
  elements.dropzone.addEventListener('drop', (event) => selectUpload(event.dataTransfer.files[0]));

  $$('[data-close-inspector]').forEach((button) => button.addEventListener('click', closeInspector));
  $$('.tab').forEach((button) => button.addEventListener('click', () => switchInspectorTab(button.dataset.inspectorTab)));
  $('#reloadPreview').addEventListener('click', () => {
    if (state.activeDeployment) elements.previewFrame.src = `${state.activeDeployment.url}?preview=${Date.now()}`;
  });
  elements.copyUrlButton.addEventListener('click', async () => {
    if (!state.activeDeployment) return;
    await navigator.clipboard.writeText(state.activeDeployment.url);
    showToast('Live URL copied.');
  });
  elements.copyCodeButton.addEventListener('click', async () => {
    await navigator.clipboard.writeText(state.activeFileContent);
    showToast('Code copied.');
  });
  elements.downloadZipButton.addEventListener('click', async (event) => {
    event.preventDefault();
    if (!state.activeDeployment) return;
    try {
      const response = await fetch(`/api/deployments/${state.activeDeployment.id}/download`, {
        headers: authHeaders()
      });
      if (response.status === 401) {
        showAuth();
        throw new Error('Incorrect dashboard password.');
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Could not download the ZIP.');
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = state.activeDeployment.originalFilename || `${state.activeDeployment.name}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      showToast('ZIP download started.');
    } catch (error) {
      showToast(error.message, 'error');
    }
  });
  elements.renameButton.addEventListener('click', renameDeployment);
  elements.replaceZipButton.addEventListener('click', () => elements.replaceZipInput.click());
  elements.replaceZipInput.addEventListener('change', () => replaceDeployment(elements.replaceZipInput.files[0]));
  elements.deleteButton.addEventListener('click', deleteDeployment);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !elements.inspector.classList.contains('hidden')) closeInspector();
  });
}

async function init() {
  setupEvents();
  try {
    await loadDeployments();
    hideAuth();
  } catch (error) {
    if (error.message.includes('password')) showAuth();
    else showToast(error.message, 'error');
  }
}

init();
