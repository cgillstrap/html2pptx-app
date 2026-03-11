// ============================================================================
// FILE: src/extraction/extractor.js
// ============================================================================
//
// Architectural Intent:
// Replaces Playwright in the claude-office-skills pipeline by using a hidden
// Electron BrowserWindow. The extraction script running inside the browser
// is ported directly from html2pptx-local.cjs extractSlideData(), preserving
// all the battle-tested formatting, inline text run, rotation, shadow, and
// border handling from the original.
//
// Our additions on top of the original:
// - Multi-slide detection (data-slide-number → class-slide → section children
//   → uniform divs → body fallback)
// - Div-text fallback for AI-generated HTML that puts text in bare divs
// - Gradient detection: slide backgrounds marked for rasterisation,
//   element-level gradients surfaced as warnings
// - Interactive element filtering
// - Font validation warnings
// - High-transparency warnings
// - Shape text capture with gradient-aware colour fallback
// - Standalone span/inline element extraction
// - CSS shape trick detection (border-based visual shapes)
//
// Key Changes (Session 4):
// - Interactive/navigation element filtering
// - Font validation warnings
// - High-transparency warnings
// - Shape text capture: divs with backgrounds that also contain text
//   preserve the text content. Gradient backgrounds extract the first
//   colour stop as a solid fallback (not backgroundColor, which is
//   transparent when only a gradient is set).
// - Standalone span handling for badge/pill/tag patterns, also with
//   gradient-aware colour extraction.
// - CSS trick detection: uses content-area calculation (bounding rect
//   minus border widths) rather than computed.width, which is unreliable
//   with box-sizing: border-box.
//
// Key Changes (Session 7d):
// - captureGradients() completely redesigned: clone-based capture at origin.
//   Creates a temporary empty div with the gradient background, hides all
//   containers with display:none !important, positions the clone at (0,0),
//   and captures there. Solves two issues: (1) in-place content hiding
//   fought CSS specificity, and (2) capturePage() served stale compositor
//   frames for regions far down the page (y:8000+). Capturing at the
//   viewport origin guarantees a fresh frame.
//
// Key Changes (Session 3):
// - Overflow detection: container-level and element-level
// - Gradient capture fix for stacked/overlapping slide layouts
//
// Key Changes (Session 2):
// - Gradient background detection and capturePage() rasterisation
// - Element-level gradient detection with warning fallback
//
// Contract:
//   Input:  Absolute path to an HTML file
//   Output: { slideCount, detectionMethod, slides: [{ ... }] }
//   Throws: If file cannot be loaded or script fails catastrophically
// ============================================================================

'use strict';

const { BrowserWindow } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { getSecureWebPreferences, installNavigationGuards } = require('../main/security');

/**
 * The extraction script ported from html2pptx-local.cjs extractSlideData().
 * Runs inside the hidden BrowserWindow's Chromium renderer via executeJavaScript().
 * NO Node.js access — only standard Web APIs.
 *
 * Wrapped in our multi-slide detection layer.
 */
const EXTRACTION_SCRIPT = `
(function extractAllSlides() {
  'use strict';

  const PT_PER_PX = 0.75;
  const PX_PER_IN = 96;

  // ── Shared helpers (ported from html2pptx-local.cjs) ───────────

  const SINGLE_WEIGHT_FONTS = ['impact'];

  const shouldSkipBold = (fontFamily) => {
    if (!fontFamily) return false;
    const normalized = fontFamily.toLowerCase().replace(/['"]/g, '').split(',')[0].trim();
    return SINGLE_WEIGHT_FONTS.includes(normalized);
  };

  const pxToInch = (px) => px / PX_PER_IN;
  const pxToPoints = (pxStr) => parseFloat(pxStr) * PT_PER_PX;

  const rgbToHex = (rgbStr) => {
    if (rgbStr === 'rgba(0, 0, 0, 0)' || rgbStr === 'transparent') return 'FFFFFF';
    const match = rgbStr.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
    if (!match) return 'FFFFFF';
    return match.slice(1).map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
  };

  const extractAlpha = (rgbStr) => {
    const match = rgbStr.match(/rgba\\((\\d+),\\s*(\\d+),\\s*(\\d+),\\s*([\\d.]+)\\)/);
    if (!match || !match[4]) return null;
    return Math.round((1 - parseFloat(match[4])) * 100);
  };

  // ── Gradient colour extraction (Session 4) ─────────────────────
  // Extracts the first colour stop from a CSS gradient string as a
  // solid fallback. When an element's only background is a gradient,
  // backgroundColor is 'transparent' — useless as a fill. This
  // function parses the gradient to get a reasonable solid colour.
  //
  // Handles: #hex, #shortHex, rgb(), rgba() colour formats in
  // linear-gradient, radial-gradient, and conic-gradient strings.
  var extractGradientFallbackColor = function(bgImage) {
    // Try hex colour first (#RGB, #RRGGBB, #RRGGBBAA)
    var hexMatch = bgImage.match(/#([0-9a-fA-F]{3,8})/);
    if (hexMatch) {
      var hex = hexMatch[1];
      // Expand shorthand #RGB → #RRGGBB
      if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      }
      return hex.substring(0, 6).toUpperCase();
    }
    // Try rgb/rgba
    var rgbMatch = bgImage.match(/rgba?\\([^)]+\\)/);
    if (rgbMatch) return rgbToHex(rgbMatch[0]);
    return null;
  };

  const applyTextTransform = (text, textTransform) => {
    if (textTransform === 'uppercase') return text.toUpperCase();
    if (textTransform === 'lowercase') return text.toLowerCase();
    if (textTransform === 'capitalize') return text.replace(/\\b\\w/g, c => c.toUpperCase());
    return text;
  };

  const getRotation = (transform, writingMode) => {
    let angle = 0;
    if (writingMode === 'vertical-rl') angle = 90;
    else if (writingMode === 'vertical-lr') angle = 270;

    if (transform && transform !== 'none') {
      const rotateMatch = transform.match(/rotate\\((-?\\d+(?:\\.\\d+)?)deg\\)/);
      if (rotateMatch) {
        angle += parseFloat(rotateMatch[1]);
      } else {
        const matrixMatch = transform.match(/matrix\\(([^)]+)\\)/);
        if (matrixMatch) {
          const values = matrixMatch[1].split(',').map(parseFloat);
          angle += Math.round(Math.atan2(values[1], values[0]) * (180 / Math.PI));
        }
      }
    }
    angle = angle % 360;
    if (angle < 0) angle += 360;
    return angle === 0 ? null : angle;
  };

  const getPositionAndSize = (el, rect, rotation) => {
    if (rotation === null) {
      return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
    }
    const isVertical = rotation === 90 || rotation === 270;
    if (isVertical) {
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      return { x: cx - rect.height / 2, y: cy - rect.width / 2, w: rect.height, h: rect.width };
    }
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return { x: cx - el.offsetWidth / 2, y: cy - el.offsetHeight / 2, w: el.offsetWidth, h: el.offsetHeight };
  };

  const parseBoxShadow = (boxShadow) => {
    if (!boxShadow || boxShadow === 'none') return null;
    if (boxShadow.match(/inset/)) return null;
    const colorMatch = boxShadow.match(/rgba?\\([^)]+\\)/);
    const parts = boxShadow.match(/([-\\d.]+)(px|pt)/g);
    if (!parts || parts.length < 2) return null;
    const offsetX = parseFloat(parts[0]);
    const offsetY = parseFloat(parts[1]);
    const blur = parts.length > 2 ? parseFloat(parts[2]) : 0;
    let angle = 0;
    if (offsetX !== 0 || offsetY !== 0) {
      angle = Math.atan2(offsetY, offsetX) * (180 / Math.PI);
      if (angle < 0) angle += 360;
    }
    const offset = Math.sqrt(offsetX * offsetX + offsetY * offsetY) * PT_PER_PX;
    let opacity = 0.5;
    if (colorMatch) {
      const opacityMatch = colorMatch[0].match(/[\\d.]+\\)$/);
      if (opacityMatch) opacity = parseFloat(opacityMatch[0].replace(')', ''));
    }
    return {
      type: 'outer', angle: Math.round(angle), blur: blur * 0.75,
      color: colorMatch ? rgbToHex(colorMatch[0]) : '000000', offset, opacity
    };
  };

  const parseInlineFormatting = (element, baseOptions = {}) => {
    const runs = [];
    element.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.replace(/\\s+/g, ' ');
        runs.push({ text, options: { ...baseOptions } });
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        let text = node.textContent.trim();
        if (text) {
          const options = { ...baseOptions };
          const computed = window.getComputedStyle(node);
          if (node.tagName === 'B' || node.tagName === 'STRONG') {
            if (!shouldSkipBold(computed.fontFamily)) options.bold = true;
          }
          if (node.tagName === 'I' || node.tagName === 'EM') options.italic = true;
          if (node.tagName === 'U') options.underline = true;

          if (['SPAN','B','STRONG','I','EM','U'].includes(node.tagName)) {
            const isBold = computed.fontWeight === 'bold' || parseInt(computed.fontWeight) >= 600;
            if (isBold && !shouldSkipBold(computed.fontFamily)) options.bold = true;
            if (computed.fontStyle === 'italic') options.italic = true;
            if (computed.textDecoration && computed.textDecoration.includes('underline')) options.underline = true;
            if (computed.color && computed.color !== 'rgb(0, 0, 0)') {
              options.color = rgbToHex(computed.color);
              const transparency = extractAlpha(computed.color);
              if (transparency !== null) options.transparency = transparency;
            }
            if (computed.fontSize) options.fontSize = pxToPoints(computed.fontSize);
            if (computed.textTransform && computed.textTransform !== 'none') {
              text = applyTextTransform(text, computed.textTransform);
            }
          }
          runs.push({ text, options });
        }
      }
    });
    if (runs.length > 0) {
      runs[0].text = runs[0].text.replace(/^\\s+/, '');
      runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\\s+$/, '');
    }
    return runs.filter(r => r.text.length > 0);
  };

  // ── Font validation whitelist (Session 4) ──────────────────────
  var SAFE_FONTS = new Set([
    'arial', 'calibri', 'cambria', 'candara', 'consolas', 'constantia',
    'corbel', 'courier new', 'georgia', 'impact', 'lucida console',
    'lucida sans unicode', 'palatino linotype', 'segoe ui', 'segoe ui light',
    'segoe ui semibold', 'segoe ui semilight', 'tahoma', 'times new roman',
    'trebuchet ms', 'verdana', 'wingdings', 'wingdings 2', 'wingdings 3',
    'symbol', 'webdings', 'microsoft sans serif', 'ms sans serif',
    'aptos', 'aptos narrow', 'aptos display', 'garamond', 'book antiqua',
    'franklin gothic medium', 'century gothic', 'gill sans mt',
    'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy',
    'helvetica', 'helvetica neue', 'times', 'courier',
    'system-ui', '-apple-system', 'blinkmacsystemfont', 'roboto'
  ]);

  // Block tag set for shape text detection
  var SHAPE_BLOCK_TAGS = new Set([
    'DIV','SECTION','ARTICLE','P','H1','H2','H3','H4','H5','H6',
    'UL','OL','TABLE','BLOCKQUOTE','PRE','HEADER','FOOTER','NAV'
  ]);

  // ── Resolve fill colour (Session 4) ────────────────────────────
  // Determines the correct solid fill colour for a shape element.
  // When only a gradient is present, backgroundColor is transparent —
  // so we extract the first gradient colour stop instead.
  // Returns the 6-char hex string for pptxgenjs.
  var resolveShapeFill = function(computed) {
    var bgColor = computed.backgroundColor;
    var hasSolidBg = bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent';
    if (hasSolidBg) return rgbToHex(bgColor);

    var bgImg = computed.backgroundImage;
    if (bgImg && bgImg !== 'none' && bgImg.includes('gradient')) {
      var fallback = extractGradientFallbackColor(bgImg);
      if (fallback) return fallback;
    }
    return null;
  };

  // ── Per-container extraction (core of original extractSlideData) ──

  function extractSlideData(container, containerRect) {
    const elements = [];
    const placeholders = [];
    const errors = [];
    const textTags = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI'];
    const processed = new Set();
    var interactiveSkipCount = 0;
    var svgSkipCount = 0;

    var INTERACTIVE_TAGS_SET = new Set([
      'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'NAV', 'FORM'
    ]);

    var EVENT_HANDLER_ATTRS = [
      'onclick', 'onchange', 'onkeydown', 'onkeyup',
      'onmousedown', 'onmouseup', 'ontouchstart', 'ontouchend', 'onsubmit'
    ];

    // Background — with gradient detection (Session 2 addition)
    const containerStyle = window.getComputedStyle(container);
    const bgImage = containerStyle.backgroundImage;
    const bgColor = containerStyle.backgroundColor;

    let background;
    if (bgImage && bgImage !== 'none') {
      const urlMatch = bgImage.match(/url\\(["']?([^"')]+)["']?\\)/);
      if (urlMatch) {
        background = { type: 'image', path: urlMatch[1] };
      } else if (bgImage.includes('gradient')) {
        background = {
          type: 'gradient',
          fallbackColor: rgbToHex(bgColor),
          captureRect: {
            x: containerRect.left,
            y: containerRect.top,
            w: containerRect.width,
            h: containerRect.height
          }
        };
      } else {
        background = { type: 'color', value: rgbToHex(bgColor) };
      }
    } else {
      background = { type: 'color', value: rgbToHex(bgColor) };
    }

    // Offset: all positions relative to container
    const offX = containerRect.left;
    const offY = containerRect.top;

    container.querySelectorAll('*').forEach((el) => {
      if (processed.has(el)) return;

      // Skip if outside this container
      if (!container.contains(el)) return;

      // ── Interactive/navigation element filtering (Session 4) ──
      if (INTERACTIVE_TAGS_SET.has(el.tagName)) {
        el.querySelectorAll('*').forEach(function(child) { processed.add(child); });
        processed.add(el);
        interactiveSkipCount++;
        return;
      }
      var hasEventHandler = EVENT_HANDLER_ATTRS.some(function(attr) {
        return el.hasAttribute(attr);
      });
      if (hasEventHandler) {
        el.querySelectorAll('*').forEach(function(child) { processed.add(child); });
        processed.add(el);
        interactiveSkipCount++;
        return;
      }

      // ── SVG element handling (Session 6, updated Session 6c) ───
      // Inline SVGs captured as raster images via capturePage().
      // Emit a placeholder with position data; the post-extraction
      // capture step converts it to a standard image element.
      if (el.tagName === 'svg' || el.tagName === 'SVG' || el instanceof SVGElement) {
        el.querySelectorAll('*').forEach(function(child) { processed.add(child); });
        processed.add(el);
        if (el.tagName === 'svg' || el.tagName === 'SVG') {
          var svgRect = el.getBoundingClientRect();
          if (svgRect.width > 0 && svgRect.height > 0) {
            elements.push({
              type: 'svg-capture',
              position: {
                x: pxToInch(svgRect.left - offX),
                y: pxToInch(svgRect.top - offY),
                w: pxToInch(svgRect.width),
                h: pxToInch(svgRect.height)
              },
              captureRect: {
                x: svgRect.left,
                y: svgRect.top,
                w: svgRect.width,
                h: svgRect.height
              }
            });
          }
          svgSkipCount++;
        }
        return;
      }

      // Validate text elements
      if (textTags.includes(el.tagName)) {
        const computed = window.getComputedStyle(el);
        const hasBg = computed.backgroundColor && computed.backgroundColor !== 'rgba(0, 0, 0, 0)';
        const hasBorder = ['borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth']
          .some(p => parseFloat(computed[p]) > 0);
        const hasShadow = computed.boxShadow && computed.boxShadow !== 'none';
        if (hasBg || hasBorder || hasShadow) {
          errors.push(
            'Text element <' + el.tagName.toLowerCase() + '> has ' +
            (hasBg ? 'background' : hasBorder ? 'border' : 'shadow') +
            '. Use <div> for backgrounds/borders/shadows.'
          );
          return;
        }
      }

      // Placeholders
      if (el.className && typeof el.className === 'string' && el.className.includes('placeholder')) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          placeholders.push({
            id: el.id || 'placeholder-' + placeholders.length,
            x: pxToInch(rect.left - offX), y: pxToInch(rect.top - offY),
            w: pxToInch(rect.width), h: pxToInch(rect.height)
          });
        }
        processed.add(el);
        return;
      }

      // Images
      if (el.tagName === 'IMG') {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          elements.push({
            type: 'image', src: el.src,
            position: {
              x: pxToInch(rect.left - offX), y: pxToInch(rect.top - offY),
              w: pxToInch(rect.width), h: pxToInch(rect.height)
            }
          });
          processed.add(el);
          return;
        }
      }

      // HR elements — extract as lines (Session 5)
      if (el.tagName === 'HR') {
        var hrRect = el.getBoundingClientRect();
        if (hrRect.width > 0 && hrRect.height > 0) {
          var hrComputed = window.getComputedStyle(el);
          var borderTopWidth = parseFloat(hrComputed.borderTopWidth) || 0;
          var borderTopColor = hrComputed.borderTopColor;
          var lineWidth = borderTopWidth > 0 ? pxToPoints(hrComputed.borderTopWidth) : 0.75;
          var lineColor;
          if (borderTopColor && borderTopColor !== 'rgba(0, 0, 0, 0)' &&
              borderTopColor !== 'transparent') {
            lineColor = rgbToHex(borderTopColor);
          } else if (hrComputed.color && hrComputed.color !== 'rgba(0, 0, 0, 0)') {
            lineColor = rgbToHex(hrComputed.color);
          } else {
            lineColor = 'D1D5DB';
          }
          elements.push({
            type: 'line',
            x1: pxToInch(hrRect.left - offX),
            y1: pxToInch(hrRect.top - offY + hrRect.height / 2),
            x2: pxToInch(hrRect.left - offX + hrRect.width),
            y2: pxToInch(hrRect.top - offY + hrRect.height / 2),
            width: lineWidth,
            color: lineColor
          });
          processed.add(el);
          return;
        }
      }

      // ── Table extraction (Session 9) ────────────────────────────
      // Intercepts <table> elements before their cells can be individually
      // processed as shapes or div-text. Extracts full table structure
      // (rows, cells, text, styles, rowspan/colspan) as a single element.
      if (el.tagName === 'TABLE') {
        var tableRect = el.getBoundingClientRect();
        if (tableRect.width > 0 && tableRect.height > 0) {
          var tableRows = [];
          var tableRowEls = el.querySelectorAll('tr');

          // Track active rowspans: spanTracker[colIndex] = remaining rows to skip.
          // pptxgenjs requires spanned positions to be omitted entirely from the
          // row array — including a cell (even null) at a spanned position creates
          // a visible box instead of a merged cell.
          var spanTracker = [];

          for (var tri = 0; tri < tableRowEls.length; tri++) {
            var tr = tableRowEls[tri];
            var trComputed = window.getComputedStyle(tr);
            var rowFill = null;
            if (trComputed.backgroundColor && trComputed.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
                trComputed.backgroundColor !== 'transparent') {
              rowFill = rgbToHex(trComputed.backgroundColor);
            }

            var cells = [];
            var cellEls = tr.querySelectorAll('td, th');
            var cellIdx = 0; // index into actual DOM cells
            var colPos = 0;  // logical column position

            while (cellIdx < cellEls.length || colPos < spanTracker.length) {
              // If this column is covered by a rowspan from above, emit sentinel
              if (colPos < spanTracker.length && spanTracker[colPos] > 0) {
                cells.push(null);
                spanTracker[colPos]--;
                colPos++;
                continue;
              }

              // No more DOM cells to process
              if (cellIdx >= cellEls.length) break;

              var cell = cellEls[cellIdx];
              var cellComputed = window.getComputedStyle(cell);

              // Cell text: use parseInlineFormatting if inline formatting present
              var cellHasFormatting = cell.querySelector('b, i, u, strong, em, span');
              var cellText;
              if (cellHasFormatting) {
                cellText = parseInlineFormatting(cell);
                if (cellComputed.textTransform && cellComputed.textTransform !== 'none') {
                  cellText = cellText.map(function(run) {
                    return Object.assign({}, run, {
                      text: applyTextTransform(run.text, cellComputed.textTransform)
                    });
                  });
                }
              } else {
                var rawCellText = cell.textContent ? cell.textContent.trim() : '';
                cellText = applyTextTransform(rawCellText, cellComputed.textTransform);
              }

              // Cell fill: own backgroundColor if not transparent, else row fill
              var cellFill = null;
              if (cellComputed.backgroundColor && cellComputed.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
                  cellComputed.backgroundColor !== 'transparent') {
                cellFill = rgbToHex(cellComputed.backgroundColor);
              } else {
                cellFill = rowFill;
              }

              var isHeader = cell.tagName === 'TH';
              var cellFontWeight = parseInt(cellComputed.fontWeight) || 400;
              var cellBold = (isHeader || cellFontWeight >= 600);
              if (cellBold && shouldSkipBold(cellComputed.fontFamily)) {
                cellBold = false;
              }

              // Border detection
              var cellBorderWidth = parseFloat(cellComputed.borderWidth) || 0;
              var cellBorderColor = null;
              var cellBorderPt = null;
              if (cellBorderWidth > 0) {
                cellBorderColor = rgbToHex(cellComputed.borderColor);
                cellBorderPt = pxToPoints(cellComputed.borderWidth);
              }

              // Vertical text detection
              if (cellComputed.writingMode && cellComputed.writingMode.indexOf('vertical') !== -1) {
                errors.push(
                  'Table cell uses vertical text (writing-mode: ' + cellComputed.writingMode +
                  '). Text will render horizontally in PPTX.'
                );
              }

              var cellObj = {
                text: cellText,
                isHeader: isHeader,
                rowSpan: cell.rowSpan || 1,
                colSpan: cell.colSpan || 1,
                style: {
                  fill: cellFill,
                  fontSize: pxToPoints(cellComputed.fontSize),
                  fontFace: cellComputed.fontFamily.split(',')[0].replace(/['"]/g, '').trim(),
                  color: rgbToHex(cellComputed.color),
                  bold: cellBold,
                  italic: cellComputed.fontStyle === 'italic',
                  align: cellComputed.textAlign === 'start' ? 'left' : cellComputed.textAlign,
                  valign: cellComputed.verticalAlign === 'middle' ? 'middle' : 'top',
                  borderColor: cellBorderColor,
                  borderWidth: cellBorderPt
                }
              };
              cells.push(cellObj);

              // Register rowspan in tracker for subsequent rows
              var rs = cell.rowSpan || 1;
              var cs = cell.colSpan || 1;
              if (rs > 1) {
                for (var spi = 0; spi < cs; spi++) {
                  while (spanTracker.length <= colPos + spi) spanTracker.push(0);
                  spanTracker[colPos + spi] = rs - 1;
                }
              }

              colPos += cs;
              cellIdx++;
            }
            tableRows.push(cells);
          }

          elements.push({
            type: 'table',
            position: {
              x: pxToInch(tableRect.left - offX),
              y: pxToInch(tableRect.top - offY),
              w: pxToInch(tableRect.width),
              h: pxToInch(tableRect.height)
            },
            rows: tableRows
          });

          // Mark all descendants as processed to prevent re-extraction
          processed.add(el);
          el.querySelectorAll('*').forEach(function(child) { processed.add(child); });
          return;
        }
      }

      // DIV shapes
      const isContainer = el.tagName === 'DIV' && !textTags.includes(el.tagName);
      if (isContainer) {
        const computed = window.getComputedStyle(el);
        const hasBg = computed.backgroundColor && computed.backgroundColor !== 'rgba(0, 0, 0, 0)';

        // Element-level gradient detection (Session 2)
        const elBgImage = computed.backgroundImage;
        const hasGradient = elBgImage && elBgImage !== 'none' && elBgImage.includes('gradient');
        if (hasGradient) {
          errors.push(
            'Element <div> has a CSS gradient background. ' +
            'Gradients on individual elements are not yet supported — ' +
            'falling back to first colour stop.'
          );
        }

        const borderTop = computed.borderTopWidth;
        const borderRight = computed.borderRightWidth;
        const borderBottom = computed.borderBottomWidth;
        const borderLeft = computed.borderLeftWidth;
        const borders = [borderTop, borderRight, borderBottom, borderLeft].map(b => parseFloat(b) || 0);
        const hasBorder = borders.some(b => b > 0);
        const hasUniformBorder = hasBorder && borders.every(b => b === borders[0]);

        // ── CSS shape trick detection (Session 4) ──────────────────
        // Elements with zero content area that use borders to create
        // visual shapes (CSS triangles, arrows) cannot be faithfully
        // represented in PPTX. Skip and warn.
        //
        // Uses bounding rect minus border widths to compute content
        // area, rather than computed.width which is unreliable with
        // box-sizing: border-box (the border widths are included in
        // the computed width, making a width:0 element report as 14px
        // if it has a 14px border).
        if (hasBorder) {
          var elRect = el.getBoundingClientRect();
          var totalBorderW = borders[3] + borders[1]; // left + right
          var totalBorderH = borders[0] + borders[2]; // top + bottom
          var contentW = elRect.width - totalBorderW;
          var contentH = elRect.height - totalBorderH;
          if (contentW < 1 && contentH < 1) {
            errors.push(
              'CSS shape trick detected (zero-dimension element with ' +
              'borders used to create a visual shape like a triangle or ' +
              'arrow). This cannot be represented in PPTX and was skipped.'
            );
            processed.add(el);
            return;
          }
        }

        const borderLines = [];

        if (hasBorder && !hasUniformBorder) {
          const rect = el.getBoundingClientRect();
          const x = pxToInch(rect.left - offX);
          const y = pxToInch(rect.top - offY);
          const w = pxToInch(rect.width);
          const h = pxToInch(rect.height);

          if (parseFloat(borderTop) > 0) {
            const widthPt = pxToPoints(borderTop);
            const inset = (widthPt / 72) / 2;
            borderLines.push({ type: 'line', x1: x, y1: y + inset, x2: x + w, y2: y + inset, width: widthPt, color: rgbToHex(computed.borderTopColor) });
          }
          if (parseFloat(borderRight) > 0) {
            const widthPt = pxToPoints(borderRight);
            const inset = (widthPt / 72) / 2;
            borderLines.push({ type: 'line', x1: x + w - inset, y1: y, x2: x + w - inset, y2: y + h, width: widthPt, color: rgbToHex(computed.borderRightColor) });
          }
          if (parseFloat(borderBottom) > 0) {
            const widthPt = pxToPoints(borderBottom);
            const inset = (widthPt / 72) / 2;
            borderLines.push({ type: 'line', x1: x, y1: y + h - inset, x2: x + w, y2: y + h - inset, width: widthPt, color: rgbToHex(computed.borderBottomColor) });
          }
          if (parseFloat(borderLeft) > 0) {
            const widthPt = pxToPoints(borderLeft);
            const inset = (widthPt / 72) / 2;
            borderLines.push({ type: 'line', x1: x + inset, y1: y, x2: x + inset, y2: y + h, width: widthPt, color: rgbToHex(computed.borderLeftColor) });
          }
        }

        // Use resolveShapeFill to get the best solid colour, whether
        // from backgroundColor or from the first gradient colour stop.
        const hasVisualFill = hasBg || hasGradient;
        var resolvedFill = hasVisualFill ? resolveShapeFill(computed) : null;

        if (hasVisualFill || hasBorder) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const shadow = parseBoxShadow(computed.boxShadow);

            // ── Shape text capture (Session 4) ───────────────────
            var shapeText = '';
            var shapeStyle = null;
            var shapeHasBlockChild = false;
            for (var sci = 0; sci < el.children.length; sci++) {
              if (SHAPE_BLOCK_TAGS.has(el.children[sci].tagName)) {
                shapeHasBlockChild = true;
                break;
              }
            }
            var shapeInnerText = el.textContent ? el.textContent.trim() : '';
            if (!shapeHasBlockChild && shapeInnerText.length > 0) {
              var shapeHasFormatting = el.querySelector('b, i, u, strong, em, span');
              if (shapeHasFormatting) {
                shapeText = parseInlineFormatting(el);
                var shapeTT = computed.textTransform;
                if (shapeTT && shapeTT !== 'none') {
                  shapeText = shapeText.map(function(run) {
                    return Object.assign({}, run, {
                      text: applyTextTransform(run.text, shapeTT)
                    });
                  });
                }
              } else {
                shapeText = applyTextTransform(shapeInnerText, computed.textTransform);
              }
              var sBold = computed.fontWeight === 'bold' || parseInt(computed.fontWeight) >= 600;
              shapeStyle = {
                fontSize: pxToPoints(computed.fontSize),
                fontFace: computed.fontFamily.split(',')[0].replace(/['"]/g, '').trim(),
                color: rgbToHex(computed.color),
                bold: sBold && !shouldSkipBold(computed.fontFamily),
                italic: computed.fontStyle === 'italic',
                align: computed.textAlign === 'start' ? 'center' : computed.textAlign,
                valign: 'middle',
                margin: [
                  pxToPoints(computed.paddingLeft),
                  pxToPoints(computed.paddingRight),
                  pxToPoints(computed.paddingBottom),
                  pxToPoints(computed.paddingTop)
                ]
              };
              // Mark descendants as processed to prevent re-extraction.
              el.querySelectorAll('*').forEach(function(child) { processed.add(child); });
            }

            if (hasVisualFill || hasUniformBorder) {
              var shapeElement = {
                type: 'shape', text: shapeText,
                position: {
                  x: pxToInch(rect.left - offX), y: pxToInch(rect.top - offY),
                  w: pxToInch(rect.width), h: pxToInch(rect.height)
                },
                shape: {
                  fill: resolvedFill,
                  transparency: hasBg ? extractAlpha(computed.backgroundColor) : null,
                  line: hasUniformBorder ? { color: rgbToHex(computed.borderColor), width: pxToPoints(computed.borderWidth) } : null,
                  rectRadius: (() => {
                    const radius = computed.borderRadius;
                    const rv = parseFloat(radius);
                    if (rv === 0) return 0;
                    if (radius.includes('%')) {
                      if (rv >= 50) return 1;
                      return (rv / 100) * pxToInch(Math.min(rect.width, rect.height));
                    }
                    if (radius.includes('pt')) return rv / 72;
                    return rv / PX_PER_IN;
                  })(),
                  shadow: shadow
                },
                style: shapeStyle
              };
              // Signal for post-extraction gradient capture (Session 6c)
              if (hasGradient) {
                shapeElement.captureRect = {
                  x: rect.left, y: rect.top,
                  w: rect.width, h: rect.height
                };
              }
              elements.push(shapeElement);
            }
            elements.push(...borderLines);
            processed.add(el);
            return;
          }
        }

        // ── Div text fallback (our addition to the original) ─────
        if (!processed.has(el)) {
          const BLOCK_TAGS_SET = new Set([
            'DIV','SECTION','ARTICLE','MAIN','HEADER','FOOTER','NAV',
            'UL','OL','LI','FIGURE','ASIDE','FORM','FIELDSET','DETAILS',
            'TABLE','THEAD','TBODY','TR','H1','H2','H3','H4','H5','H6',
            'P','BLOCKQUOTE','PRE','HR','ADDRESS'
          ]);
          var hasBlockChild = false;
          for (var bci = 0; bci < el.children.length; bci++) {
            if (BLOCK_TAGS_SET.has(el.children[bci].tagName)) {
              hasBlockChild = true;
              break;
            }
          }

          const directText = Array.from(el.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent.trim())
            .filter(t => t.length > 0)
            .join(' ');

          const fullText = el.textContent ? el.textContent.trim() : '';
          if (!hasBlockChild && fullText.length > 0) {
            // ── Skip if children have visual fills (Session 6b) ────
            // If child elements have backgrounds/gradients, they'll be
            // individually extracted as shapes. Don't also extract the
            // parent as combined text — that produces duplication.
            var hasVisualChildren = false;
            for (var vci = 0; vci < el.children.length; vci++) {
              var vcComp = window.getComputedStyle(el.children[vci]);
              var vcBg = vcComp.backgroundColor;
              var vcBgImg = vcComp.backgroundImage;
              if ((vcBg && vcBg !== 'rgba(0, 0, 0, 0)' && vcBg !== 'transparent') ||
                  (vcBgImg && vcBgImg !== 'none' && vcBgImg.includes('gradient'))) {
                var vcText = el.children[vci].textContent ? el.children[vci].textContent.trim() : '';
                if (vcText.length > 0) {
                  hasVisualChildren = true;
                  break;
                }
              }
            }
            if (hasVisualChildren) {
              processed.add(el);
              return;
            }

            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              const computed2 = window.getComputedStyle(el);
              const rotation = getRotation(computed2.transform, computed2.writingMode);
              const pos = getPositionAndSize(el, rect, rotation);

              const baseStyle = {
                fontSize: pxToPoints(computed2.fontSize),
                fontFace: computed2.fontFamily.split(',')[0].replace(/['"]/g, '').trim(),
                color: rgbToHex(computed2.color),
                align: computed2.textAlign === 'start' ? 'left' : computed2.textAlign,
                lineSpacing: pxToPoints(computed2.lineHeight),
                paraSpaceBefore: pxToPoints(computed2.marginTop),
                paraSpaceAfter: pxToPoints(computed2.marginBottom),
                margin: [
                  pxToPoints(computed2.paddingLeft),
                  pxToPoints(computed2.paddingRight),
                  pxToPoints(computed2.paddingBottom),
                  pxToPoints(computed2.paddingTop)
                ]
              };

              const trans = extractAlpha(computed2.color);
              if (trans !== null) baseStyle.transparency = trans;
              if (rotation !== null) baseStyle.rotate = rotation;

              // Detect flex centering (e.g. arrow connector divs)
              var display = computed2.display;
              if (display === 'flex' || display === 'inline-flex') {
                var alignItems = computed2.alignItems;
                var justifyContent = computed2.justifyContent;
                if (alignItems === 'center' || alignItems === 'safe center') {
                  baseStyle.valign = 'middle';
                }
                if (justifyContent === 'center' || justifyContent === 'safe center') {
                  baseStyle.align = 'center';
                }
              }

              const hasFormatting = el.querySelector('b, i, u, strong, em, span');

              if (hasFormatting) {
                const runs = parseInlineFormatting(el);
                const textTransform = computed2.textTransform;
                const transformedRuns = runs.map(run => ({
                  ...run, text: applyTextTransform(run.text, textTransform)
                }));
                elements.push({
                  type: 'div-text', isDivFallback: true, text: transformedRuns,
                  position: { x: pxToInch(pos.x - offX), y: pxToInch(pos.y - offY), w: pxToInch(pos.w), h: pxToInch(pos.h) },
                  style: baseStyle
                });
              } else {
                const isBold = computed2.fontWeight === 'bold' || parseInt(computed2.fontWeight) >= 600;
                const textTransform = computed2.textTransform;
                elements.push({
                  type: 'div-text', isDivFallback: true, text: applyTextTransform(fullText, textTransform),
                  position: { x: pxToInch(pos.x - offX), y: pxToInch(pos.y - offY), w: pxToInch(pos.w), h: pxToInch(pos.h) },
                  style: {
                    ...baseStyle,
                    bold: isBold && !shouldSkipBold(computed2.fontFamily),
                    italic: computed2.fontStyle === 'italic',
                    underline: computed2.textDecoration.includes('underline')
                  }
                });
              }
              el.querySelectorAll('*').forEach(function(child) {
                // Don't mark SVG elements as processed — let SVG extraction
                // handle them (rasterised to PNG via capturePage).
                if (child.tagName === 'svg' || child.tagName === 'SVG' || child instanceof SVGElement) {
                  return;
                }
                // Don't mark text-less block children with visual fills — let
                // shape extraction handle them separately (e.g. legend swatches,
                // decorative dots). Marking them processed would suppress their
                // shape, losing the visual element.
                if (BLOCK_TAGS_SET.has(child.tagName)) {
                  var cpText = child.textContent ? child.textContent.trim() : '';
                  if (cpText.length === 0) {
                    var cpComp = window.getComputedStyle(child);
                    var cpBg = cpComp.backgroundColor;
                    var cpBgImg = cpComp.backgroundImage;
                    var cpHasVisual = (cpBg && cpBg !== 'rgba(0, 0, 0, 0)' && cpBg !== 'transparent') ||
                      (cpBgImg && cpBgImg !== 'none' && cpBgImg.includes('gradient'));
                    if (cpHasVisual) return; // skip — shape extraction will handle
                  }
                }
                processed.add(child);
              });
              processed.add(el);
              return;
            }
          }

          // ── Mixed container text rescue (Session 8a) ────────────
          // When a container has block children but ALL are text-less
          // (decorative swatches, dots), extract the text content using
          // Range-based positioning so the text box covers only the
          // text area, not the decorative block children's space.
          if (hasBlockChild && fullText.length > 0) {
          var allBlockChildrenTextless = true;
          for (var mci = 0; mci < el.children.length; mci++) {
            if (BLOCK_TAGS_SET.has(el.children[mci].tagName)) {
              var mciText = el.children[mci].textContent ? el.children[mci].textContent.trim() : '';
              if (mciText.length > 0) {
                allBlockChildrenTextless = false;
                break;
              }
            }
          }

          if (allBlockChildrenTextless) {
            // Collect text-bearing child nodes (text nodes + inline elements)
            var textBearingNodes = [];
            for (var tbn = 0; tbn < el.childNodes.length; tbn++) {
              var tbNode = el.childNodes[tbn];
              if (tbNode.nodeType === Node.TEXT_NODE && tbNode.textContent.trim().length > 0) {
                textBearingNodes.push(tbNode);
              } else if (tbNode.nodeType === Node.ELEMENT_NODE &&
                         !BLOCK_TAGS_SET.has(tbNode.tagName) &&
                         tbNode.textContent.trim().length > 0) {
                textBearingNodes.push(tbNode);
              }
            }

            if (textBearingNodes.length > 0) {
              var range = document.createRange();
              range.setStartBefore(textBearingNodes[0]);
              range.setEndAfter(textBearingNodes[textBearingNodes.length - 1]);
              var textRect = range.getBoundingClientRect();

              if (textRect.width > 0 && textRect.height > 0) {
                var computed3 = window.getComputedStyle(el);
                var rotation3 = getRotation(computed3.transform, computed3.writingMode);

                var baseStyle3 = {
                  fontSize: pxToPoints(computed3.fontSize),
                  fontFace: computed3.fontFamily.split(',')[0].replace(/['"]/g, '').trim(),
                  color: rgbToHex(computed3.color),
                  align: computed3.textAlign === 'start' ? 'left' : computed3.textAlign,
                  lineSpacing: pxToPoints(computed3.lineHeight),
                  paraSpaceBefore: 0,
                  paraSpaceAfter: 0,
                  margin: [0, 0, 0, 0]
                };

                var trans3 = extractAlpha(computed3.color);
                if (trans3 !== null) baseStyle3.transparency = trans3;
                if (rotation3 !== null) baseStyle3.rotate = rotation3;

                // Detect flex centering
                var display3 = computed3.display;
                if (display3 === 'flex' || display3 === 'inline-flex') {
                  var alignItems3 = computed3.alignItems;
                  if (alignItems3 === 'center' || alignItems3 === 'safe center') {
                    baseStyle3.valign = 'middle';
                  }
                }

                // Build text content — check for inline formatting
                var hasFormatting3 = false;
                for (var fi = 0; fi < textBearingNodes.length; fi++) {
                  if (textBearingNodes[fi].nodeType === Node.ELEMENT_NODE) {
                    hasFormatting3 = true;
                    break;
                  }
                }

                // Collect text from non-block children only
                var rangeText = '';
                for (var rti = 0; rti < el.childNodes.length; rti++) {
                  var rtNode = el.childNodes[rti];
                  if (rtNode.nodeType === Node.TEXT_NODE) {
                    rangeText += rtNode.textContent;
                  } else if (rtNode.nodeType === Node.ELEMENT_NODE &&
                             !BLOCK_TAGS_SET.has(rtNode.tagName)) {
                    rangeText += rtNode.textContent;
                  }
                }
                rangeText = rangeText.trim();

                if (rangeText.length > 0) {
                  var textTransform3 = computed3.textTransform;

                  if (hasFormatting3) {
                    // Block children are text-less so parseInlineFormatting
                    // on the parent produces correct runs (no phantom text
                    // from decorative children).
                    var runs3 = parseInlineFormatting(el);
                    var transformedRuns3 = runs3.map(function(run) {
                      return Object.assign({}, run, { text: applyTextTransform(run.text, textTransform3) });
                    });
                    elements.push({
                      type: 'div-text', isDivFallback: true, text: transformedRuns3,
                      position: { x: pxToInch(textRect.left - offX), y: pxToInch(textRect.top - offY),
                                  w: pxToInch(textRect.width), h: pxToInch(textRect.height) },
                      style: baseStyle3
                    });
                  } else {
                    var isBold3 = computed3.fontWeight === 'bold' || parseInt(computed3.fontWeight) >= 600;
                    elements.push({
                      type: 'div-text', isDivFallback: true,
                      text: applyTextTransform(rangeText, textTransform3),
                      position: { x: pxToInch(textRect.left - offX), y: pxToInch(textRect.top - offY),
                                  w: pxToInch(textRect.width), h: pxToInch(textRect.height) },
                      style: {
                        ...baseStyle3,
                        bold: isBold3 && !shouldSkipBold(computed3.fontFamily),
                        italic: computed3.fontStyle === 'italic',
                        underline: computed3.textDecoration.includes('underline')
                      }
                    });
                  }

                  // Mark non-block, non-SVG descendants as processed
                  el.querySelectorAll('*').forEach(function(child) {
                    if (child.tagName === 'svg' || child.tagName === 'SVG' || child instanceof SVGElement) {
                      return;
                    }
                    if (BLOCK_TAGS_SET.has(child.tagName)) {
                      var cpText = child.textContent ? child.textContent.trim() : '';
                      if (cpText.length === 0) {
                        var cpComp = window.getComputedStyle(child);
                        var cpBg = cpComp.backgroundColor;
                        var cpBgImg = cpComp.backgroundImage;
                        var cpHasVisual = (cpBg && cpBg !== 'rgba(0, 0, 0, 0)' && cpBg !== 'transparent') ||
                          (cpBgImg && cpBgImg !== 'none' && cpBgImg.includes('gradient'));
                        if (cpHasVisual) return;
                      }
                    }
                    processed.add(child);
                  });
                  processed.add(el);
                  return;
                }
              }
            }
          }
        }
        }
      }

      // ── Inline elements with visual properties (Session 4) ────
      // Handles SPAN, A, LABEL with backgrounds (badges, pills, tags).
      // Uses resolveShapeFill for gradient-aware colour extraction.
      if (el.tagName === 'SPAN' || el.tagName === 'A' || el.tagName === 'LABEL') {
        var inlineComputed = window.getComputedStyle(el);
        var inlineRect = el.getBoundingClientRect();
        if (inlineRect.width > 0 && inlineRect.height > 0) {
          var inlineHasBg = inlineComputed.backgroundColor &&
            inlineComputed.backgroundColor !== 'rgba(0, 0, 0, 0)';
          var inlineBgImage = inlineComputed.backgroundImage;
          var inlineHasGradient = inlineBgImage && inlineBgImage !== 'none' &&
            inlineBgImage.includes('gradient');

          if (inlineHasGradient) {
            errors.push(
              'Inline element <' + el.tagName.toLowerCase() + '> has a CSS ' +
              'gradient background — falling back to first colour stop.'
            );
          }

          var inlineHasVisualFill = inlineHasBg || inlineHasGradient;
          var inlineText = el.textContent ? el.textContent.trim() : '';

          if (inlineHasVisualFill && inlineText.length > 0) {
            var inlineFill = resolveShapeFill(inlineComputed);
            var inlineBold = inlineComputed.fontWeight === 'bold' ||
              parseInt(inlineComputed.fontWeight) >= 600;
            var inlineShapeEl = {
              type: 'shape',
              text: applyTextTransform(inlineText, inlineComputed.textTransform),
              position: {
                x: pxToInch(inlineRect.left - offX),
                y: pxToInch(inlineRect.top - offY),
                w: pxToInch(inlineRect.width),
                h: pxToInch(inlineRect.height)
              },
              shape: {
                fill: inlineFill,
                transparency: inlineHasBg ? extractAlpha(inlineComputed.backgroundColor) : null,
                line: null,
                rectRadius: (function() {
                  var r = inlineComputed.borderRadius;
                  var rv = parseFloat(r);
                  if (rv === 0) return 0;
                  if (r.includes('%')) {
                    return rv >= 50 ? 1 : (rv / 100) *
                      pxToInch(Math.min(inlineRect.width, inlineRect.height));
                  }
                  if (r.includes('pt')) return rv / 72;
                  return rv / PX_PER_IN;
                })(),
                shadow: null
              },
              style: {
                fontSize: pxToPoints(inlineComputed.fontSize),
                fontFace: inlineComputed.fontFamily.split(',')[0].replace(/['"]/g, '').trim(),
                color: rgbToHex(inlineComputed.color),
                bold: inlineBold && !shouldSkipBold(inlineComputed.fontFamily),
                italic: inlineComputed.fontStyle === 'italic',
                align: 'center',
                valign: 'middle',
                margin: [
                  pxToPoints(inlineComputed.paddingLeft),
                  pxToPoints(inlineComputed.paddingRight),
                  pxToPoints(inlineComputed.paddingBottom),
                  pxToPoints(inlineComputed.paddingTop)
                ]
              }
            };
            // Signal for post-extraction gradient capture (Session 6c)
            if (inlineHasGradient) {
              inlineShapeEl.captureRect = {
                x: inlineRect.left, y: inlineRect.top,
                w: inlineRect.width, h: inlineRect.height
              };
            }
            elements.push(inlineShapeEl);
            processed.add(el);
            return;
          }

          // Text-only spans (no background fill) — e.g. tags, metric values,
          // contrast labels. Only extract if not already processed (spans inside
          // <p> tags are already captured via parseInlineFormatting).
          if (!processed.has(el) && !inlineHasVisualFill && inlineText.length > 0) {
            var inlineBold2 = inlineComputed.fontWeight === 'bold' ||
              parseInt(inlineComputed.fontWeight) >= 600;
            var inlineTextTransform = inlineComputed.textTransform;
            elements.push({
              type: 'div-text',
              isDivFallback: true,
              text: applyTextTransform(inlineText, inlineTextTransform),
              position: {
                x: pxToInch(inlineRect.left - offX),
                y: pxToInch(inlineRect.top - offY),
                w: pxToInch(inlineRect.width),
                h: pxToInch(inlineRect.height)
              },
              style: {
                fontSize: pxToPoints(inlineComputed.fontSize),
                fontFace: inlineComputed.fontFamily.split(',')[0].replace(/['"]/g, '').trim(),
                color: rgbToHex(inlineComputed.color),
                bold: inlineBold2 && !shouldSkipBold(inlineComputed.fontFamily),
                italic: inlineComputed.fontStyle === 'italic',
                align: inlineComputed.textAlign === 'start' ? 'left' : inlineComputed.textAlign,
                textTransform: inlineTextTransform,
                lineSpacing: pxToPoints(inlineComputed.lineHeight),
                paraSpaceBefore: pxToPoints(inlineComputed.marginTop),
                paraSpaceAfter: pxToPoints(inlineComputed.marginBottom),
                margin: [
                  pxToPoints(inlineComputed.paddingLeft),
                  pxToPoints(inlineComputed.paddingRight),
                  pxToPoints(inlineComputed.paddingBottom),
                  pxToPoints(inlineComputed.paddingTop)
                ]
              }
            });
            processed.add(el);
            return;
          }
        }
      }

      // Bullet lists
      if (el.tagName === 'UL' || el.tagName === 'OL') {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        const liElements = Array.from(el.querySelectorAll('li'));
        const items = [];
        const ulComputed = window.getComputedStyle(el);
        const ulPaddingLeftPt = pxToPoints(ulComputed.paddingLeft);
        const marginLeft = ulPaddingLeftPt * 0.5;
        const textIndent = ulPaddingLeftPt * 0.5;

        liElements.forEach((li, idx) => {
          const isLast = idx === liElements.length - 1;
          const hasFormatting = li.querySelector('b, i, u, strong, em, span');

          if (hasFormatting) {
            const runs = parseInlineFormatting(li, { breakLine: false });
            if (runs.length > 0) {
              runs[0].text = runs[0].text.replace(/^[\\u2022\\-\\*\\u25AA\\u25B8]\\s*/, '');
              runs[0].options.bullet = { indent: textIndent };
            }
            if (runs.length > 0 && !isLast) {
              runs[runs.length - 1].options.breakLine = true;
            }
            items.push(...runs);
          } else {
            const liText = li.textContent.trim().replace(/^[\\u2022\\-\\*\\u25AA\\u25B8]\\s*/, '');
            items.push({ text: liText, options: { bullet: { indent: textIndent }, breakLine: !isLast } });
          }
        });

        const liComputed = window.getComputedStyle(liElements[0] || el);
        elements.push({
          type: 'list', items: items,
          position: {
            x: pxToInch(rect.left - offX), y: pxToInch(rect.top - offY),
            w: pxToInch(rect.width), h: pxToInch(rect.height)
          },
          style: {
            fontSize: pxToPoints(liComputed.fontSize),
            fontFace: liComputed.fontFamily.split(',')[0].replace(/['"]/g, '').trim(),
            color: rgbToHex(liComputed.color),
            transparency: extractAlpha(liComputed.color),
            align: liComputed.textAlign === 'start' ? 'left' : liComputed.textAlign,
            lineSpacing: liComputed.lineHeight && liComputed.lineHeight !== 'normal' ? pxToPoints(liComputed.lineHeight) : null,
            paraSpaceBefore: 0,
            paraSpaceAfter: pxToPoints(liComputed.marginBottom),
            margin: [marginLeft, 0, 0, 0]
          }
        });
        el.querySelectorAll('*').forEach(function(child) { processed.add(child); });
        processed.add(el);
        return;
      }

      // Text elements (P, H1-H6)
      if (!textTags.includes(el.tagName)) return;

      const rect = el.getBoundingClientRect();
      const text = el.textContent.trim();
      if (rect.width === 0 || rect.height === 0 || !text) return;

      const computed = window.getComputedStyle(el);
      const rotation = getRotation(computed.transform, computed.writingMode);
      const pos = getPositionAndSize(el, rect, rotation);

      const baseStyle = {
        fontSize: pxToPoints(computed.fontSize),
        fontFace: computed.fontFamily.split(',')[0].replace(/['"]/g, '').trim(),
        color: rgbToHex(computed.color),
        align: computed.textAlign === 'start' ? 'left' : computed.textAlign,
        lineSpacing: pxToPoints(computed.lineHeight),
        paraSpaceBefore: pxToPoints(computed.marginTop),
        paraSpaceAfter: pxToPoints(computed.marginBottom),
        margin: [
          pxToPoints(computed.paddingLeft),
          pxToPoints(computed.paddingRight),
          pxToPoints(computed.paddingBottom),
          pxToPoints(computed.paddingTop)
        ]
      };

      const transparency = extractAlpha(computed.color);
      if (transparency !== null) baseStyle.transparency = transparency;
      if (rotation !== null) baseStyle.rotate = rotation;

      const hasFormatting = el.querySelector('b, i, u, strong, em, span');

      if (hasFormatting) {
        const runs = parseInlineFormatting(el);
        const adjustedStyle = { ...baseStyle };
        if (adjustedStyle.lineSpacing) {
          const maxFs = Math.max(adjustedStyle.fontSize, ...runs.map(r => r.options?.fontSize || 0));
          if (maxFs > adjustedStyle.fontSize) {
            const mult = adjustedStyle.lineSpacing / adjustedStyle.fontSize;
            adjustedStyle.lineSpacing = maxFs * mult;
          }
        }
        const textTransform = computed.textTransform;
        const transformedRuns = runs.map(run => ({
          ...run, text: applyTextTransform(run.text, textTransform)
        }));

        elements.push({
          type: el.tagName.toLowerCase(), text: transformedRuns,
          position: { x: pxToInch(pos.x - offX), y: pxToInch(pos.y - offY), w: pxToInch(pos.w), h: pxToInch(pos.h) },
          style: adjustedStyle
        });
      } else {
        const textTransform = computed.textTransform;
        const transformedText = applyTextTransform(text, textTransform);
        const isBold = computed.fontWeight === 'bold' || parseInt(computed.fontWeight) >= 600;

        elements.push({
          type: el.tagName.toLowerCase(), text: transformedText,
          position: { x: pxToInch(pos.x - offX), y: pxToInch(pos.y - offY), w: pxToInch(pos.w), h: pxToInch(pos.h) },
          style: {
            ...baseStyle,
            bold: isBold && !shouldSkipBold(computed.fontFamily),
            italic: computed.fontStyle === 'italic',
            underline: computed.textDecoration.includes('underline')
          }
        });
      }
      el.querySelectorAll('*').forEach(function(child) { processed.add(child); });
      processed.add(el);
    });

    if (interactiveSkipCount > 0) {
      errors.push(
        interactiveSkipCount + ' interactive element(s) (buttons, controls) ' +
        'skipped — these have no static equivalent in PPTX.'
      );
    }

    if (svgSkipCount > 0) {
      errors.push(
        svgSkipCount + ' inline SVG element(s) captured as raster images. ' +
        'These will appear as non-editable images in the PPTX.'
      );
    }

    // ── Font validation (Session 4, extended Session 9 for tables) ──
    var usedFonts = new Set();
    for (var fi = 0; fi < elements.length; fi++) {
      var elFont = elements[fi];
      if (elFont.style && elFont.style.fontFace) {
        usedFonts.add(elFont.style.fontFace);
      }
      // Table cells: iterate rows/cells to collect fonts
      if (elFont.type === 'table' && elFont.rows) {
        for (var fri = 0; fri < elFont.rows.length; fri++) {
          for (var fci = 0; fci < elFont.rows[fri].length; fci++) {
            var fCell = elFont.rows[fri][fci];
            if (fCell && fCell.style && fCell.style.fontFace) {
              usedFonts.add(fCell.style.fontFace);
            }
          }
        }
      }
    }
    var unsafeFonts = [];
    usedFonts.forEach(function(font) {
      if (!SAFE_FONTS.has(font.toLowerCase())) {
        unsafeFonts.push(font);
      }
    });
    if (unsafeFonts.length > 0) {
      errors.push(
        'Font(s) may not be available on target machines: ' +
        unsafeFonts.join(', ') + '. ' +
        'PowerPoint will substitute a default font if these are missing.'
      );
    }

    // ── High-transparency warning (Session 4) ───────────────────
    var highTransCount = 0;
    for (var ti = 0; ti < elements.length; ti++) {
      var elT = elements[ti];
      if (elT.type === 'shape' && elT.shape && elT.shape.transparency != null) {
        if (elT.shape.transparency > 80) highTransCount++;
      }
    }
    if (highTransCount > 0) {
      errors.push(
        highTransCount + ' shape(s) have very high transparency (>80%). ' +
        'These may appear differently in PowerPoint than in the browser.'
      );
    }

    return { background, elements, placeholders, errors };
  }

  // ── Multi-slide detection (our addition) ─────────────────────

  const body = document.body;
  if (!body) throw new Error('Document has no <body> element.');

  const bodyStyle = window.getComputedStyle(body);

  function detectSlideContainers() {
    let containers = Array.from(body.querySelectorAll('[data-slide-number]'));
    if (containers.length >= 1) {
      containers.sort((a, b) => parseInt(a.dataset.slideNumber) - parseInt(b.dataset.slideNumber));
      return { containers, method: 'data-slide-number' };
    }
    containers = Array.from(body.querySelectorAll('section.slide, div.slide'));
    if (containers.length >= 1) return { containers, method: 'class-slide' };

    containers = Array.from(body.children).filter(el => el.tagName.toLowerCase() === 'section');
    if (containers.length > 1) return { containers, method: 'section-children' };

    const divs = Array.from(body.children).filter(el => el.tagName.toLowerCase() === 'div');
    if (divs.length > 1) {
      const rects = divs.map(d => d.getBoundingClientRect());
      const widths = rects.map(r => r.width);
      if (widths.every(w => Math.abs(w - widths[0]) < 5) && rects.every(r => r.height > 100)) {
        return { containers: divs, method: 'uniform-divs' };
      }
    }
    return { containers: [body], method: 'body-fallback' };
  }

  const { containers, method } = detectSlideContainers();
  const slides = [];

  for (let i = 0; i < containers.length; i++) {
    const container = containers[i];
    const containerRect = container.getBoundingClientRect();

    let vpW = containerRect.width;
    let vpH = containerRect.height;
    if (method === 'body-fallback') {
      vpW = parseFloat(bodyStyle.width) || containerRect.width;
      vpH = parseFloat(bodyStyle.height) || containerRect.height;
    }

    const titleEl = container.querySelector('h1, h2, [class*="title"]');
    const slideTitle = titleEl ? titleEl.textContent.trim().substring(0, 100) : null;

    const dataAttrs = {};
    if (container.dataset) {
      for (const [key, value] of Object.entries(container.dataset)) dataAttrs[key] = value;
    }

    const slideData = extractSlideData(container, containerRect);

    // ── Overflow detection (Session 3) ───────────────────────
    var OVERFLOW_TOL_PX = 5;
    var overflowW = container.scrollWidth - containerRect.width;
    var overflowH = container.scrollHeight - containerRect.height;

    if (overflowW > OVERFLOW_TOL_PX) {
      slideData.errors.push(
        'Slide content overflows horizontally by ~' + Math.round(overflowW) +
        'px. Some content may appear off-slide in the PPTX.'
      );
    }
    if (overflowH > OVERFLOW_TOL_PX) {
      slideData.errors.push(
        'Slide content overflows vertically by ~' + Math.round(overflowH) +
        'px. Some content may appear off-slide in the PPTX.'
      );
    }

    var vpWIn = vpW / PX_PER_IN;
    var vpHIn = vpH / PX_PER_IN;
    var EL_TOL_IN = 0.05;
    var overflowElCount = 0;

    for (var ei = 0; ei < slideData.elements.length; ei++) {
      var elPos = slideData.elements[ei].position;
      if (elPos) {
        var r = elPos.x + elPos.w;
        var b = elPos.y + elPos.h;
        if (r > vpWIn + EL_TOL_IN || b > vpHIn + EL_TOL_IN ||
            elPos.x < -EL_TOL_IN || elPos.y < -EL_TOL_IN) {
          overflowElCount++;
        }
      }
    }

    if (overflowElCount > 0) {
      slideData.errors.push(
        overflowElCount + ' element(s) extend beyond the slide boundary ' +
        'and may appear clipped in the PPTX.'
      );
    }

      slides.push({
      index: i,
      viewport: { w: vpW, h: vpH },
      title: slideTitle,
      dataAttributes: dataAttrs,
      background: slideData.background,
      elements: slideData.elements,
      placeholders: slideData.placeholders,
      errors: slideData.errors
    });
  }

  return { slideCount: slides.length, detectionMethod: method, slides };
})()
`;

/**
 * Captures gradient backgrounds from the hidden window via capturePage().
 *
 * @param {object} result - Extraction result with slides array
 * @param {Electron.BrowserWindow} hiddenWindow - The still-open hidden window
 * @returns {Promise<{ captured: number, failed: number }>} Capture summary
 */
/**
 * Returns a JavaScript string that, when executed in the browser context,
 * resolves and returns the slide container elements using the same
 * detection logic as the extraction script.
 *
 * This is the single source of truth for container resolution in all
 * post-extraction capture functions. If detection methods change in
 * EXTRACTION_SCRIPT, update this function to match.
 *
 * @param {string} method - Detection method from extraction result
 * @returns {string} JavaScript source to execute via executeJavaScript()
 */
function buildContainerResolverJS(method) {
  return `
    (function() {
      var method = '${method}';
      var containers;
      if (method === 'data-slide-number') {
        containers = Array.from(document.body.querySelectorAll('[data-slide-number]'));
        containers.sort(function(a, b) {
          return parseInt(a.dataset.slideNumber) - parseInt(b.dataset.slideNumber);
        });
      } else if (method === 'class-slide') {
        containers = Array.from(document.body.querySelectorAll('section.slide, div.slide'));
      } else if (method === 'section-children') {
        containers = Array.from(document.body.children).filter(function(el) {
          return el.tagName.toLowerCase() === 'section';
        });
      } else if (method === 'uniform-divs') {
        containers = Array.from(document.body.children).filter(function(el) {
          return el.tagName.toLowerCase() === 'div';
        });
      } else {
        containers = [document.body];
      }
      return containers;
    })()
  `;
}

async function captureGradients(result, hiddenWindow) {
  let captured = 0;
  let failed = 0;

  const method = result.detectionMethod;
  const RESOLVE_CONTAINERS_JS = buildContainerResolverJS(method);

  for (const slide of result.slides) {
    if (!slide.background || slide.background.type !== 'gradient') continue;

    const rect = slide.background.captureRect;
    const slideIndex = slide.index;

    try {
      // Step 1: Query geometry and gradient styles BEFORE hiding containers.
      // Must happen first because display:none zeroes getBoundingClientRect().
      const captureInfo = await hiddenWindow.webContents.executeJavaScript(`
        (function() {
          var containers = ${RESOLVE_CONTAINERS_JS};
          var target = containers[${slideIndex}];
          if (!target) return null;
          var r = target.getBoundingClientRect();
          return { x: r.left, y: r.top, w: r.width, h: r.height };
        })()
      `);

      if (!captureInfo || captureInfo.w === 0 || captureInfo.h === 0) {
        throw new Error('Target container not found or has zero dimensions at capture time');
      }

      if (Math.abs(captureInfo.x - rect.x) > 1 || Math.abs(captureInfo.y - rect.y) > 1) {
        console.log(
          `[Extractor] Slide ${slide.index + 1}: capture rect shifted — ` +
          `stored (${Math.round(rect.x)},${Math.round(rect.y)}) → ` +
          `fresh (${Math.round(captureInfo.x)},${Math.round(captureInfo.y)})`
        );
      }

      // Step 2: In a single DOM operation — read gradient from target,
      // hide ALL containers with display:none !important, and create
      // a clean clone div with only the gradient background.
      // display:none !important is needed because the taxonomy deck's
      // .active class has CSS rules that override opacity/visibility.
      // Reading the gradient and creating the clone in the same call
      // ensures we capture styles before the target is hidden.
      await hiddenWindow.webContents.executeJavaScript(`
        (function() {
          var containers = ${RESOLVE_CONTAINERS_JS};
          var target = containers[${slideIndex}];
          // Read gradient styles before hiding
          var bgImage = '';
          var bgColor = '';
          var borderRadius = '';
          if (target) {
            var cs = window.getComputedStyle(target);
            bgImage = cs.backgroundImage;
            bgColor = cs.backgroundColor;
            borderRadius = cs.borderRadius;
          }
          // Hide all containers
          for (var i = 0; i < containers.length; i++) {
            var c = containers[i];
            c.dataset._prevDisplay = c.style.display || '';
            c.style.setProperty('display', 'none', 'important');
          }
          // Create empty clone with only the gradient.
          // Position at (0,0) — NOT at the original slide coordinates.
          // capturePage() may serve stale compositor frames for regions
          // far down the page (e.g. y:8000+), so we capture at the origin
          // where the compositor is guaranteed to have a fresh frame.
          var clone = document.createElement('div');
          clone.id = '__gradient_capture_clone__';
          clone.style.position = 'absolute';
          clone.style.left = '0px';
          clone.style.top = '0px';
          clone.style.width = '${captureInfo.w}px';
          clone.style.height = '${captureInfo.h}px';
          clone.style.zIndex = '2147483647';
          clone.style.pointerEvents = 'none';
          clone.style.margin = '0';
          clone.style.padding = '0';
          clone.style.border = 'none';
          clone.style.overflow = 'hidden';
          clone.style.backgroundImage = bgImage;
          clone.style.backgroundColor = bgColor;
          clone.style.borderRadius = borderRadius;
          document.body.appendChild(clone);
        })()
      `);

      await new Promise(resolve => setTimeout(resolve, 50));

      const nativeImage = await hiddenWindow.webContents.capturePage({
        x: 0,
        y: 0,
        width: Math.round(captureInfo.w),
        height: Math.round(captureInfo.h)
      });

      // Clean up: remove clone, restore all containers
      await hiddenWindow.webContents.executeJavaScript(`
        (function() {
          var clone = document.getElementById('__gradient_capture_clone__');
          if (clone) clone.remove();
          var containers = ${RESOLVE_CONTAINERS_JS};
          for (var i = 0; i < containers.length; i++) {
            var c = containers[i];
            c.style.display = c.dataset._prevDisplay || '';
            delete c.dataset._prevDisplay;
          }
        })()
      `);

      if (nativeImage.isEmpty()) {
        throw new Error('capturePage returned empty image');
      }

      const dataUri = nativeImage.toDataURL();
      slide.background = { type: 'image', data: dataUri };
      captured++;

      console.log(
        `[Extractor] Slide ${slide.index + 1}: gradient captured as PNG ` +
        `(${Math.round(captureInfo.w)}×${Math.round(captureInfo.h)}px)`
      );

    } catch (err) {
      // Best-effort cleanup: remove clone if created, restore containers
      try {
        await hiddenWindow.webContents.executeJavaScript(`
          (function() {
            var clone = document.getElementById('__gradient_capture_clone__');
            if (clone) clone.remove();
            var containers = ${RESOLVE_CONTAINERS_JS};
            for (var i = 0; i < containers.length; i++) {
              var c = containers[i];
              if (c.dataset._prevDisplay !== undefined) {
                c.style.display = c.dataset._prevDisplay || '';
                delete c.dataset._prevDisplay;
              }
            }
          })()
        `);
      } catch (_) { /* best effort */ }

      console.warn(
        `[Extractor] Slide ${slide.index + 1}: gradient capture failed — ` +
        `falling back to solid colour. ${err.message}`
      );
      slide.errors.push(
        'Gradient background could not be captured. ' +
        'Falling back to solid colour (' + slide.background.fallbackColor + ').'
      );
      slide.background = { type: 'color', value: slide.background.fallbackColor };
      failed++;
    }
  }

  return { captured, failed };
}

/**
 * Captures inline SVGs and gradient element backgrounds from the hidden
 * window via capturePage(). SVGs are captured as-is. Gradient elements
 * have their children hidden before capture to isolate the background.
 *
 * For stacked slide layouts (e.g. agile-slides with position:absolute),
 * other containers are hidden before capture to prevent overlapping
 * slides from contaminating the captured image — same approach as
 * captureGradients() uses for slide-level backgrounds.
 *
 * @param {object} result - Extraction result with slides array
 * @param {Electron.BrowserWindow} hiddenWindow - The still-open hidden window
 * @returns {Promise<{ svgsCaptured: number, svgsFailed: number, gradientsCaptured: number, gradientsFailed: number }>}
 */
async function captureElementImages(result, hiddenWindow) {
  let svgsCaptured = 0;
  let svgsFailed = 0;
  let gradientsCaptured = 0;
  let gradientsFailed = 0;

  const method = result.detectionMethod;
  const RESOLVE_CONTAINERS_JS = buildContainerResolverJS(method);

  // Helper: hide all containers except the target slide, showing its
  // content so the target element is visible for capture.
  async function isolateSlide(slideIndex) {
    await hiddenWindow.webContents.executeJavaScript(`
      (function() {
        var containers = ${RESOLVE_CONTAINERS_JS};
        for (var i = 0; i < containers.length; i++) {
          var c = containers[i];
          c.dataset._ecPrevOpacity = c.style.opacity || '';
          c.dataset._ecPrevVisibility = c.style.visibility || '';
          if (i !== ${slideIndex}) {
            c.style.opacity = '0';
            c.style.visibility = 'hidden';
          } else {
            c.style.opacity = '1';
            c.style.visibility = 'visible';
          }
        }
      })()
    `);
  }

  // Helper: restore all containers to their original state.
  async function restoreContainers() {
    await hiddenWindow.webContents.executeJavaScript(`
      (function() {
        var containers = ${RESOLVE_CONTAINERS_JS};
        for (var i = 0; i < containers.length; i++) {
          var c = containers[i];
          if (c.dataset._ecPrevOpacity !== undefined) {
            c.style.opacity = c.dataset._ecPrevOpacity || '';
            c.style.visibility = c.dataset._ecPrevVisibility || '';
            delete c.dataset._ecPrevOpacity;
            delete c.dataset._ecPrevVisibility;
          }
        }
      })()
    `);
  }

  // Helper: hide text content of the target element (for gradient capture).
  // Hides both direct text (via color: transparent) and child elements
  // (via visibility: hidden) so only the background gradient is captured.
  async function hideTargetContent(captureRect) {
    await hiddenWindow.webContents.executeJavaScript(`
      (function() {
        var targetRect = { x: ${captureRect.x}, y: ${captureRect.y},
                           w: ${captureRect.w}, h: ${captureRect.h} };
        var all = document.querySelectorAll('*');
        for (var i = 0; i < all.length; i++) {
          var r = all[i].getBoundingClientRect();
          if (Math.abs(r.left - targetRect.x) < 2 &&
              Math.abs(r.top - targetRect.y) < 2 &&
              Math.abs(r.width - targetRect.w) < 2 &&
              Math.abs(r.height - targetRect.h) < 2) {
            // Hide direct text nodes by making text transparent
            all[i].dataset._gcPrevColor = all[i].style.color || '';
            all[i].style.color = 'transparent';
            // Hide child elements
            var children = all[i].children;
            for (var c = 0; c < children.length; c++) {
              children[c].dataset._gcPrevVis = children[c].style.visibility || '';
              children[c].style.visibility = 'hidden';
            }
            break;
          }
        }
      })()
    `);
  }

  // Helper: restore text and children visibility after gradient capture
  async function restoreTargetContent() {
    await hiddenWindow.webContents.executeJavaScript(`
      (function() {
        document.querySelectorAll('*').forEach(function(el) {
          if (el.dataset._gcPrevColor !== undefined) {
            el.style.color = el.dataset._gcPrevColor || '';
            delete el.dataset._gcPrevColor;
          }
          var children = el.children;
          for (var c = 0; c < children.length; c++) {
            if (children[c].dataset._gcPrevVis !== undefined) {
              children[c].style.visibility = children[c].dataset._gcPrevVis || '';
              delete children[c].dataset._gcPrevVis;
            }
          }
        });
      })()
    `);
  }

  // Helper: move slide container to viewport origin (0,0) before capture.
  // Only used when the slide is far from the viewport origin, where
  // capturePage() serves stale compositor frames (Learning #28).
  // Saves the entire inline style via cssText to avoid the inset
  // shorthand ordering problem (Learning #49).
  async function repositionSlideToOrigin(slideIndex) {
    await hiddenWindow.webContents.executeJavaScript(`
      (function() {
        var containers = ${RESOLVE_CONTAINERS_JS};
        var target = containers[${slideIndex}];
        if (!target) return;
        // Save entire inline style — avoids inset/top/left restore ordering issues
        target.dataset._capPrevStyle = target.style.cssText;
        // Apply reposition: inset first, then top/left (Learning #49)
        target.style.position = 'absolute';
        target.style.inset = 'auto';
        target.style.top = '0px';
        target.style.left = '0px';
        // Remove overflow clipping so below-fold content is capturable (Learning #51)
        target.style.overflow = 'visible';
        target.style.maxHeight = 'none';
      })()
    `);
    // Compositor frame flush: a dummy capture forces Chromium to render
    // a fresh frame after the DOM reposition (Learning #50)
    await hiddenWindow.webContents.capturePage({ x: 0, y: 0, width: 1, height: 1 });
    await new Promise(resolve => setTimeout(resolve, 30));
  }

  // Helper: restore slide container to its original position after capture.
  // Restores the entire inline style via cssText (saved by repositionSlideToOrigin).
  async function restoreSlidePosition(slideIndex) {
    await hiddenWindow.webContents.executeJavaScript(`
      (function() {
        var containers = ${RESOLVE_CONTAINERS_JS};
        var target = containers[${slideIndex}];
        if (!target) return;
        target.style.cssText = target.dataset._capPrevStyle || '';
        delete target.dataset._capPrevStyle;
      })()
    `);
  }

  for (const slide of result.slides) {
    // Check if this slide has any elements needing capture
    const hasSvgs = slide.elements.some(el => el.type === 'svg-capture');
    const hasGradients = slide.elements.some(el => el.type === 'shape' && el.captureRect);
    if (!hasSvgs && !hasGradients) continue;

    // Isolate this slide (hide other containers) for accurate capture
    await isolateSlide(slide.index);
    await new Promise(resolve => setTimeout(resolve, 30));

    // Lift ALL overflow clipping on the slide container and its descendants
    // so below-fold SVGs are visible to the compositor (Learning #51).
    // Two sources of clipping: fixViewportUnitHeights() sets overflow:hidden
    // + maxHeight on the container, and fixture CSS may set overflow-y:auto
    // on nested elements (e.g. .slide-body). Both must be lifted.
    const overflowLifted = await hiddenWindow.webContents.executeJavaScript(`
      (function() {
        var containers = ${RESOLVE_CONTAINERS_JS};
        var target = containers[${slide.index}];
        if (!target) return 0;
        var count = 0;
        // Lift overflow on the container itself
        var cs = window.getComputedStyle(target);
        if (cs.overflow === 'hidden' || cs.overflow === 'auto' ||
            cs.overflowY === 'hidden' || cs.overflowY === 'auto') {
          target.dataset._capPrevOverflow = target.style.overflow || '';
          target.dataset._capPrevOverflowY = target.style.overflowY || '';
          target.dataset._capPrevMaxHeight = target.style.maxHeight || '';
          target.dataset._capPrevHeight = target.style.height || '';
          target.style.overflow = 'visible';
          target.style.overflowY = 'visible';
          target.style.maxHeight = 'none';
          target.style.height = 'auto';
          count++;
        }
        // Lift overflow on ALL descendants with computed overflow clipping
        var all = target.querySelectorAll('*');
        for (var i = 0; i < all.length; i++) {
          var dcs = window.getComputedStyle(all[i]);
          if (dcs.overflow === 'hidden' || dcs.overflow === 'auto' ||
              dcs.overflowY === 'hidden' || dcs.overflowY === 'auto') {
            all[i].dataset._capPrevOverflow = all[i].style.overflow || '';
            all[i].dataset._capPrevOverflowY = all[i].style.overflowY || '';
            all[i].dataset._capPrevMaxHeight = all[i].style.maxHeight || '';
            all[i].dataset._capPrevHeight = all[i].style.height || '';
            all[i].style.overflow = 'visible';
            all[i].style.overflowY = 'visible';
            all[i].style.maxHeight = 'none';
            all[i].style.height = 'auto';
            count++;
          }
        }
        return count;
      })()
    `);
    await new Promise(resolve => setTimeout(resolve, 50));

    // After overflow lift, batch re-query ALL SVG positions in one pass.
    // The lift may shift flex layout, making stored captureRects stale.
    // SVGs are queried in DOM order within the slide container, which
    // matches extraction order (both use querySelectorAll traversal).
    const freshSvgRects = await hiddenWindow.webContents.executeJavaScript(`
      (function() {
        var containers = ${RESOLVE_CONTAINERS_JS};
        var target = containers[${slide.index}];
        if (!target) return [];
        var svgs = target.querySelectorAll('svg');
        var rects = [];
        for (var i = 0; i < svgs.length; i++) {
          var r = svgs[i].getBoundingClientRect();
          rects.push({ x: r.left, y: r.top, w: r.width, h: r.height });
        }
        return rects;
      })()
    `);

    // Batch re-query gradient element positions (elements with CSS gradient
    // backgrounds that have captureRects). Matched in DOM order.
    const freshGradientRects = await hiddenWindow.webContents.executeJavaScript(`
      (function() {
        var containers = ${RESOLVE_CONTAINERS_JS};
        var target = containers[${slide.index}];
        if (!target) return [];
        var results = [];
        var all = target.querySelectorAll('*');
        for (var i = 0; i < all.length; i++) {
          var cs = window.getComputedStyle(all[i]);
          if (cs.backgroundImage && cs.backgroundImage !== 'none' &&
              cs.backgroundImage.includes('gradient')) {
            var r = all[i].getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              results.push({ x: r.left, y: r.top, w: r.width, h: r.height });
            }
          }
        }
        return results;
      })()
    `);

    // Assign fresh rects to elements by DOM order
    let svgIdx = 0;
    let gradIdx = 0;
    for (let j = 0; j < slide.elements.length; j++) {
      if (slide.elements[j].type === 'svg-capture') {
        if (svgIdx < freshSvgRects.length) {
          slide.elements[j]._freshRect = freshSvgRects[svgIdx];
          svgIdx++;
        }
      } else if (slide.elements[j].type === 'shape' && slide.elements[j].captureRect) {
        if (gradIdx < freshGradientRects.length) {
          slide.elements[j]._freshRect = freshGradientRects[gradIdx];
          gradIdx++;
        }
      }
    }

    // Track whether we've repositioned this slide (done lazily on first
    // empty capture, not pre-decided via a threshold).
    let slideRepositioned = false;
    const isDiag = process.env.CAPTURE_DIAGNOSTIC === '1';

    for (let i = 0; i < slide.elements.length; i++) {
      const el = slide.elements[i];

      // ── SVG Capture ──────────────────────────────────────
      if (el.type === 'svg-capture') {
        try {
          // Use batch-queried fresh rect (DOM order), fall back to stored
          const useRect = el._freshRect || el.captureRect;

          // First attempt: capture at absolute coordinates (works for
          // most fixtures — the compositor renders content within the
          // window's content area regardless of Y offset).
          let nativeImage = await hiddenWindow.webContents.capturePage({
            x: Math.round(useRect.x),
            y: Math.round(useRect.y),
            width: Math.round(useRect.w),
            height: Math.round(useRect.h)
          });

          if (isDiag) {
            const debugPath = path.join(os.tmpdir(), `capture-debug-s${slide.index}-el${i}-svg-direct.png`);
            fs.writeFileSync(debugPath, nativeImage.toPNG());
            const sz = nativeImage.getSize();
            console.log(`[DIAG] Slide ${slide.index + 1} el${i} SVG direct: (${Math.round(useRect.x)},${Math.round(useRect.y)}) ${sz.width}x${sz.height}, empty=${nativeImage.isEmpty()}${el._freshRect ? ' [fresh]' : ' [stored]'}`);
          }

          // If direct capture returned empty, reposition the slide to
          // the viewport origin and retry (Learning #28: compositor may
          // serve stale frames for regions beyond the rendered area).
          if (nativeImage.isEmpty() && !slideRepositioned) {
            console.log(
              `[Extractor] Slide ${slide.index + 1}: direct SVG capture empty, ` +
              `repositioning slide to origin and retrying`
            );
            await repositionSlideToOrigin(slide.index);
            slideRepositioned = true;

            const reposX = el.position ? el.position.x * 96 : 0;
            const reposY = el.position ? el.position.y * 96 : 0;

            nativeImage = await hiddenWindow.webContents.capturePage({
              x: Math.round(reposX),
              y: Math.round(reposY),
              width: Math.round(useRect.w),
              height: Math.round(useRect.h)
            });

            if (isDiag) {
              const debugPath = path.join(os.tmpdir(), `capture-debug-s${slide.index}-el${i}-svg-repos.png`);
              fs.writeFileSync(debugPath, nativeImage.toPNG());
              const sz = nativeImage.getSize();
              console.log(`[DIAG] Slide ${slide.index + 1} el${i} SVG repos: (${Math.round(reposX)},${Math.round(reposY)}) ${sz.width}x${sz.height}, empty=${nativeImage.isEmpty()}`);
            }
          } else if (nativeImage.isEmpty() && slideRepositioned) {
            // Already repositioned from a prior element — use repositioned coords
            const reposX = el.position ? el.position.x * 96 : 0;
            const reposY = el.position ? el.position.y * 96 : 0;

            nativeImage = await hiddenWindow.webContents.capturePage({
              x: Math.round(reposX),
              y: Math.round(reposY),
              width: Math.round(useRect.w),
              height: Math.round(useRect.h)
            });
          }

          if (nativeImage.isEmpty()) {
            throw new Error('capturePage returned empty image for SVG');
          }

          const dataUri = nativeImage.toDataURL();

          slide.elements[i] = {
            type: 'image',
            src: dataUri,
            position: el.position
          };

          svgsCaptured++;
          console.log(
            `[Extractor] Slide ${slide.index + 1}: SVG captured as PNG ` +
            `(${Math.round(el.captureRect.w)}×${Math.round(el.captureRect.h)}px)`
          );

        } catch (err) {
          console.warn(
            `[Extractor] Slide ${slide.index + 1}: SVG capture failed — ` +
            `removing element. ${err.message}`
          );
          slide.elements.splice(i, 1);
          i--;
          svgsFailed++;
        }
        continue;
      }

      // ── Element Gradient Capture ─────────────────────────
      if (el.type === 'shape' && el.captureRect) {
        const captureW = el.captureRect.w;
        const captureH = el.captureRect.h;
        try {
          // Use batch-queried fresh rect (DOM order), fall back to stored
          const gradRect = el._freshRect || el.captureRect;
          let capX = slideRepositioned ? (el.position ? el.position.x * 96 : 0) : gradRect.x;
          let capY = slideRepositioned ? (el.position ? el.position.y * 96 : 0) : gradRect.y;
          const targetRect = { x: capX, y: capY, w: gradRect.w, h: gradRect.h };

          // Hide the element's children so we capture only the background
          await hideTargetContent(targetRect);
          await new Promise(resolve => setTimeout(resolve, 30));

          let nativeImage = await hiddenWindow.webContents.capturePage({
            x: Math.round(capX),
            y: Math.round(capY),
            width: Math.round(gradRect.w),
            height: Math.round(gradRect.h)
          });

          if (isDiag) {
            const debugPath = path.join(os.tmpdir(), `capture-debug-s${slide.index}-el${i}-gradient-direct.png`);
            fs.writeFileSync(debugPath, nativeImage.toPNG());
            const sz = nativeImage.getSize();
            console.log(`[DIAG] Slide ${slide.index + 1} el${i} gradient direct: (${Math.round(capX)},${Math.round(capY)}) ${sz.width}x${sz.height}, empty=${nativeImage.isEmpty()}${el._freshRect ? ' [fresh]' : ' [stored]'}`);
          }

          // If direct capture returned empty, reposition and retry
          if (nativeImage.isEmpty() && !slideRepositioned) {
            await restoreTargetContent();
            console.log(
              `[Extractor] Slide ${slide.index + 1}: direct gradient capture empty, ` +
              `repositioning slide to origin and retrying`
            );
            await repositionSlideToOrigin(slide.index);
            slideRepositioned = true;

            capX = el.position ? el.position.x * 96 : 0;
            capY = el.position ? el.position.y * 96 : 0;
            const reposRect = { x: capX, y: capY, w: gradRect.w, h: gradRect.h };

            await hideTargetContent(reposRect);
            await new Promise(resolve => setTimeout(resolve, 30));

            nativeImage = await hiddenWindow.webContents.capturePage({
              x: Math.round(capX),
              y: Math.round(capY),
              width: Math.round(gradRect.w),
              height: Math.round(gradRect.h)
            });

            if (isDiag) {
              const debugPath = path.join(os.tmpdir(), `capture-debug-s${slide.index}-el${i}-gradient-repos.png`);
              fs.writeFileSync(debugPath, nativeImage.toPNG());
              const sz = nativeImage.getSize();
              console.log(`[DIAG] Slide ${slide.index + 1} el${i} gradient repos: (${Math.round(capX)},${Math.round(capY)}) ${sz.width}x${sz.height}, empty=${nativeImage.isEmpty()}`);
            }
          }

          await restoreTargetContent();

          if (nativeImage.isEmpty()) {
            throw new Error('capturePage returned empty image for gradient element');
          }

          const dataUri = nativeImage.toDataURL();
          el.shape.fillImage = dataUri;
          delete el.captureRect;

          gradientsCaptured++;
          console.log(
            `[Extractor] Slide ${slide.index + 1}: element gradient captured as PNG ` +
            `(${Math.round(captureW)}×${Math.round(captureH)}px)`
          );

        } catch (err) {
          try { await restoreTargetContent(); } catch (_) { /* best effort */ }

          console.warn(
            `[Extractor] Slide ${slide.index + 1}: element gradient capture failed — ` +
            `keeping solid fallback. ${err.message}`
          );
          delete el.captureRect;
          gradientsFailed++;
        }
      }
    }

    // Restore overflow clipping on container and all descendants
    await hiddenWindow.webContents.executeJavaScript(`
      (function() {
        var containers = ${RESOLVE_CONTAINERS_JS};
        var target = containers[${slide.index}];
        if (!target) return;
        // Restore container
        if (target.dataset._capPrevOverflow !== undefined) {
          target.style.overflow = target.dataset._capPrevOverflow;
          target.style.overflowY = target.dataset._capPrevOverflowY || '';
          target.style.maxHeight = target.dataset._capPrevMaxHeight;
          target.style.height = target.dataset._capPrevHeight;
          delete target.dataset._capPrevOverflow;
          delete target.dataset._capPrevOverflowY;
          delete target.dataset._capPrevMaxHeight;
          delete target.dataset._capPrevHeight;
        }
        // Restore all descendants
        var all = target.querySelectorAll('*');
        for (var i = 0; i < all.length; i++) {
          if (all[i].dataset._capPrevOverflow !== undefined) {
            all[i].style.overflow = all[i].dataset._capPrevOverflow;
            all[i].style.overflowY = all[i].dataset._capPrevOverflowY || '';
            all[i].style.maxHeight = all[i].dataset._capPrevMaxHeight;
            all[i].style.height = all[i].dataset._capPrevHeight;
            delete all[i].dataset._capPrevOverflow;
            delete all[i].dataset._capPrevOverflowY;
            delete all[i].dataset._capPrevMaxHeight;
            delete all[i].dataset._capPrevHeight;
          }
        }
      })()
    `);

    // Restore slide position (if repositioned), then restore all containers
    if (slideRepositioned) {
      await restoreSlidePosition(slide.index);
    }
    await restoreContainers();
  }

  return { svgsCaptured, svgsFailed, gradientsCaptured, gradientsFailed };
}

// ── Pre-extraction DOM preparation helpers ──────────────────────────
// Each addresses a specific HTML pattern that would break extraction
// if left unhandled. Extracted from extractFromHTML() for readability.

/**
 * Strips CSS transforms from slide containers and their ancestors.
 * Targets viewport-scaling patterns (e.g. hr-skills-slide.html) where
 * JS applies transform: scale(...) to fit a fixed-size slide into the
 * browser. Without stripping, getBoundingClientRect() returns scaled
 * coordinates instead of native layout dimensions.
 *
 * Scoped to containers and ancestors only — content element transforms
 * are preserved to avoid breaking gradient capture visibility logic.
 *
 * @param {Electron.BrowserWindow} hiddenWindow
 */
async function stripContainerTransforms(hiddenWindow) {
  await hiddenWindow.webContents.executeJavaScript(`
    (function() {
      var slideEls = document.querySelectorAll('[data-slide-number], section.slide, div.slide');
      if (slideEls.length === 0) return;
      var toStrip = new Set();
      for (var i = 0; i < slideEls.length; i++) {
        toStrip.add(slideEls[i]);
        var parent = slideEls[i].parentElement;
        while (parent && parent !== document.documentElement) {
          toStrip.add(parent);
          parent = parent.parentElement;
        }
      }
      toStrip.forEach(function(el) {
        var cs = window.getComputedStyle(el);
        if (cs.transform && cs.transform !== 'none') {
          el.style.transform = 'none';
        }
      });
    })()
  `);
  await new Promise(resolve => setTimeout(resolve, 100));
}

/**
 * Forces display on hidden slide containers before extraction.
 * Targets interactive slideshow decks (e.g. taxonomy-deck-html.html)
 * that use display:none to hide inactive slides. Without this,
 * getBoundingClientRect() returns zero-size rects for hidden slides.
 *
 * Also handles stacked layouts (position:absolute) by switching to
 * position:relative so slides stack vertically instead of overlapping.
 *
 * Only affects containers detected as slides — does not modify
 * arbitrary elements. Safe for existing fixtures because:
 * - opacity-based hiding (agile-slides) already has layout
 * - vertically stacked slides (lpm, conformant) are all visible
 * - viewport-scaled slides (hr-skills, modern-it) are visible
 *
 * @param {Electron.BrowserWindow} hiddenWindow
 * @returns {Promise<number>} Number of containers that were made visible
 */
async function forceHiddenSlidesVisible(hiddenWindow) {
  return await hiddenWindow.webContents.executeJavaScript(`
    (function() {
      var containers = Array.from(document.querySelectorAll('[data-slide-number]'));
      if (containers.length === 0) {
        containers = Array.from(document.querySelectorAll('section.slide, div.slide'));
      }
      if (containers.length === 0) return 0;

      var changed = 0;
      for (var i = 0; i < containers.length; i++) {
        var cs = window.getComputedStyle(containers[i]);
        if (cs.display === 'none') {
          containers[i].dataset._prevDisplay = 'none';
          // Match the visible sibling's display mode (usually flex),
          // falling back to block if all are hidden.
          var visibleSibling = null;
          for (var j = 0; j < containers.length; j++) {
            var sibCs = window.getComputedStyle(containers[j]);
            if (sibCs.display !== 'none') {
              visibleSibling = sibCs.display;
              break;
            }
          }
          containers[i].style.display = visibleSibling || 'block';
          changed++;
        }
      }

      if (changed > 0) {
        // For stacked layouts where all slides now occupy the same
        // position (position:absolute), force them to stack vertically
        // so they don't overlap and contaminate each other's capture.
        var firstCs = window.getComputedStyle(containers[0]);
        var isStacked = firstCs.position === 'absolute' || firstCs.position === 'fixed';

        if (isStacked) {
          for (var k = 0; k < containers.length; k++) {
            var c = containers[k];
            c.dataset._prevPosition = c.style.position || '';
            c.dataset._prevInset = c.style.inset || '';
            c.dataset._prevTop = c.style.top || '';
            c.dataset._prevLeft = c.style.left || '';
            c.style.position = 'relative';
            c.style.inset = 'auto';
            c.style.top = 'auto';
            c.style.left = 'auto';
          }
        }
      }

      return changed;
    })()
  `);
}

/**
 * Re-measures body dimensions after display-none fix has changed
 * the document layout, and resizes the hidden window to fit.
 *
 * Only called when forceHiddenSlidesVisible() made changes, to avoid
 * resizing from the original h*10 buffer that other fixtures rely on.
 *
 * @param {Electron.BrowserWindow} hiddenWindow
 */
async function remeasureAfterDisplayFix(hiddenWindow) {
  const updatedDims = await hiddenWindow.webContents.executeJavaScript(`
    (function() {
      var s = window.getComputedStyle(document.body);
      return {
        w: parseFloat(s.width) || document.body.scrollWidth,
        h: document.body.scrollHeight
      };
    })()
  `);
  if (updatedDims.w > 0 && updatedDims.h > 0) {
    hiddenWindow.setContentSize(
      Math.round(updatedDims.w),
      Math.round(updatedDims.h)
    );
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

/**
 * Fixes slide containers whose height is inflated by CSS viewport units
 * (100vh). After the display-none fix resizes the hidden window to fit
 * all stacked slides, 100vh recalculates to the full document height,
 * making each slide container enormously tall. This distorts element
 * positions (e.g. flex-centered content sits at y ≈ 32,000px).
 *
 * Uses the original viewport height (pre-setContentSize) as the reference
 * rather than hardcoding a 16:9 ratio. This correctly handles any aspect
 * ratio (16:9, 4:3, portrait, etc.) because it restores the actual
 * pre-inflation dimensions.
 *
 * @param {Electron.BrowserWindow} hiddenWindow
 * @param {number} originalVpHeight - The original viewport height before
 *   setContentSize() inflated it (typically the minHeight option, default 540)
 * @returns {Promise<number>} Number of containers that were fixed
 */
async function fixViewportUnitHeights(hiddenWindow, originalVpHeight) {
  return await hiddenWindow.webContents.executeJavaScript(`
    (function() {
      var containers = Array.from(document.querySelectorAll('[data-slide-number]'));
      if (containers.length === 0) {
        containers = Array.from(document.querySelectorAll('section.slide, div.slide'));
      }
      if (containers.length === 0) return 0;

      var refHeight = ${originalVpHeight};

      var fixed = 0;
      for (var i = 0; i < containers.length; i++) {
        var c = containers[i];
        var rect = c.getBoundingClientRect();
        if (rect.height > refHeight * 2 && rect.width > 0) {
          c.style.height = refHeight + 'px';
          c.style.maxHeight = refHeight + 'px';
          c.style.overflow = 'hidden';
          fixed++;
        }
      }
      return fixed;
    })()
  `);
}

/**
 * Loads an HTML file into a hidden BrowserWindow and extracts
 * per-slide element data using the ported html2pptx-local.cjs logic.
 *
 * @param {string} htmlFilePath - Absolute path to the HTML file
 * @param {object} [options]
 * @param {number} [options.width=960]
 * @param {number} [options.minHeight=540]
 * @returns {Promise<{ slideCount: number, detectionMethod: string, slides: object[] }>}
 * @throws {Error} If file cannot be loaded or extraction fails
 */
async function extractFromHTML(htmlFilePath, options = {}) {
  const { width = 960, minHeight = 540 } = options;
  let hiddenWindow = null;

  try {
    hiddenWindow = new BrowserWindow({
      show: false,
      width,
      height: minHeight * 10,
      useContentSize: true,
      webPreferences: {
        ...getSecureWebPreferences(null),
        sandbox: true
      }
    });

    installNavigationGuards(hiddenWindow);

    // ── Phase 1: Load and measure ─────────────────────────────
    await hiddenWindow.loadFile(htmlFilePath);

    await new Promise(resolve => setTimeout(resolve, 300));

    const bodyDims = await hiddenWindow.webContents.executeJavaScript(`
      (function() {
        const s = window.getComputedStyle(document.body);
        return { w: parseFloat(s.width) || document.body.scrollWidth, h: parseFloat(s.height) || document.body.scrollHeight };
      })()
    `);

    if (bodyDims.w > 0 && bodyDims.h > 0) {
      hiddenWindow.setContentSize(Math.round(bodyDims.w), Math.round(bodyDims.h * 10));
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // ── Phase 2: Pre-extraction DOM preparation ───────────────
    await stripContainerTransforms(hiddenWindow);
    const displayFixCount = await forceHiddenSlidesVisible(hiddenWindow);
    if (displayFixCount > 0) {
      console.log(`[Extractor] Forced ${displayFixCount} hidden slide(s) to visible`);
      await remeasureAfterDisplayFix(hiddenWindow);
      const vhFixCount = await fixViewportUnitHeights(hiddenWindow, minHeight);
      if (vhFixCount > 0) {
        console.log(`[Extractor] Fixed ${vhFixCount} container(s) with inflated viewport-unit heights`);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // ── Phase 3: Extract slide data ───────────────────────────
    const result = await hiddenWindow.webContents.executeJavaScript(EXTRACTION_SCRIPT);

    if (!result || !result.slides || result.slides.length === 0) {
      throw new Error('Extraction returned no slide data.');
    }

    console.log(
      `[Extractor] ${path.basename(htmlFilePath)}: ` +
      `${result.slideCount} slide(s) via "${result.detectionMethod}"`
    );

    // ── Phase 4: Post-extraction captures ─────────────────────
    const hasGradients = result.slides.some(
      s => s.background && s.background.type === 'gradient'
    );

    if (hasGradients) {
      const gradientResult = await captureGradients(result, hiddenWindow);
      console.log(
        `[Extractor] Gradient capture: ${gradientResult.captured} succeeded, ` +
        `${gradientResult.failed} fell back to solid colour`
      );
    }

    const hasElementCaptures = result.slides.some(s =>
      s.elements.some(el =>
        el.type === 'svg-capture' || (el.type === 'shape' && el.captureRect)
      )
    );

    if (hasElementCaptures) {
      const elementResult = await captureElementImages(result, hiddenWindow);
      console.log(
        `[Extractor] Element captures: ` +
        `${elementResult.svgsCaptured} SVGs, ${elementResult.gradientsCaptured} gradients succeeded. ` +
        `${elementResult.svgsFailed} SVGs, ${elementResult.gradientsFailed} gradients failed.`
      );
    }

    return result;

  } catch (err) {
    if (err.message.includes('ERR_FILE_NOT_FOUND')) {
      throw new Error(`HTML file not found: ${htmlFilePath}`);
    }
    throw new Error(`Extraction failed for ${path.basename(htmlFilePath)}: ${err.message}`);

  } finally {
    if (hiddenWindow && !hiddenWindow.isDestroyed()) {
      hiddenWindow.destroy();
    }
  }
}

module.exports = { extractFromHTML };