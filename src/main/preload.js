'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

/**
 * API exposed to the renderer process via window.api
 *
 * Methods:
 *   getFilePath(file)        — Resolve native file path from a dropped File object
 *   processFiles(filePaths)  — Send HTML file paths to main for conversion
 *   onProgress(callback)     — Register for progress updates
 *   onResult(callback)       — Register for conversion results
 *   onError(callback)        — Register for error notifications
 */
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
   * @param {function} callback - Receives { current, total, fileName }
   */
  onProgress: (callback) => {
    ipcRenderer.on('conversion:progress', (_event, data) => callback(data));
  },

  /**
   * Register a callback for successful conversion results.
   * @param {function} callback - Receives { outputPath, slideCount }
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
  }
});
