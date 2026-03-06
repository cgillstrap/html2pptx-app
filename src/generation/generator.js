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
// Our addition: multi-slide loop using extraction data from our slide
// detection layer.
//
// Contract:
//   Input:  Multi-slide extraction result + output path + options
//   Output: { outputPath, slideCount }
//   Throws: If pptxgenjs fails to generate or write
// ============================================================================

'use strict';

const PptxGenJS = require('pptxgenjs');
const path = require('path');
const { getConfig } = require('../main/config');

const PX_PER_IN = 96;

/**
 * Adds background to a pptxgenjs slide.
 * Ported from html2pptx-local.cjs addBackground().
 *
 * @param {object} slideData - Per-slide extraction data
 * @param {object} targetSlide - pptxgenjs slide object
 * @param {string} htmlDir - Directory of source HTML for resolving image paths
 */
function addBackground(slideData, targetSlide, htmlDir) {
  const bg = slideData.background;
  if (!bg) return;

  if (bg.type === 'image' && bg.path) {
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
  } else if (bg.type === 'color' && bg.value) {
    targetSlide.background = { color: bg.value };
  }
}

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

    // Background
    addBackground(slideData, targetSlide, htmlDir);

    // Speaker notes
    if (slideData.title) {
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