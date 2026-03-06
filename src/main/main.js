'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const {
  applyCSPHeaders,
  getSecureWebPreferences,
  installNavigationGuards,
  validateFilePath
} = require('./security');
const { extractFromHTML } = require('../extraction/extractor');
const { generatePPTX } = require('../generation/generator');

/** @type {BrowserWindow|null} */
let mainWindow = null;

/**
 * Computes the output .pptx path from the source HTML path.
 *
 * Current strategy: same directory, same base name, .pptx extension.
 * This is the first of several planned strategies — keeping it as a
 * function makes it easy to swap in Save As dialog or fixed output
 * folder later.
 *
 * @param {string} htmlPath - Absolute path to the source HTML file
 * @returns {string} Absolute path for the output .pptx
 */
function computeOutputPath(htmlPath) {
  const dir = path.dirname(htmlPath);
  const base = path.basename(htmlPath, path.extname(htmlPath));
  return path.join(dir, `${base}.pptx`);
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
 * Validates file paths, runs extraction, generates PPTX, and returns results.
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
    return;
  }

  const total = filePaths.length;

  for (let i = 0; i < total; i++) {
    const raw = filePaths[i];
    const { valid, normalised, error } = validateFilePath(raw);

    if (!valid) {
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
      event.reply('conversion:error', {
        message: `Extraction failed: ${err.message}`,
        fileName
      });
      continue;
    }

    // ── Stage 2: Generation ────────────────────────────────────
    event.reply('conversion:progress', {
      current: i + 1,
      total,
      fileName,
      stage: `Generating ${extractionResult.slideCount} slide(s)...`
    });

    const outputPath = computeOutputPath(normalised);

    try {
      const result = await generatePPTX(extractionResult, outputPath, { htmlDir });
      console.log(`[Generate] ${fileName} → ${result.outputPath}`);

      const totalElements = extractionResult.slides.reduce(
        (sum, s) => sum + s.elements.length, 0
      );

      event.reply('conversion:result', {
        fileName,
        outputPath: result.outputPath,
        slideCount: result.slideCount,
        elementCount: totalElements,
        viewport: extractionResult.slides[0].viewport
      });

    } catch (err) {
      console.error(`[Generate Error] ${fileName}:`, err.message);
      event.reply('conversion:error', {
        message: `Generation failed: ${err.message}`,
        fileName
      });
    }
  }
}

// --- Application Lifecycle ---

app.whenReady().then(() => {
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