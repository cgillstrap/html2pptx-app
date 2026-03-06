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
// - Config is not persisted yet — resets on app restart (Phase 3 will add persistence)
// ============================================================================

'use strict';

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
  placeholderFillTransparency: 50
};

/** Current runtime configuration (starts as copy of defaults) */
let currentConfig = { ...DEFAULTS };

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
 * and logged as warnings.
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

  return getConfig();
}

/**
 * Resets all configuration to defaults.
 * Useful for testing or a "Reset to Defaults" UI action.
 *
 * @returns {Readonly<typeof DEFAULTS>}
 */
function resetConfig() {
  currentConfig = { ...DEFAULTS };
  return getConfig();
}

module.exports = { getConfig, updateConfig, resetConfig };