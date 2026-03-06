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
// Key Changes (Session 3):
// - Scale-to-fit: when extracted elements extend beyond the slide viewport,
//   uniform scaling is applied to all positions, sizes, and font sizes so
//   content fits within the slide boundary. A warning is emitted whenever
//   scaling is applied. This is a generator concern (not extractor) because
//   the extractor's job is faithful capture; the generator's job is to map
//   content to the output format's constraints.
//
// Key Changes (Session 2):
// - Speaker notes: use data-notes attribute when present, breadcrumb fallback
// - addBackground: handle data URI backgrounds from gradient rasterisation
//   (capturePage in extractor.js) alongside file path backgrounds
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
 * Scans all element positions (including lines and placeholders) to find
 * the maximum extent in both dimensions. If content exceeds the viewport
 * (minus tolerance), returns the scale factor needed to fit plus the
 * x/y offsets to centre the scaled content on the slide.
 *
 * Uses the tighter of the two dimensions so that content fits in both
 * directions after uniform scaling.
 *
 * Also computes the minimum origin (smallest x/y) so that centering
 * accounts for content that doesn't start at 0,0.
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

  // No elements — nothing to scale or centre
  if (maxR === 0 && maxB === 0) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }

  const scaleX = maxR > vpW + SCALE_TOLERANCE_IN ? vpW / maxR : 1;
  const scaleY = maxB > vpH + SCALE_TOLERANCE_IN ? vpH / maxB : 1;
  const scale = Math.min(scaleX, scaleY);

  if (scale >= 1) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }

  // After scaling, compute the new bounding box and centre it.
  // Content span is (max - min) in each dimension; after scaling
  // the span shrinks, and we distribute the remaining space evenly.
  const scaledW = (maxR - minL) * scale;
  const scaledH = (maxB - minT) * scale;
  const scaledMinL = minL * scale;
  const scaledMinT = minT * scale;

  // The offset shifts all content so the scaled bounding box is
  // centred within the viewport. We account for the existing origin
  // (scaledMinL/T) so content that started with padding from the
  // left/top edge stays balanced.
  const offsetX = (vpW - scaledW) / 2 - scaledMinL;
  const offsetY = (vpH - scaledH) / 2 - scaledMinT;

  return { scale, offsetX, offsetY };
}

/**
 * Applies a uniform scale factor and centering offsets to all positions,
 * sizes, font sizes, and spacing values in a slide's element and
 * placeholder data.
 *
 * Mutates the slideData in place. This is safe because the extraction
 * result is consumed once and not reused.
 *
 * Scaled properties:
 *   - Element positions (x, y, w, h) in inches — then offset for centering
 *   - Line coordinates (x1, y1, x2, y2) and width
 *   - Shape border width, corner radius, shadow blur/offset
 *   - Font size, line spacing, paragraph spacing, margins (points)
 *   - Inline text run font sizes (points)
 *   - List bullet indentation (points)
 *   - Placeholder positions (x, y, w, h) in inches
 *
 * NOT scaled: backgrounds (fill the slide regardless of content size)
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
    // Text elements and div-text fallbacks can have an array of
    // runs, each with their own fontSize from parseInlineFormatting().
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
 * Ported from html2pptx-local.cjs addBackground(), extended to handle
 * data URI backgrounds from gradient rasterisation (Session 2).
 *
 * Background types:
 *   - { type: 'image', data: 'data:image/png;...' }  → gradient capture (data URI)
 *   - { type: 'image', path: './bg.png' }             → file reference from CSS url()
 *   - { type: 'color', value: '1B2A4A' }              → solid colour
 *
 * @param {object} slideData - Per-slide extraction data
 * @param {object} targetSlide - pptxgenjs slide object
 * @param {string} htmlDir - Directory of source HTML for resolving image paths
 */
function addBackground(slideData, targetSlide, htmlDir) {
  const bg = slideData.background;
  if (!bg) return;

  if (bg.type === 'image') {
    // Data URI backgrounds (from gradient rasterisation via capturePage).
    // These are self-contained PNG data — no file path to resolve or validate.
    if (bg.data) {
      targetSlide.background = { data: bg.data };
      return;
    }

    // File path backgrounds (from CSS url() references in the HTML).
    // Subject to path resolution and security checks.
    if (bg.path) {
      let imagePath = bg.path.startsWith('file://')
        ? bg.path.replace('file://', '')
        : bg.path;

      // Security: block remote URLs
      if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
        console.warn(`[Generator] Skipped remote background image: ${imagePath}`);
        return;
      }

      // Resolve relative paths against HTML directory
      if (!path.isAbsolute(imagePath)) {
        imagePath = path.resolve(htmlDir, imagePath);
      }

      // Security: verify path doesn't escape htmlDir
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
 * This is the core rendering function. It handles:
 *   - Images with local path resolution
 *   - Lines (for partial borders)
 *   - Shapes (divs with background/border/shadow)
 *   - Lists (UL/OL with bullet formatting and text runs)
 *   - Text (P, H1-H6 with inline formatting runs)
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

      // Handle file:// protocol
      if (imagePath.startsWith('file://')) {
        imagePath = imagePath.replace('file://', '');
      }

      // Security: skip remote images
      if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
        console.warn(`[Generator] Skipped remote image: ${imagePath}`);
        continue;
      }

      // Data URIs pass through directly
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

    // ── Shapes (divs with bg/border) ───────────────────────────
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
        // Skip — original behaviour
        continue;
      }
      // Render as text using the same logic as P/H1-H6 below
      // (falls through to the text rendering block)
    }

    // ── Text (P, H1-H6, and div-text fallback) ────────────────
    // Single-line width adjustment: 2% wider to prevent clipping
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
      inset: 0  // Remove default PowerPoint internal padding
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
 * In the original pipeline, placeholders are invisible positions for chart
 * insertion. In our standalone app, we optionally render them so users can
 * see where charts/tables would go.
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

  // Use the first slide's viewport as the presentation layout
  const firstVP = slides[0].viewport;
  const layoutW = firstVP.w / PX_PER_IN;
  const layoutH = firstVP.h / PX_PER_IN;
  pres.defineLayout({ name: 'CUSTOM', width: layoutW, height: layoutH });
  pres.layout = 'CUSTOM';

  for (let i = 0; i < slides.length; i++) {
    const slideData = slides[i];
    const targetSlide = pres.addSlide();

    // Collect any extraction warnings
    if (slideData.errors && slideData.errors.length > 0) {
      slideData.errors.forEach(err => {
        warnings.push(`Slide ${i + 1}: ${err}`);
      });
    }

    // ── Scale-to-fit with centering (Session 3) ────────────
    // Check if extracted elements exceed the slide viewport.
    // If so, apply uniform scaling to all positions, sizes, and
    // font sizes, then centre the scaled content on the slide.
    // This preserves layout proportions at the cost of smaller text.
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

    // Background (not affected by scaling — fills the slide)
    addBackground(slideData, targetSlide, htmlDir);

    // Speaker notes: prefer author-supplied data-notes, fall back to breadcrumb
    const authorNotes = slideData.dataAttributes && slideData.dataAttributes.notes;
    if (authorNotes) {
      targetSlide.addNotes(authorNotes);
    } else if (slideData.title) {
      targetSlide.addNotes('Slide ' + (i + 1) + ': ' + slideData.title);
    }

    // Elements
    addElements(slideData, targetSlide, pres, htmlDir);

    // Placeholders (rendered as visible shapes if configured)
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