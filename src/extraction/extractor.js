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
// Our addition on top of the original: multi-slide detection. The original
// assumes one HTML file = one slide. We detect slide boundaries first, then
// run the original's extraction logic per slide container.
//
// Key Decisions:
// - The EXTRACTION_SCRIPT is a faithful port of extractSlideData() from
//   html2pptx-local.cjs, adapted to run on a per-container basis
// - Slide detection: data-slide-number → section.slide → div.slide →
//   section children → uniform divs → body fallback
// - Element bounds are relative to the slide container
// - Validation errors are collected and returned (not thrown) so the
//   app can display them to the user
//
// Contract:
//   Input:  Absolute path to an HTML file
//   Output: { slideCount, detectionMethod, slides: [{ ... }] }
//   Throws: If file cannot be loaded or script fails catastrophically
// ============================================================================

'use strict';

const { BrowserWindow } = require('electron');
const path = require('path');
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

  // ── Per-container extraction (core of original extractSlideData) ──

  function extractSlideData(container, containerRect) {
    const elements = [];
    const placeholders = [];
    const errors = [];
    const textTags = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI'];
    const processed = new Set();

    // Background
    const containerStyle = window.getComputedStyle(container);
    const bgImage = containerStyle.backgroundImage;
    const bgColor = containerStyle.backgroundColor;

    let background;
    if (bgImage && bgImage !== 'none') {
      const urlMatch = bgImage.match(/url\\(["']?([^"')]+)["']?\\)/);
      if (urlMatch) {
        background = { type: 'image', path: urlMatch[1] };
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

      // Skip if outside this container (for body-fallback with multi-slide)
      if (!container.contains(el)) return;

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

      // DIV shapes
      const isContainer = el.tagName === 'DIV' && !textTags.includes(el.tagName);
      if (isContainer) {
        const computed = window.getComputedStyle(el);
        const hasBg = computed.backgroundColor && computed.backgroundColor !== 'rgba(0, 0, 0, 0)';

        const borderTop = computed.borderTopWidth;
        const borderRight = computed.borderRightWidth;
        const borderBottom = computed.borderBottomWidth;
        const borderLeft = computed.borderLeftWidth;
        const borders = [borderTop, borderRight, borderBottom, borderLeft].map(b => parseFloat(b) || 0);
        const hasBorder = borders.some(b => b > 0);
        const hasUniformBorder = hasBorder && borders.every(b => b === borders[0]);
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

        if (hasBg || hasBorder) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const shadow = parseBoxShadow(computed.boxShadow);
            if (hasBg || hasUniformBorder) {
              elements.push({
                type: 'shape', text: '',
                position: {
                  x: pxToInch(rect.left - offX), y: pxToInch(rect.top - offY),
                  w: pxToInch(rect.width), h: pxToInch(rect.height)
                },
                shape: {
                  fill: hasBg ? rgbToHex(computed.backgroundColor) : null,
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
                }
              });
            }
            elements.push(...borderLines);
            processed.add(el);
            return;
          }
        }

        // ── Div text fallback (our addition to the original) ─────
        // If a div has text content but no block-level children and was
        // not processed as a shape above, extract it as a text element.
        // This handles AI-generated HTML that puts text directly in divs
        // (e.g., <div class="title">Quarterly Review</div>).
        // The generator decides whether to render these based on config.
        if (!processed.has(el)) {
          const BLOCK_TAGS_SET = new Set([
            'DIV','SECTION','ARTICLE','MAIN','HEADER','FOOTER','NAV',
            'UL','OL','LI','FIGURE','ASIDE','FORM','FIELDSET','DETAILS',
            'TABLE','THEAD','TBODY','TR','H1','H2','H3','H4','H5','H6',
            'P','BLOCKQUOTE','PRE','HR','ADDRESS'
          ]);
          let hasBlockChild = false;
          for (const child of el.children) {
            if (BLOCK_TAGS_SET.has(child.tagName)) { hasBlockChild = true; break; }
          }

          const directText = Array.from(el.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent.trim())
            .filter(t => t.length > 0)
            .join(' ');

          // Extract if: has direct text or inline-only children with text
          const fullText = el.textContent ? el.textContent.trim() : '';
          if (!hasBlockChild && fullText.length > 0) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
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

              const trans = extractAlpha(computed.color);
              if (trans !== null) baseStyle.transparency = trans;
              if (rotation !== null) baseStyle.rotate = rotation;

              const hasFormatting = el.querySelector('b, i, u, strong, em, span');

              if (hasFormatting) {
                const runs = parseInlineFormatting(el);
                const textTransform = computed.textTransform;
                const transformedRuns = runs.map(run => ({
                  ...run, text: applyTextTransform(run.text, textTransform)
                }));
                elements.push({
                  type: 'div-text', isDivFallback: true, text: transformedRuns,
                  position: { x: pxToInch(pos.x - offX), y: pxToInch(pos.y - offY), w: pxToInch(pos.w), h: pxToInch(pos.h) },
                  style: baseStyle
                });
              } else {
                const isBold = computed.fontWeight === 'bold' || parseInt(computed.fontWeight) >= 600;
                const textTransform = computed.textTransform;
                elements.push({
                  type: 'div-text', isDivFallback: true, text: applyTextTransform(fullText, textTransform),
                  position: { x: pxToInch(pos.x - offX), y: pxToInch(pos.y - offY), w: pxToInch(pos.w), h: pxToInch(pos.h) },
                  style: {
                    ...baseStyle,
                    bold: isBold && !shouldSkipBold(computed.fontFamily),
                    italic: computed.fontStyle === 'italic',
                    underline: computed.textDecoration.includes('underline')
                  }
                });
              }
              processed.add(el);
              return;
            }
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
        liElements.forEach(li => processed.add(li));
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
      processed.add(el);
    });

    return { background, elements, placeholders, errors };
  }

  // ── Multi-slide detection (our addition) ─────────────────────

  const body = document.body;
  if (!body) throw new Error('Document has no <body> element.');

  const bodyStyle = window.getComputedStyle(body);

  function detectSlideContainers() {
    let containers = Array.from(body.querySelectorAll('[data-slide-number]'));
    if (containers.length > 1) {
      containers.sort((a, b) => parseInt(a.dataset.slideNumber) - parseInt(b.dataset.slideNumber));
      return { containers, method: 'data-slide-number' };
    }
    containers = Array.from(body.querySelectorAll('section.slide, div.slide'));
    if (containers.length > 1) return { containers, method: 'class-slide' };

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
    await hiddenWindow.loadFile(htmlFilePath);

    // Allow layout to settle
    await new Promise(resolve => setTimeout(resolve, 300));

    // Set viewport to match body dimensions for accurate rendering
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

    const result = await hiddenWindow.webContents.executeJavaScript(EXTRACTION_SCRIPT);

    if (!result || !result.slides || result.slides.length === 0) {
      throw new Error('Extraction returned no slide data.');
    }

    console.log(
      `[Extractor] ${path.basename(htmlFilePath)}: ` +
      `${result.slideCount} slide(s) via "${result.detectionMethod}"`
    );

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