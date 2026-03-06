'use strict';

(function initRenderer() {
  const dropZone = document.getElementById('dropZone');
  const statusPanel = document.getElementById('statusPanel');

  // ── Drag and Drop ──────────────────────────────────────────────

  /**
   * Prevent default drag behaviours on the entire document
   * so the browser doesn't try to open dropped files.
   */
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
    document.addEventListener(evt, e => {
      e.preventDefault();
      e.stopPropagation();
    });
  });

  dropZone.addEventListener('dragenter', () => dropZone.classList.add('dragover'));
  dropZone.addEventListener('dragover',  () => dropZone.classList.add('dragover'));
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));

  dropZone.addEventListener('drop', (e) => {
    dropZone.classList.remove('dragover');

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    // Extract file paths via the secure preload bridge
    // (File.path is deprecated in modern Electron; webUtils.getPathForFile is the replacement)
    const paths = files
      .map(f => window.api.getFilePath(f))
      .filter(p => p && (p.endsWith('.html') || p.endsWith('.htm')));

    if (paths.length === 0) {
      addStatusEntry(null, 'error', 'No valid HTML files found in drop. Please use .html or .htm files.');
      return;
    }

    // Clear previous results
    statusPanel.innerHTML = '';
    addStatusEntry(null, 'info', `Processing ${paths.length} file(s)...`);

    // Send to main process for extraction
    window.api.processFiles(paths);
  });

  // ── IPC Callbacks ──────────────────────────────────────────────

  window.api.onProgress((data) => {
    addStatusEntry(
      data.fileName,
      'info',
      `[${data.current}/${data.total}] ${data.stage}...`
    );
  });

  window.api.onResult((data) => {
    addStatusEntry(
      data.fileName,
      'success',
      `Converted ${data.elementCount} elements → ${data.slideCount} slide(s)`
    );

    // Show output location
    if (data.outputPath) {
      addStatusEntry(null, 'info', `Saved to: ${data.outputPath}`);
    }
  });

  window.api.onError((data) => {
    addStatusEntry(data.fileName, 'error', data.message);
  });

  // ── UI Helpers ─────────────────────────────────────────────────

  /**
   * Adds a status entry to the results panel.
   *
   * @param {string|null} fileName - Source file name, or null for general messages
   * @param {'info'|'success'|'error'} type - Entry severity
   * @param {string} message - Display text
   * @returns {HTMLElement} The created entry element (for appending child content)
   */
  function addStatusEntry(fileName, type, message) {
    statusPanel.classList.add('visible');

    const entry = document.createElement('div');
    entry.className = 'status-entry';

    let html = '';
    if (fileName) {
      html += `<span class="file-name">${escapeHtml(fileName)}</span> `;
    }
    html += `<span class="${type}">${escapeHtml(message)}</span>`;
    entry.innerHTML = html;

    statusPanel.appendChild(entry);
    statusPanel.scrollTop = statusPanel.scrollHeight;

    return entry;
  }

  /**
   * Basic HTML escaping to prevent injection in status messages.
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();