// ============================================================================
// FILE: src/main/main.js
// ============================================================================
//
// Architectural Intent:
// Electron entry point and orchestrator. Routes IPC messages between the
// renderer (drag-and-drop UI) and the conversion pipeline (extractor →
// generator). Contains NO conversion logic — only lifecycle management,
// file validation, and progress/result/error routing.
//
// Key Changes (Session 2):
// - Forward generator warnings to renderer via conversion:result payload
// - Add conversion:batch-complete signal with summary counts
// - Track per-batch success/fail/warning counts for summary
// - Forward detectionMethod in conversion:result for diagnostics
//
// Contract:
//   IPC In:   files:process (string[] of file paths from renderer)
//   IPC Out:  conversion:progress, conversion:result, conversion:error,
//             conversion:batch-complete
// ============================================================================

'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const {
  applyCSPHeaders,
  getSecureWebPreferences,
  installNavigationGuards,
  validateFilePath
} = require('./security');
const { getConfig, updateConfig, resetConfig, initConfig } = require('./config');
const { extractFromHTML } = require('../extraction/extractor');
const { generatePPTX } = require('../generation/generator');

/** @type {BrowserWindow|null} */
let mainWindow = null;

/**
 * Determines the output .pptx path based on the configured output strategy.
 *
 * @param {string} htmlPath - Absolute path to the source HTML file
 * @param {BrowserWindow} parentWindow - For dialog attachment
 * @returns {Promise<string|null>} Output path, or null if user cancelled
 */
async function resolveOutputPath(htmlPath, parentWindow) {
  const config = getConfig();
  const base = path.basename(htmlPath, path.extname(htmlPath));
  const defaultName = `${base}.pptx`;

  switch (config.outputStrategy) {
    case 'save-dialog': {
      const initialDir = (config.rememberLastFolder && config.lastUsedFolder)
        ? config.lastUsedFolder
        : path.dirname(htmlPath);
      const result = await dialog.showSaveDialog(parentWindow, {
        title: 'Save PowerPoint file',
        defaultPath: path.join(initialDir, defaultName),
        filters: [{ name: 'PowerPoint', extensions: ['pptx'] }]
      });
      if (result.canceled || !result.filePath) return null;
      if (config.rememberLastFolder) {
        updateConfig({ lastUsedFolder: path.dirname(result.filePath) });
      }
      return result.filePath;
    }

    case 'fixed-folder': {
      if (!config.outputFixedPath) {
        throw new Error('Fixed output folder not configured. Please set a folder in Settings.');
      }
      return path.join(config.outputFixedPath, defaultName);
    }

    case 'same-directory':
    default:
      return path.join(path.dirname(htmlPath), defaultName);
  }
}

/**
 * Creates the main application window with the drag-and-drop UI.
 */
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 520,
    resizable: true,
    title: 'HTML → PPTX Converter',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    webPreferences: getSecureWebPreferences(
      path.join(__dirname, 'preload.js')
    )
  });

  installNavigationGuards(mainWindow);

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Handles the files:process IPC message from the renderer.
 * Validates file paths, runs extraction, generates PPTX, and returns
 * results including any warnings from the conversion pipeline.
 *
 * Sends a batch-complete signal after all files are processed so the
 * renderer knows when to show a summary and reset its UI state.
 *
 * @param {Electron.IpcMainEvent} event
 * @param {string[]} filePaths - Raw file paths from drag-and-drop
 */
async function handleFileProcessing(event, filePaths) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    event.reply('conversion:error', {
      message: 'No files received.',
      fileName: null
    });
    event.reply('conversion:batch-complete', {
      total: 0, succeeded: 0, failed: 0, totalWarnings: 0
    });
    return;
  }

  const total = filePaths.length;
  let succeeded = 0;
  let failed = 0;
  let totalWarnings = 0;

  for (let i = 0; i < total; i++) {
    const raw = filePaths[i];
    const { valid, normalised, error } = validateFilePath(raw);

    if (!valid) {
      failed++;
      event.reply('conversion:error', {
        message: error,
        fileName: path.basename(raw || 'unknown')
      });
      continue;
    }

    const fileName = path.basename(normalised);
    const htmlDir = path.dirname(normalised);

    // ── Stage 1: Extraction ────────────────────────────────────
    event.reply('conversion:progress', {
      current: i + 1,
      total,
      fileName,
      stage: 'Extracting styles from HTML...'
    });

    let extractionResult;
    try {
      extractionResult = await extractFromHTML(normalised);
      const totalElements = extractionResult.slides.reduce(
        (sum, s) => sum + s.elements.length, 0
      );
      console.log(
        `[Extract] ${fileName}: ${extractionResult.slideCount} slide(s), ` +
        `${totalElements} total elements`
      );
    } catch (err) {
      console.error(`[Extract Error] ${fileName}:`, err.message);
      failed++;
      event.reply('conversion:error', {
        message: `Extraction failed: ${err.message}`,
        fileName
      });
      continue;
    }

    // ── Stage 2: Resolve output path ─────────────────────────────
    let outputPath;
    try {
      outputPath = await resolveOutputPath(normalised, mainWindow);
      if (outputPath === null) {
        // User cancelled the save dialog — skip this file
        event.reply('conversion:result', {
          fileName,
          outputPath: null,
          slideCount: 0,
          elementCount: 0,
          viewport: null,
          warnings: ['Save cancelled by user — file skipped.']
        });
        succeeded++; // Not a failure — user chose to skip
        continue;
      }
    } catch (err) {
      failed++;
      event.reply('conversion:error', {
        message: err.message,
        fileName
      });
      continue;
    }

    // ── Stage 3: Generation ────────────────────────────────────
    event.reply('conversion:progress', {
      current: i + 1,
      total,
      fileName,
      stage: `Generating ${extractionResult.slideCount} slide(s)...`
    });

    try {
      const result = await generatePPTX(extractionResult, outputPath, { htmlDir });
      console.log(`[Generate] ${fileName} → ${result.outputPath}`);

      const totalElements = extractionResult.slides.reduce(
        (sum, s) => sum + s.elements.length, 0
      );

      // Always count warnings for batch summary; only forward to UI if showWarnings is on
      const config = getConfig();
      const allWarnings = result.warnings || [];
      totalWarnings += allWarnings.length;
      const fileWarnings = config.showWarnings ? allWarnings : [];

      succeeded++;
      event.reply('conversion:result', {
        fileName,
        outputPath: result.outputPath,
        slideCount: result.slideCount,
        elementCount: totalElements,
        viewport: extractionResult.slides[0].viewport,
        warnings: fileWarnings
      });

    } catch (err) {
      console.error(`[Generate Error] ${fileName}:`, err.message);
      failed++;
      event.reply('conversion:error', {
        message: `Generation failed: ${err.message}`,
        fileName
      });
    }
  }

  // ── Batch Complete ─────────────────────────────────────────
  // Signals the renderer that all files have been processed.
  // Enables summary display and UI state reset.
  event.reply('conversion:batch-complete', {
    total, succeeded, failed, totalWarnings
  });
}

// --- Application Lifecycle ---

app.whenReady().then(() => {
  initConfig(app.getPath('userData'));
  applyCSPHeaders();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// --- IPC Registration ---

ipcMain.on('files:process', handleFileProcessing);

// ── Config IPC ──────────────────────────────────────────────
ipcMain.handle('config:get', () => {
  return getConfig();
});

ipcMain.handle('config:update', (_event, overrides) => {
  return updateConfig(overrides);
});

ipcMain.handle('config:reset', () => {
  return resetConfig();
});

// ── Folder Picker IPC ───────────────────────────────────────
ipcMain.handle('dialog:select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select output folder',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// ── Version IPC ─────────────────────────────────────────────
ipcMain.handle('app:get-version', () => {
  return app.getVersion();
});