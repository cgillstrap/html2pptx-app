// ============================================================================
// FILE: src/generation/generator.js
// ============================================================================
//
// Architectural Intent:
// Consumes the multi-slide extraction data and generates a PowerPoint file
// via pptxgenjs. The addElements() and addBackground() functions are ported
// directly from html2pptx-local.cjs, preserving the original's handling of:
//   - Inline text runs (mixed color/bold/italic per word)
//   - Margin array order [left, right, bottom, top] (PptxGenJS convention)
//   - Single-line text width adjustment (2% wider to prevent clipping)
//   - Rotation, box shadows, partial borders as lines
//   - List bullet indentation from UL padding
//   - inset: 0 on text boxes to remove default PowerPoint internal padding
//
// Our additions: multi-slide loop using extraction data from our slide
// detection layer, speaker notes from data-notes attributes, and
// scale-to-fit when content exceeds the slide viewport.
//
// Key Changes (Session 4):
// - Shape text styling: shapes can now contain text with font, size, colour,
//   bold, italic, alignment, and margin properties. The shape rendering path
//   applies these from the extraction data's style property. This enables
//   badge labels, phase durations, and styled containers with text to render
//   correctly in PPTX rather than appearing as empty rectangles.
//
// Key Changes (Session 3):
// - Scale-to-fit: uniform scaling when content exceeds viewport
//
// Key Changes (Session 2):
// - Speaker notes from data-notes attributes
// - Data URI background support for gradient rasterisation
//
// Contract:
//   Input:  Multi-slide extraction result + output path + options
//   Output: { outputPath, slideCount, warnings }
//   Throws: If pptxgenjs fails to generate or write
// ============================================================================

'use strict';

const PptxGenJS = require('pptxgenjs');
const path = require('path');
const { getConfig } = require('../main/config');

const PX_PER_IN = 96;

// Tolerance before scale-to-fit kicks in (inches). Prevents scaling
// from triggering on sub-pixel rounding in Chromium's layout engine.
const SCALE_TOLERANCE_IN = 0.05;


// ── Scale-to-Fit (Session 3) ────────────────────────────────────────────────

/**
 * Computes a uniform scale factor and centering offsets to fit all
 * elements within the viewport.
 *
 * @param {object} slideData - Per-slide extraction data
 * @param {number} vpW - Viewport width in inches
 * @param {number} vpH - Viewport height in inches
 * @returns {{ scale: number, offsetX: number, offsetY: number }}
 */
function computeScaleAndOffset(slideData, vpW, vpH) {
  let minL = Infinity;
  let minT = Infinity;
  let maxR = 0;
  let maxB = 0;

  for (const el of slideData.elements) {
    if (el.position) {
      const r = el.position.x + el.position.w;
      const b = el.position.y + el.position.h;
      if (el.position.x < minL) minL = el.position.x;
      if (el.position.y < minT) minT = el.position.y;
      if (r > maxR) maxR = r;
      if (b > maxB) maxB = b;
    }
    if (el.type === 'line') {
      if (el.x1 < minL) minL = el.x1;
      if (el.y1 < minT) minT = el.y1;
      if (el.x2 > maxR) maxR = el.x2;
      if (el.y2 > maxB) maxB = el.y2;
    }
  }

  if (slideData.placeholders) {
    for (const ph of slideData.placeholders) {
      const r = ph.x + ph.w;
      const b = ph.y + ph.h;
      if (ph.x < minL) minL = ph.x;
      if (ph.y < minT) minT = ph.y;
      if (r > maxR) maxR = r;
      if (b > maxB) maxB = b;
    }
  }

  if (maxR === 0 && maxB === 0) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }

  const scaleX = maxR > vpW + SCALE_TOLERANCE_IN ? vpW / maxR : 1;
  const scaleY = maxB > vpH + SCALE_TOLERANCE_IN ? vpH / maxB : 1;
  const scale = Math.min(scaleX, scaleY);

  if (scale >= 1) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }

  const scaledW = (maxR - minL) * scale;
  const scaledH = (maxB - minT) * scale;
  const scaledMinL = minL * scale;
  const scaledMinT = minT * scale;

  const offsetX = (vpW - scaledW) / 2 - scaledMinL;
  const offsetY = (vpH - scaledH) / 2 - scaledMinT;

  return { scale, offsetX, offsetY };
}

/**
 * Applies a uniform scale factor and centering offsets to all positions,
 * sizes, font sizes, and spacing values in a slide's element and
 * placeholder data.
 *
 * Mutates the slideData in place.
 *
 * @param {object} slideData - Per-slide extraction data (mutated in place)
 * @param {number} scale - Uniform scale factor (0 < scale < 1)
 * @param {number} offsetX - Horizontal centering offset in inches
 * @param {number} offsetY - Vertical centering offset in inches
 */
function applyScaling(slideData, scale, offsetX, offsetY) {
  for (const el of slideData.elements) {

    // ── Positions (inches) — scale then centre ────────────
    if (el.position) {
      el.position.x = el.position.x * scale + offsetX;
      el.position.y = el.position.y * scale + offsetY;
      el.position.w *= scale;
      el.position.h *= scale;
    }

    // ── Lines: partial border coordinates + width ───────────
    if (el.type === 'line') {
      el.x1 = el.x1 * scale + offsetX;
      el.y1 = el.y1 * scale + offsetY;
      el.x2 = el.x2 * scale + offsetX;
      el.y2 = el.y2 * scale + offsetY;
      if (el.width) el.width *= scale;
    }

    // ── Shape properties ────────────────────────────────────
    if (el.shape) {
      if (el.shape.line && el.shape.line.width) {
        el.shape.line.width *= scale;
      }
      if (el.shape.rectRadius) {
        el.shape.rectRadius *= scale;
      }
      if (el.shape.shadow) {
        if (el.shape.shadow.blur) el.shape.shadow.blur *= scale;
        if (el.shape.shadow.offset) el.shape.shadow.offset *= scale;
      }
    }

    // ── Style properties (points) ───────────────────────────
    if (el.style) {
      if (el.style.fontSize) el.style.fontSize *= scale;
      if (el.style.lineSpacing) el.style.lineSpacing *= scale;
      if (el.style.paraSpaceBefore) el.style.paraSpaceBefore *= scale;
      if (el.style.paraSpaceAfter) el.style.paraSpaceAfter *= scale;
      if (Array.isArray(el.style.margin)) {
        el.style.margin = el.style.margin.map(m => m * scale);
      }
    }

    // ── Inline text runs (mixed formatting) ─────────────────
    if (Array.isArray(el.text)) {
      for (const run of el.text) {
        if (run.options) {
          if (run.options.fontSize) run.options.fontSize *= scale;
        }
      }
    }

    // ── List items ──────────────────────────────────────────
    if (Array.isArray(el.items)) {
      for (const item of el.items) {
        if (item.options) {
          if (item.options.fontSize) item.options.fontSize *= scale;
          if (item.options.bullet && item.options.bullet.indent) {
            item.options.bullet.indent *= scale;
          }
        }
      }
    }
  }

  // ── Placeholders ────────────────────────────────────────────
  if (slideData.placeholders) {
    for (const ph of slideData.placeholders) {
      ph.x = ph.x * scale + offsetX;
      ph.y = ph.y * scale + offsetY;
      ph.w *= scale;
      ph.h *= scale;
    }
  }
}


// ── Background ───────────────────────────────────────────────────────────────

/**
 * Adds background to a pptxgenjs slide.
 *
 * @param {object} slideData - Per-slide extraction data
 * @param {object} targetSlide - pptxgenjs slide object
 * @param {string} htmlDir - Directory of source HTML for resolving image paths
 */
function addBackground(slideData, targetSlide, htmlDir) {
  const bg = slideData.background;
  if (!bg) return;

  if (bg.type === 'image') {
    if (bg.data) {
      targetSlide.background = { data: bg.data };
      return;
    }

    if (bg.path) {
      let imagePath = bg.path.startsWith('file://')
        ? bg.path.replace('file://', '')
        : bg.path;

      if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
        console.warn(`[Generator] Skipped remote background image: ${imagePath}`);
        return;
      }

      if (!path.isAbsolute(imagePath)) {
        imagePath = path.resolve(htmlDir, imagePath);
      }

      if (htmlDir && !imagePath.startsWith(htmlDir)) {
        console.warn(`[Generator] Blocked background path traversal: ${imagePath}`);
        return;
      }

      targetSlide.background = { path: imagePath };
    }
  } else if (bg.type === 'color' && bg.value) {
    targetSlide.background = { color: bg.value };
  }
}


// ── Element Rendering ────────────────────────────────────────────────────────

/**
 * Adds extracted elements to a pptxgenjs slide.
 * Ported from html2pptx-local.cjs addElements().
 *
 * @param {object} slideData - Per-slide extraction data
 * @param {object} targetSlide - pptxgenjs slide object
 * @param {object} pres - pptxgenjs presentation object
 * @param {string} htmlDir - Directory of source HTML
 */
function addElements(slideData, targetSlide, pres, htmlDir) {
  for (const el of slideData.elements) {

    // ── Images ─────────────────────────────────────────────────
    if (el.type === 'image') {
      let imagePath = el.src;

      if (imagePath.startsWith('file://')) {
        imagePath = imagePath.replace('file://', '');
      }

      if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
        console.warn(`[Generator] Skipped remote image: ${imagePath}`);
        continue;
      }

      if (!imagePath.startsWith('data:')) {
        if (!path.isAbsolute(imagePath)) {
          imagePath = path.resolve(htmlDir, imagePath);
        }
        if (htmlDir && !imagePath.startsWith(htmlDir)) {
          console.warn(`[Generator] Blocked image path traversal: ${imagePath}`);
          continue;
        }
      }

      try {
        const imgOpts = {
          x: el.position.x, y: el.position.y,
          w: el.position.w, h: el.position.h
        };
        if (imagePath.startsWith('data:')) {
          imgOpts.data = imagePath;
        } else {
          imgOpts.path = imagePath;
        }
        targetSlide.addImage(imgOpts);
      } catch (err) {
        console.warn(`[Generator] Image failed: ${err.message}`);
      }
      continue;
    }

    // ── Lines (partial borders) ────────────────────────────────
    if (el.type === 'line') {
      targetSlide.addShape(pres.ShapeType.line, {
        x: el.x1, y: el.y1,
        w: el.x2 - el.x1, h: el.y2 - el.y1,
        line: { color: el.color, width: el.width }
      });
      continue;
    }

    // ── Shapes (divs with bg/border, inline badges) ────────────
    // Session 4: Shapes can now contain text with styling. When
    // el.style is present, text properties (font, size, colour,
    // alignment, margins) are applied so text renders correctly
    // inside the shape. This handles badge labels, phase durations,
    // and other styled containers that hold text alongside their
    // visual properties.
    if (el.type === 'shape') {
      const shapeOpts = {
        x: el.position.x, y: el.position.y,
        w: el.position.w, h: el.position.h,
        shape: el.shape.rectRadius > 0 ? pres.ShapeType.roundRect : pres.ShapeType.rect
      };

      if (el.shape.fill) {
        shapeOpts.fill = { color: el.shape.fill };
        if (el.shape.transparency != null) shapeOpts.fill.transparency = el.shape.transparency;
      }
      if (el.shape.line) shapeOpts.line = el.shape.line;
      if (el.shape.rectRadius > 0) shapeOpts.rectRadius = el.shape.rectRadius;
      if (el.shape.shadow) shapeOpts.shadow = el.shape.shadow;

      // ── Shape text styling (Session 4) ────────────────────────
      // Apply text properties from extraction data so that text
      // inside shapes renders with the correct font, size, colour,
      // and alignment. Without this, shapes containing text (badge
      // labels, phase durations) would appear as empty rectangles.
      if (el.style) {
        if (el.style.fontSize) shapeOpts.fontSize = el.style.fontSize;
        if (el.style.fontFace) shapeOpts.fontFace = el.style.fontFace;
        if (el.style.color) shapeOpts.color = el.style.color;
        if (el.style.bold) shapeOpts.bold = el.style.bold;
        if (el.style.italic) shapeOpts.italic = el.style.italic;
        if (el.style.align) shapeOpts.align = el.style.align;
        if (el.style.valign) shapeOpts.valign = el.style.valign;
        if (el.style.margin) shapeOpts.margin = el.style.margin;
        // Remove default PowerPoint internal padding so our
        // extracted margins control spacing precisely.
        shapeOpts.inset = 0;
      }

      targetSlide.addText(el.text || '', shapeOpts);
      continue;
    }

    // ── Lists (UL/OL) ─────────────────────────────────────────
    if (el.type === 'list') {
      const listOpts = {
        x: el.position.x, y: el.position.y,
        w: el.position.w, h: el.position.h,
        fontSize: el.style.fontSize,
        fontFace: el.style.fontFace,
        color: el.style.color,
        align: el.style.align,
        valign: 'top',
        lineSpacing: el.style.lineSpacing,
        paraSpaceBefore: el.style.paraSpaceBefore,
        paraSpaceAfter: el.style.paraSpaceAfter,
        margin: el.style.margin
      };
      targetSlide.addText(el.items, listOpts);
      continue;
    }

    // ── Div text fallback (our addition) ──────────────────────
    if (el.type === 'div-text' && el.isDivFallback) {
      const config = getConfig();
      if (config.divTextHandling === 'strict') {
        continue;
      }
    }

    // ── Text (P, H1-H6, and div-text fallback) ────────────────
    const lineHeight = el.style.lineSpacing || el.style.fontSize * 1.2;
    const isSingleLine = el.position.h <= lineHeight * 1.5;

    let adjustedX = el.position.x;
    let adjustedW = el.position.w;

    if (isSingleLine) {
      const increase = el.position.w * 0.02;
      const align = el.style.align;

      if (align === 'center') {
        adjustedX = el.position.x - (increase / 2);
        adjustedW = el.position.w + increase;
      } else if (align === 'right') {
        adjustedX = el.position.x - increase;
        adjustedW = el.position.w + increase;
      } else {
        adjustedW = el.position.w + increase;
      }
    }

    const textOpts = {
      x: adjustedX, y: el.position.y,
      w: adjustedW, h: el.position.h,
      fontSize: el.style.fontSize,
      fontFace: el.style.fontFace,
      color: el.style.color,
      bold: el.style.bold,
      italic: el.style.italic,
      underline: el.style.underline,
      valign: 'top',
      lineSpacing: el.style.lineSpacing,
      paraSpaceBefore: el.style.paraSpaceBefore,
      paraSpaceAfter: el.style.paraSpaceAfter,
      inset: 0
    };

    if (el.style.align) textOpts.align = el.style.align;
    if (el.style.margin) textOpts.margin = el.style.margin;
    if (el.style.rotate !== undefined) textOpts.rotate = el.style.rotate;
    if (el.style.transparency !== null && el.style.transparency !== undefined) {
      textOpts.transparency = el.style.transparency;
    }

    targetSlide.addText(el.text, textOpts);
  }
}


// ── Placeholder Rendering ────────────────────────────────────────────────────

/**
 * Renders placeholder elements as visible shapes if configured.
 *
 * @param {object[]} placeholders - Array of { id, x, y, w, h } from extraction
 * @param {object} targetSlide - pptxgenjs slide object
 * @param {object} pres - pptxgenjs presentation object
 */
function renderPlaceholders(placeholders, targetSlide, pres) {
  if (!placeholders || placeholders.length === 0) return;

  const config = getConfig();
  if (config.placeholderRendering !== 'visible') return;

  for (const ph of placeholders) {
    targetSlide.addShape(pres.ShapeType.rect, {
      x: ph.x, y: ph.y, w: ph.w, h: ph.h,
      fill: {
        color: config.placeholderFillColor,
        transparency: config.placeholderFillTransparency
      },
      line: { color: 'BFBFBF', width: 0.5 }
    });
  }
}


// ── Main Generation Function ─────────────────────────────────────────────────

/**
 * Generates a PowerPoint file from multi-slide extraction data.
 *
 * @param {object} extractionResult - Output from extractor (with slides array)
 * @param {string} outputPath - Absolute path for the output .pptx file
 * @param {object} [options]
 * @param {string} [options.htmlDir] - Directory of source HTML for image resolution
 * @returns {Promise<{ outputPath: string, slideCount: number, warnings: string[] }>}
 * @throws {Error} If generation or file writing fails
 */
async function generatePPTX(extractionResult, outputPath, options = {}) {
  const { htmlDir = '' } = options;
  const { slides } = extractionResult;

  if (!slides || slides.length === 0) {
    throw new Error('No slides to generate.');
  }

  const pres = new PptxGenJS();
  const warnings = [];

  const firstVP = slides[0].viewport;
  const layoutW = firstVP.w / PX_PER_IN;
  const layoutH = firstVP.h / PX_PER_IN;
  pres.defineLayout({ name: 'CUSTOM', width: layoutW, height: layoutH });
  pres.layout = 'CUSTOM';

  for (let i = 0; i < slides.length; i++) {
    const slideData = slides[i];
    const targetSlide = pres.addSlide();

    if (slideData.errors && slideData.errors.length > 0) {
      slideData.errors.forEach(err => {
        warnings.push(`Slide ${i + 1}: ${err}`);
      });
    }

    // ── Scale-to-fit with centering (Session 3) ────────────
    const slideVpW = slideData.viewport.w / PX_PER_IN;
    const slideVpH = slideData.viewport.h / PX_PER_IN;
    const { scale, offsetX, offsetY } = computeScaleAndOffset(slideData, slideVpW, slideVpH);

    if (scale < 1) {
      const pct = ((1 - scale) * 100).toFixed(1);
      warnings.push(
        `Slide ${i + 1}: Content exceeds slide boundary. ` +
        `Scaled to fit and centred (${pct}% reduction, factor ${scale.toFixed(3)}).`
      );
      applyScaling(slideData, scale, offsetX, offsetY);
      console.log(
        `[Generator] Slide ${i + 1}: scale-to-fit applied ` +
        `(factor ${scale.toFixed(3)}, ${pct}% reduction, ` +
        `offset +${offsetX.toFixed(3)}" x +${offsetY.toFixed(3)}")`
      );
    }

    addBackground(slideData, targetSlide, htmlDir);

    const authorNotes = slideData.dataAttributes && slideData.dataAttributes.notes;
    if (authorNotes) {
      targetSlide.addNotes(authorNotes);
    } else if (slideData.title) {
      targetSlide.addNotes('Slide ' + (i + 1) + ': ' + slideData.title);
    }

    addElements(slideData, targetSlide, pres, htmlDir);
    renderPlaceholders(slideData.placeholders, targetSlide, pres);

    console.log(
      '[Generator] Slide ' + (i + 1) + '/' + slides.length + ': ' +
      '"' + (slideData.title || 'Untitled') + '" - ' +
      slideData.elements.length + ' elements'
    );
  }

  await pres.writeFile({ fileName: outputPath });

  if (warnings.length > 0) {
    console.warn('[Generator] Warnings:\n  ' + warnings.join('\n  '));
  }

  return { outputPath, slideCount: slides.length, warnings };
}

module.exports = { generatePPTX };