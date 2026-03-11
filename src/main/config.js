// ============================================================================
// FILE: src/main/config.js
// ============================================================================
//
// Architectural Intent:
// Centralises all user-configurable application settings. Currently provides
// sensible defaults with an in-memory override mechanism. Designed to be
// extended later with:
//   - A settings UI panel in the renderer
//   - Persistence to a JSON file in the user's app data directory
//   - Per-project overrides via a config file alongside the HTML
//
// All modules that need configuration import this module and call
// getConfig() — they never hold their own defaults.
//
// Key Decisions:
// - Defaults are defined once, here, and documented
// - getConfig() returns a frozen shallow copy so callers can't mutate
// - updateConfig() validates keys against the known schema
// - Config persists to a JSON file in the user's app data directory
// - initConfig() must be called once from main.js after app.whenReady()
// - Schema versioning: saved config merges with DEFAULTS (forward-compatible)
// ============================================================================

'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_FILENAME = 'config.json';
const CONFIG_VERSION = 1;

/** Path to the persisted config file — set by initConfig() */
let configFilePath = null;

/**
 * Default configuration values with documentation.
 * Each key corresponds to a user-facing setting.
 */
const DEFAULTS = {
  /**
   * Where to save the generated .pptx file.
   * Options:
   *   'same-directory'  — Same folder as the source HTML file
   *   'save-dialog'     — Prompt user with Save As dialog each time
   *   'fixed-folder'    — Always save to outputFixedPath
   */
  outputStrategy: 'same-directory',

  /**
   * Fixed output folder path (only used when outputStrategy is 'fixed-folder').
   * @type {string|null}
   */
  outputFixedPath: null,

  /**
   * How to handle <div> elements that contain direct text content
   * but no semantic text tags (<p>, <h1>-<h6>).
   * Options:
   *   'fallback'  — Render as text (graceful degradation for messy AI output)
   *   'strict'    — Skip and warn (original html2pptx-local.cjs behaviour)
   */
  divTextHandling: 'fallback',

  /**
   * How to render elements with class="placeholder".
   * In the original pipeline, placeholders are invisible — they're positions
   * returned to the caller for chart/table insertion. In our standalone app
   * there's no chart insertion step.
   * Options:
   *   'visible'   — Render as a visible grey shape so users see the layout intent
   *   'hidden'    — Skip rendering (original behaviour)
   */
  placeholderRendering: 'visible',

  /**
   * Default placeholder fill colour (when placeholderRendering is 'visible').
   * 6-char hex without '#' prefix (pptxgenjs format).
   */
  placeholderFillColor: 'D9D9D9',

  /**
   * Placeholder fill transparency (0 = opaque, 100 = fully transparent).
   */
  placeholderFillTransparency: 50,

  /**
   * Default slide width in pixels. Used when the extractor cannot
   * determine dimensions from the HTML. Null = always infer from HTML.
   * @type {number|null}
   */
  defaultSlideWidth: null,

  /**
   * Default slide height in pixels. Null = always infer from HTML.
   * @type {number|null}
   */
  defaultSlideHeight: null,

  /**
   * Whether to display extraction/generation warnings in the UI status panel.
   * When false, warnings are still logged to console but not shown to the user.
   */
  showWarnings: true,

  /**
   * Remember the last folder used in a save dialog or folder picker.
   * When true, the next save dialog opens at lastUsedFolder.
   * @type {boolean}
   */
  rememberLastFolder: true,

  /**
   * Last folder path used (auto-populated, not directly user-editable).
   * @type {string|null}
   */
  lastUsedFolder: null
};

/** Current runtime configuration (starts as copy of defaults) */
let currentConfig = { ...DEFAULTS };

/**
 * Initialises the config module with the persistence directory.
 * Must be called once from main.js after app.whenReady().
 *
 * Reads existing config from disk if present. Missing fields are
 * filled from DEFAULTS (forward-compatible schema migration).
 * Corrupt or unreadable files fall back to full defaults.
 *
 * @param {string} userDataPath - Result of app.getPath('userData')
 */
function initConfig(userDataPath) {
  configFilePath = path.join(userDataPath, CONFIG_FILENAME);

  try {
    if (fs.existsSync(configFilePath)) {
      const raw = fs.readFileSync(configFilePath, 'utf-8');
      const saved = JSON.parse(raw);

      // Merge: saved values override defaults; new default keys are added
      currentConfig = { ...DEFAULTS, ...saved };

      // Strip any keys that no longer exist in DEFAULTS
      for (const key of Object.keys(currentConfig)) {
        if (!(key in DEFAULTS) && key !== '_version') {
          delete currentConfig[key];
        }
      }

      console.log(`[Config] Loaded from ${configFilePath}`);
    } else {
      console.log('[Config] No saved config found — using defaults');
    }
  } catch (err) {
    console.warn(`[Config] Failed to load saved config — using defaults. ${err.message}`);
    currentConfig = { ...DEFAULTS };
  }
}

/**
 * Persists the current config to disk.
 * Called automatically by updateConfig(). Fire-and-forget —
 * a write failure is logged but does not throw.
 */
function saveConfig() {
  if (!configFilePath) return;

  try {
    const data = { _version: CONFIG_VERSION, ...currentConfig };
    fs.writeFileSync(configFilePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[Config] Failed to save config: ${err.message}`);
  }
}

/**
 * Returns the current configuration as a frozen object.
 * Callers cannot mutate the returned object.
 *
 * @returns {Readonly<typeof DEFAULTS>}
 */
function getConfig() {
  return Object.freeze({ ...currentConfig });
}

/**
 * Updates one or more configuration values.
 * Only keys that exist in DEFAULTS are accepted — unknown keys are ignored
 * and logged as warnings. Persists to disk after applying.
 *
 * @param {object} overrides - Key-value pairs to update
 * @returns {Readonly<typeof DEFAULTS>} The updated configuration
 */
function updateConfig(overrides) {
  if (!overrides || typeof overrides !== 'object') return getConfig();

  for (const [key, value] of Object.entries(overrides)) {
    if (key in DEFAULTS) {
      currentConfig[key] = value;
    } else {
      console.warn(`[Config] Unknown configuration key ignored: "${key}"`);
    }
  }

  saveConfig();
  return getConfig();
}

/**
 * Resets all configuration to defaults and persists.
 * Used by the "Reset to Defaults" UI action.
 *
 * @returns {Readonly<typeof DEFAULTS>}
 */
function resetConfig() {
  currentConfig = { ...DEFAULTS };
  saveConfig();
  return getConfig();
}

module.exports = { getConfig, updateConfig, resetConfig, initConfig };