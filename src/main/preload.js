// ============================================================================
// FILE: src/main/preload.js
// ============================================================================
//
// Architectural Intent:
// Secure IPC bridge between the renderer process and the main process.
// Exposes a controlled API via contextBridge — the renderer never gets
// direct access to Node.js, ipcRenderer, or the filesystem.
//
// Key Changes (Session 2):
// - Added onBatchComplete callback for end-of-batch summary signal
// - Added removeAllListeners() to allow renderer to clean up IPC
//   listeners between conversion runs, preventing accumulation
//
// Security Notes:
// - Only string arrays are sent to main (processFiles sanitises input)
// - Callbacks are one-directional (main → renderer) and data-only
// - No functions, objects with methods, or Node.js APIs are exposed
//
// Contract:
//   Exposes window.api with:
//     getFilePath(file)             → string (native path from File object)
//     processFiles(filePaths)       → void (sends to main for processing)
//     onProgress(callback)          → void (register progress listener)
//     onResult(callback)            → void (register result listener)
//     onError(callback)             → void (register error listener)
//     onBatchComplete(callback)     → void (register batch-complete listener)
//     removeAllListeners()          → void (clean up all conversion listeners)
// ============================================================================

'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

/**
 * IPC channels used by the conversion pipeline.
 * Defined once here so removeAllListeners() stays in sync
 * with the individual on* registrations.
 */
const CHANNELS = [
  'conversion:progress',
  'conversion:result',
  'conversion:error',
  'conversion:batch-complete'
];

contextBridge.exposeInMainWorld('api', {

  /**
   * Resolves the native filesystem path from a dropped File object.
   * Required because File.path was deprecated in Electron >= 29.
   * Uses webUtils.getPathForFile() which is the supported replacement.
   *
   * @param {File} file - A File object from a drag-and-drop DataTransfer
   * @returns {string} Absolute native file path
   */
  getFilePath: (file) => webUtils.getPathForFile(file),

  /**
   * Submit one or more HTML file paths for conversion.
   * Paths are validated in the main process before processing.
   *
   * @param {string[]} filePaths - Absolute paths to HTML files
   */
  processFiles: (filePaths) => {
    if (!Array.isArray(filePaths)) return;
    // Only send strings — never objects or functions
    const sanitised = filePaths.filter(p => typeof p === 'string');
    ipcRenderer.send('files:process', sanitised);
  },

  /**
   * Register a callback for progress updates during conversion.
   * @param {function} callback - Receives { current, total, fileName, stage }
   */
  onProgress: (callback) => {
    ipcRenderer.on('conversion:progress', (_event, data) => callback(data));
  },

  /**
   * Register a callback for successful conversion results.
   * @param {function} callback - Receives { fileName, outputPath, slideCount, elementCount, viewport, warnings }
   */
  onResult: (callback) => {
    ipcRenderer.on('conversion:result', (_event, data) => callback(data));
  },

  /**
   * Register a callback for error notifications.
   * @param {function} callback - Receives { message, fileName }
   */
  onError: (callback) => {
    ipcRenderer.on('conversion:error', (_event, data) => callback(data));
  },

  /**
   * Register a callback for batch completion.
   * Fires once after all files in a drop have been processed.
   * @param {function} callback - Receives { total, succeeded, failed, totalWarnings }
   */
  onBatchComplete: (callback) => {
    ipcRenderer.on('conversion:batch-complete', (_event, data) => callback(data));
  },

  /**
   * Removes all listeners for conversion IPC channels.
   * Call this before starting a new conversion run to prevent
   * listener accumulation across multiple drag-and-drop operations
   * within the same session.
   *
   * Why this matters: Each call to on*() adds a new listener.
   * Without cleanup, dropping files 10 times means 10 listeners
   * per channel, each firing on every message. Over a long session
   * this causes duplicate status entries and a slow memory leak.
   */
  removeAllListeners: () => {
    CHANNELS.forEach(channel => ipcRenderer.removeAllListeners(channel));
  },

  // ── Config ──────────────────────────────────────────────────
  getConfig: () => ipcRenderer.invoke('config:get'),
  updateConfig: (overrides) => ipcRenderer.invoke('config:update', overrides),
  resetConfig: () => ipcRenderer.invoke('config:reset'),

  // ── Folder Picker ───────────────────────────────────────────
  selectFolder: () => ipcRenderer.invoke('dialog:select-folder'),

  // ── Version ─────────────────────────────────────────────────
  getVersion: () => ipcRenderer.invoke('app:get-version')
});