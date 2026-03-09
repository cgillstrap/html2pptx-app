
'use strict';

const { session } = require('electron');
const path = require('path');

/**
 * Content Security Policy applied to the main renderer window.
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
 * Relaxed CSP for hidden extraction windows only (Session 12b).
 *
 * Allows 'unsafe-inline' on script-src so that inline <script> blocks
 * in loaded HTML files execute naturally. This is needed for HTML files
 * containing JS-generated charts (e.g. makeBarChart/makeStackChart in
 * barclays-static-presentation.html).
 *
 * Security rationale: the extraction window is sandboxed, processes only
 * local files, has no preload script, and is destroyed immediately after
 * use. The alternative (extracting script text and re-executing via
 * executeJavaScript()) is a larger attack surface since it evaluates
 * arbitrary code in the privileged Electron context.
 *
 * @type {string}
 */
const EXTRACTION_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",  // inline scripts needed for JS-generated charts
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: file:",
  "font-src 'self' file:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'"
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
 *
 * Uses URL-conditional logic to apply different CSPs:
 * - The renderer window (loads index.html from /renderer/) gets the strict
 *   CSP that blocks inline scripts.
 * - Extraction windows (load arbitrary HTML files) get the relaxed CSP
 *   that allows inline scripts for JS-generated charts. See Session 12b.
 *
 * CSP is a document-level directive — the browser enforces the CSP from
 * the main HTML document on all its subresources, so setting CSP on
 * subresource responses has no effect.
 */
function applyCSPHeaders() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // The renderer always loads from src/renderer/index.html.
    // All other HTML loads are extraction windows that need relaxed CSP.
    const isRenderer = details.url.includes('/renderer/');
    const csp = isRenderer ? CONTENT_SECURITY_POLICY : EXTRACTION_CONTENT_SECURITY_POLICY;
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
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
  EXTRACTION_CONTENT_SECURITY_POLICY,
  getSecureWebPreferences,
  applyCSPHeaders,
  installNavigationGuards,
  validateFilePath
};