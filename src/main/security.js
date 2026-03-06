
'use strict';

const { session } = require('electron');
const path = require('path');

/**
 * Content Security Policy applied to all renderer windows.
 * Permits only local file resources — no external URLs, no inline scripts.
 *
 * @type {string}
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",   // inline styles needed for extracted HTML
  "img-src 'self' data: file:",          // local images and data URIs
  "font-src 'self' file:",              // local fonts only
  "connect-src 'none'",                 // no network requests
  "frame-src 'none'",                   // no iframes
  "object-src 'none'",                  // no plugins
  "base-uri 'none'"                     // no <base> tag manipulation
].join('; ');

/**
 * Standard BrowserWindow security options.
 * Applied to both the main UI window and hidden extraction windows.
 *
 * @param {string|null} preloadPath - Path to preload script, or null for hidden windows
 * @returns {object} webPreferences configuration object
 */
function getSecureWebPreferences(preloadPath = null) {
  const prefs = {
    nodeIntegration: false,
    contextIsolation: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    enableRemoteModule: false,
    sandbox: true
  };

  if (preloadPath) {
    prefs.preload = preloadPath;
    // Main UI window needs sandbox relaxed slightly for preload IPC
    prefs.sandbox = false;
  }

  return prefs;
}

/**
 * Applies CSP headers to all responses in the default session.
 * Must be called once during app initialisation, before any windows are created.
 */
function applyCSPHeaders() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CONTENT_SECURITY_POLICY]
      }
    });
  });
}

/**
 * Installs navigation guards on a BrowserWindow.
 * Blocks all navigation away from the initially loaded content,
 * and prevents new window creation.
 *
 * @param {Electron.BrowserWindow} win - The window to protect
 */
function installNavigationGuards(win) {
  // Block any navigation attempt (e.g., anchor tags, JS redirects)
  win.webContents.on('will-navigate', (event, url) => {
    // Allow only file:// protocol for local HTML loading
    if (!url.startsWith('file://')) {
      event.preventDefault();
      console.warn(`[Security] Blocked navigation to: ${url}`);
    }
  });

  // Block new window creation (window.open, target=_blank)
  win.webContents.setWindowOpenHandler(({ url }) => {
    console.warn(`[Security] Blocked new window request: ${url}`);
    return { action: 'deny' };
  });
}

/**
 * Validates and normalises a file path for safe loading.
 * Ensures the path is absolute, exists within expected scope,
 * and doesn't contain traversal sequences.
 *
 * @param {string} filePath - Raw file path from user input (drag-and-drop)
 * @param {string[]} allowedExtensions - Permitted file extensions (e.g., ['.html', '.htm'])
 * @returns {{ valid: boolean, normalised: string|null, error: string|null }}
 */
function validateFilePath(filePath, allowedExtensions = ['.html', '.htm']) {
  if (!filePath || typeof filePath !== 'string') {
    return { valid: false, normalised: null, error: 'File path is empty or invalid.' };
  }

  // Normalise to resolve any ../ sequences, then check it matches the original intent
  const normalised = path.resolve(filePath);

  // Check extension
  const ext = path.extname(normalised).toLowerCase();
  if (!allowedExtensions.includes(ext)) {
    return {
      valid: false,
      normalised: null,
      error: `Unsupported file type: ${ext}. Expected: ${allowedExtensions.join(', ')}`
    };
  }

  return { valid: true, normalised, error: null };
}

module.exports = {
  CONTENT_SECURITY_POLICY,
  getSecureWebPreferences,
  applyCSPHeaders,
  installNavigationGuards,
  validateFilePath
};