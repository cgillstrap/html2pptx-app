// ============================================================================
// FILE: src/renderer/renderer.js
// ============================================================================
//
// Architectural Intent:
// UI logic for the drag-and-drop renderer process. Handles file drops,
// registers IPC callbacks for conversion progress/results/errors, and
// manages the status panel display.
//
// Key Changes (Session 2):
// - Warnings from extraction/generation are displayed in amber
// - Batch completion triggers a summary bar
// - IPC listeners are cleaned up and re-registered on each new drop
//   to prevent accumulation across multiple conversion runs
// - Drop zone shows processing state during conversion
// - Batch summary element is created dynamically and colour-coded
//   based on outcome (all success / has warnings / has errors)
//
// Security Notes:
// - All displayed strings are HTML-escaped via escapeHtml()
// - No direct filesystem or Node.js access — everything goes through
//   the window.api bridge defined in preload.js
// ============================================================================

'use strict';

(function initRenderer() {
  const dropZone = document.getElementById('dropZone');
  const statusPanel = document.getElementById('statusPanel');
  let isProcessing = false;

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

  dropZone.addEventListener('dragenter', () => {
    if (!isProcessing) dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragover', () => {
    if (!isProcessing) dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    dropZone.classList.remove('dragover');

    // Ignore drops while a conversion is in progress
    if (isProcessing) return;

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    // Extract file paths via the secure preload bridge
    const paths = files
      .map(f => window.api.getFilePath(f))
      .filter(p => p && (p.endsWith('.html') || p.endsWith('.htm')));

    if (paths.length === 0) {
      addStatusEntry(null, 'error', 'No valid HTML files found in drop. Please use .html or .htm files.');
      return;
    }

    // Begin processing
    startBatch(paths);
  });

  // ── Batch Lifecycle ────────────────────────────────────────────

  /**
   * Starts a new conversion batch. Cleans up previous listeners,
   * resets the UI, registers fresh callbacks, and sends file paths
   * to the main process.
   *
   * The listener cleanup + re-register pattern ensures that each
   * batch has exactly one listener per channel, regardless of how
   * many times the user has dropped files during this session.
   *
   * @param {string[]} paths - Validated HTML file paths
   */
  function startBatch(paths) {
    isProcessing = true;
    dropZone.classList.add('processing');

    // Clear previous status and any batch summary
    statusPanel.innerHTML = '';
    removeBatchSummary();

    // Clean up any previous listeners, then register fresh ones
    window.api.removeAllListeners();
    registerListeners();

    addStatusEntry(null, 'info', 'Processing ' + paths.length + ' file(s)...');
    window.api.processFiles(paths);
  }

  /**
   * Registers IPC listeners for the current batch.
   * Called once per batch after removeAllListeners() clears the slate.
   */
  function registerListeners() {
    window.api.onProgress((data) => {
      addStatusEntry(
        data.fileName,
        'info',
        '[' + data.current + '/' + data.total + '] ' + data.stage
      );
    });

    window.api.onResult((data) => {
      addStatusEntry(
        data.fileName,
        'success',
        'Converted ' + data.elementCount + ' elements → ' + data.slideCount + ' slide(s)'
      );

      if (data.outputPath) {
        addStatusEntry(null, 'info', 'Saved to: ' + data.outputPath);
      }

      // Display any warnings from extraction/generation
      if (data.warnings && data.warnings.length > 0) {
        data.warnings.forEach(w => {
          addStatusEntry(data.fileName, 'warning', w);
        });
      }
    });

    window.api.onError((data) => {
      addStatusEntry(data.fileName, 'error', data.message);
    });

    window.api.onBatchComplete((data) => {
      showBatchSummary(data);
      isProcessing = false;
      dropZone.classList.remove('processing');
    });
  }

  // ── UI Helpers ─────────────────────────────────────────────────

  /**
   * Adds a status entry to the results panel.
   *
   * @param {string|null} fileName - Source file name, or null for general messages
   * @param {'info'|'success'|'error'|'warning'} type - Entry severity
   * @param {string} message - Display text
   * @returns {HTMLElement} The created entry element
   */
  function addStatusEntry(fileName, type, message) {
    statusPanel.classList.add('visible');

    const entry = document.createElement('div');
    entry.className = 'status-entry';

    let html = '';
    if (fileName) {
      html += '<span class="file-name">' + escapeHtml(fileName) + '</span> ';
    }
    html += '<span class="' + type + '">' + escapeHtml(message) + '</span>';
    entry.innerHTML = html;

    statusPanel.appendChild(entry);
    statusPanel.scrollTop = statusPanel.scrollHeight;

    return entry;
  }

  /**
   * Displays a colour-coded batch summary bar below the status panel.
   * Created dynamically rather than being a static HTML element so it
   * only appears after a batch completes.
   *
   * Colour logic:
   *   - All succeeded, no warnings → green (all-success)
   *   - All succeeded but has warnings → amber (has-warnings)
   *   - Any failures → red (has-errors)
   *
   * @param {{ total: number, succeeded: number, failed: number, totalWarnings: number }} data
   */
  function showBatchSummary(data) {
    removeBatchSummary();

    const summary = document.createElement('div');
    summary.className = 'batch-summary';
    summary.id = 'batchSummary';

    // Build summary text
    const parts = [];
    parts.push(data.total + ' file(s) processed');
    if (data.succeeded > 0) parts.push(data.succeeded + ' succeeded');
    if (data.failed > 0) parts.push(data.failed + ' failed');
    if (data.totalWarnings > 0) parts.push(data.totalWarnings + ' warning(s)');
    summary.textContent = parts.join('  ·  ');

    // Colour-code based on outcome
    if (data.failed > 0) {
      summary.classList.add('has-errors');
    } else if (data.totalWarnings > 0) {
      summary.classList.add('has-warnings');
    } else {
      summary.classList.add('all-success');
    }

    // Insert after status panel
    statusPanel.parentNode.insertBefore(summary, statusPanel.nextSibling);
  }

  /**
   * Removes any existing batch summary element.
   * Called at the start of a new batch and before showing a new summary.
   */
  function removeBatchSummary() {
    const existing = document.getElementById('batchSummary');
    if (existing) existing.remove();
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