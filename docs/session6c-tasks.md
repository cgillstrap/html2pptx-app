# Session 6c — SVG Rasterisation & Element Gradient Rasterisation

## Context

Two related enhancements that both use `capturePage()` to convert browser-rendered visual elements into raster images for PPTX output. The pattern is already proven for slide-level gradient backgrounds (Sessions 2–3). These tasks extend it to individual elements.

**SVG rasterisation:** Inline `<svg>` elements (icons, arrows, decorative graphics) are currently skipped with a warning (Session 6). This task captures them as PNG images via `capturePage()` so they appear in the PPTX output.

**Element gradient rasterisation:** Elements with CSS gradient backgrounds currently fall back to a solid colour extracted from the first gradient colour stop (Session 4). This task captures the actual rendered gradient as a PNG image and uses it as the shape's fill, preserving visual fidelity while still rendering text on top.

Both require changes in the same two locations: the EXTRACTION_SCRIPT (to emit capture markers instead of skipping/falling back) and the `extractFromHTML()` function (to capture images after extraction but before the hidden window is destroyed).

**Reference files:** `src/extraction/extractor.js`, `src/generation/generator.js`
**Existing pattern:** The `captureGradients()` function in `extractor.js` is the template for this work.
**Principles:** Read `PRINCIPLES.md` and `claude.md`. No new dependencies. Security controls unchanged.

---

## Task 1: SVG Rasterisation

### Part A: Extraction Script Changes

**Current behaviour:** SVGs are detected, all descendants marked as processed, and a summary warning is emitted. No element is added to the extraction output.

**New behaviour:** SVGs are detected, descendants marked as processed, but instead of just warning, emit a placeholder element with position data that signals "capture needed".

**Location:** In the EXTRACTION_SCRIPT, in the SVG handling block inside `extractSlideData()`.

**Change the SVG handler from:**
```javascript
if (el.tagName === 'svg' || el instanceof SVGElement) {
  el.querySelectorAll('*').forEach(function(child) { processed.add(child); });
  processed.add(el);
  if (el.tagName === 'svg') svgSkipCount++;
  return;
}
```

**To:**
```javascript
// Handle both 'svg' (HTML doc) and 'SVG' tag names
if (el.tagName === 'svg' || el.tagName === 'SVG' || el instanceof SVGElement) {
  el.querySelectorAll('*').forEach(function(child) { processed.add(child); });
  processed.add(el);
  // Only emit capture placeholder for top-level SVGs, not their children
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
```

**Key points:**
- `position` is in inches (relative to container) for the generator to place the image
- `captureRect` is in pixels (absolute page coordinates) for `capturePage()` to use
- Only top-level `<svg>` elements get placeholders, not their children
- The `svgSkipCount` and warning message are preserved but the wording should change from "skipped" to "captured as images" (update the warning text at the end of the function)

**Update the SVG warning message:**
```javascript
if (svgSkipCount > 0) {
  errors.push(
    svgSkipCount + ' inline SVG element(s) captured as raster images. ' +
    'These will appear as non-editable images in the PPTX.'
  );
}
```

---

### Part B: Element Gradient Extraction Changes

**Current behaviour:** When an element has a CSS gradient background, the extractor emits a warning and uses `resolveShapeFill()` to extract the first colour stop as a solid fill.

**New behaviour:** In addition to the solid fallback, emit a `captureRect` on the shape element so the post-extraction capture step knows to rasterise this element's background.

**Location:** In the EXTRACTION_SCRIPT, in the DIV shape handling section where `hasGradient` is detected.

**After the existing gradient warning, when building the shape element, add `captureRect`:**

Find the section where the shape element is pushed to `elements` (inside `if (hasVisualFill || hasUniformBorder)`). When `hasGradient` is true, add the capture rect to the element:

```javascript
// Inside the shape element construction, add captureRect when gradient is present
elements.push({
  type: 'shape', text: shapeText,
  position: { /* ... existing ... */ },
  shape: { /* ... existing ... */ },
  style: shapeStyle,
  // Signal for post-extraction capture — only present when element has gradient
  captureRect: hasGradient ? {
    x: rect.left,
    y: rect.top,
    w: rect.width,
    h: rect.height
  } : undefined
});
```

**Also apply the same to inline elements (SPAN/A/LABEL) with gradients.** In the inline element block where `inlineHasGradient` is true, add `captureRect`:

```javascript
elements.push({
  type: 'shape',
  text: /* ... existing ... */,
  position: { /* ... existing ... */ },
  shape: { /* ... existing ... */ },
  style: { /* ... existing ... */ },
  captureRect: inlineHasGradient ? {
    x: inlineRect.left,
    y: inlineRect.top,
    w: inlineRect.width,
    h: inlineRect.height
  } : undefined
});
```

**Important:** The solid fallback fill is STILL set in `shape.fill`. This is the fallback if capture fails. The capture step will replace it with the raster image on success.

---

### Part C: Post-Extraction Capture Function

**Location:** `src/extraction/extractor.js`, outside the EXTRACTION_SCRIPT, as a new function alongside `captureGradients()`.

**Create `captureElementImages()`:**

```javascript
/**
 * Captures inline SVGs and gradient element backgrounds from the hidden
 * window via capturePage(). SVGs are captured as-is. Gradient elements
 * have their children hidden before capture to isolate the background.
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

  for (const slide of result.slides) {
    for (let i = 0; i < slide.elements.length; i++) {
      const el = slide.elements[i];

      // ── SVG Capture ──────────────────────────────────────
      if (el.type === 'svg-capture') {
        try {
          const nativeImage = await hiddenWindow.webContents.capturePage({
            x: Math.round(el.captureRect.x),
            y: Math.round(el.captureRect.y),
            width: Math.round(el.captureRect.w),
            height: Math.round(el.captureRect.h)
          });

          if (nativeImage.isEmpty()) {
            throw new Error('capturePage returned empty image for SVG');
          }

          const dataUri = nativeImage.toDataURL();

          // Replace svg-capture placeholder with an image element
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
          // Remove the failed svg-capture element
          slide.elements.splice(i, 1);
          i--; // Adjust index after splice
          svgsFailed++;
        }
        continue;
      }

      // ── Element Gradient Capture ─────────────────────────
      if (el.type === 'shape' && el.captureRect) {
        try {
          // Hide the element's children so we capture only the background
          await hiddenWindow.webContents.executeJavaScript(`
            (function() {
              // Find element by its absolute position (captureRect coordinates)
              var targetRect = { x: ${el.captureRect.x}, y: ${el.captureRect.y},
                                 w: ${el.captureRect.w}, h: ${el.captureRect.h} };
              var all = document.querySelectorAll('*');
              for (var i = 0; i < all.length; i++) {
                var r = all[i].getBoundingClientRect();
                if (Math.abs(r.left - targetRect.x) < 2 &&
                    Math.abs(r.top - targetRect.y) < 2 &&
                    Math.abs(r.width - targetRect.w) < 2 &&
                    Math.abs(r.height - targetRect.h) < 2) {
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

          await new Promise(resolve => setTimeout(resolve, 30));

          const nativeImage = await hiddenWindow.webContents.capturePage({
            x: Math.round(el.captureRect.x),
            y: Math.round(el.captureRect.y),
            width: Math.round(el.captureRect.w),
            height: Math.round(el.captureRect.h)
          });

          // Restore children visibility
          await hiddenWindow.webContents.executeJavaScript(`
            (function() {
              var all = document.querySelectorAll('[data-_gc-prev-vis]');
              // Fallback: find by dataset property
              document.querySelectorAll('*').forEach(function(el) {
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

          if (nativeImage.isEmpty()) {
            throw new Error('capturePage returned empty image for gradient element');
          }

          const dataUri = nativeImage.toDataURL();

          // Replace the shape's solid fill with the captured gradient image
          el.shape.fillImage = dataUri;
          // Remove the captureRect — no longer needed
          delete el.captureRect;

          gradientsCaptured++;
          console.log(
            `[Extractor] Slide ${slide.index + 1}: element gradient captured as PNG ` +
            `(${Math.round(el.captureRect ? el.captureRect.w : 0)}×${Math.round(el.captureRect ? el.captureRect.h : 0)}px)`
          );

        } catch (err) {
          // Best-effort restore
          try {
            await hiddenWindow.webContents.executeJavaScript(`
              (function() {
                document.querySelectorAll('*').forEach(function(el) {
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
          } catch (_) { /* best effort */ }

          console.warn(
            `[Extractor] Slide ${slide.index + 1}: element gradient capture failed — ` +
            `keeping solid fallback. ${err.message}`
          );
          // Keep the solid fallback fill — just clean up the captureRect
          delete el.captureRect;
          gradientsFailed++;
        }
      }
    }
  }

  return { svgsCaptured, svgsFailed, gradientsCaptured, gradientsFailed };
}
```

**Note on the console.log for gradient capture:** There's a subtle bug in the code above — the `console.log` references `el.captureRect` after it's been deleted. Claude Code should fix this by logging the dimensions before deleting captureRect, or storing them in local variables first.

---

### Part D: Wire Into extractFromHTML()

**Location:** In `extractFromHTML()`, after the existing `captureGradients()` call.

Add the element-level capture call:

```javascript
// Existing gradient capture code...
if (hasGradients) {
  const gradientResult = await captureGradients(result, hiddenWindow);
  console.log(
    `[Extractor] Gradient capture: ${gradientResult.captured} succeeded, ` +
    `${gradientResult.failed} fell back to solid colour`
  );
}

// NEW: Element-level captures (SVGs and gradient elements)
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
```

**Order matters:** `captureGradients()` runs first (slide-level backgrounds), then `captureElementImages()` (element-level). Both complete before the hidden window is destroyed.

---

### Part E: Generator Changes for Gradient Image Fill

**Location:** `src/generation/generator.js`, in the shape rendering section of `addElements()`.

The generator needs to handle the new `shape.fillImage` property. When present, it should use the image as the shape's fill instead of the solid colour.

**In the shape handling block, after the existing fill logic:**

```javascript
if (el.shape.fill) {
  shapeOpts.fill = { color: el.shape.fill };
  if (el.shape.transparency != null) shapeOpts.fill.transparency = el.shape.transparency;
}
```

**Add image fill override:**

```javascript
if (el.shape.fill) {
  shapeOpts.fill = { color: el.shape.fill };
  if (el.shape.transparency != null) shapeOpts.fill.transparency = el.shape.transparency;
}

// Override with captured gradient image if available
if (el.shape.fillImage) {
  shapeOpts.fill = { data: el.shape.fillImage };
}
```

**PptxGenJS fill with data URI:** PptxGenJS supports `fill: { data: 'data:image/png;base64,...' }` for image fills on shapes. This fills the shape with the image, and text still renders on top via `addText()`. The shape's border, radius, and shadow are preserved.

**SVG images require no generator changes** — they're converted to standard `image` type elements in the capture step, and the existing image handling in `addElements()` already supports data URI sources.

---

## Validation

### Primary Checks

| Fixture | What to check |
|---------|--------------|
| `hr-skills-slide.html` | Column header SVG icons now appear as small images. SVG capture count in console output. |
| `modern-it-skills.html` | Row label SVG icons and arrow SVGs now appear as images. All 12 SVGs captured. |
| `agile-slides.html` | Gradient backgrounds on badge/pill elements now show the actual gradient rather than a solid colour approximation. Divider bars show gradient. Slide-level gradients still work. |
| `multi-slide-test.html` | Slide 1 gradient background still captures correctly (slide-level). Any element gradients captured. |

### Regression Checks

| Fixture | What to check |
|---------|--------------|
| `sample-slide.html` | No SVGs, no gradients on elements. Output unchanged. |
| `lpm-slides-v1.html` | No SVGs. Blue accent colour on metric values preserved (these are solid colours, not gradients). |
| `conformant_sample.html` | No SVGs, no element gradients. Output unchanged. |

### Specific Risks

1. **capturePage() coordinate accuracy after transform stripping (Session 6).** The transform stripping runs before extraction, so `captureRect` coordinates from the extraction script are in native (un-transformed) space. `capturePage()` also operates in the same space since transforms are already stripped. Should be consistent, but verify on `hr-skills-slide.html`.

2. **Element finding by position match.** The gradient capture uses bounding rect matching to find the target element in the DOM. This could match the wrong element if two elements have identical positions and sizes. The tolerance of 2px makes this unlikely but not impossible. If issues arise, an alternative is to assign data attributes during extraction for more precise element targeting.

3. **Shape fill image + text interaction in PptxGenJS.** Verify that `addText()` with both `fill: { data: '...' }` and text content renders correctly — text should appear on top of the image fill. If PptxGenJS doesn't support this combination, the fallback is to add the gradient as a separate image element behind the shape, and make the shape's fill transparent.

4. **Gradient capture on stacked slides (agile-slides).** The gradient elements on agile-slides are inside position:absolute containers. The session 6 transform stripping is scoped to ancestors, so content transforms are preserved. Verify that the hide-children logic for gradient capture doesn't interfere with the slide-level gradient capture's hide-all-containers logic.

---

## Execution Order

Implement in this order:
1. **Part A** — SVG extraction script changes (emit capture placeholders)
2. **Part C** — `captureElementImages()` function (SVG capture portion only)
3. **Part D** — Wire into `extractFromHTML()`
4. **Validate SVGs** — Convert `hr-skills-slide.html`, confirm icons appear as images
5. **Part B** — Element gradient extraction script changes (add captureRect to shapes)
6. **Part C continued** — Complete gradient capture portion of `captureElementImages()`
7. **Part E** — Generator changes for fillImage
8. **Validate gradients** — Convert `agile-slides.html`, confirm gradient fills
9. **Full regression** — All fixtures

This order lets you validate SVGs independently before adding gradient complexity.

---

## Progress.md Updates

**File Status table:**
- `extractor.js` updated to Session 6c
- `generator.js` updated to Session 6c

**Phase 3b checklist — add:**
- [x] **SVG rasterisation (Session 6c)**: Inline SVGs captured as PNG images via `capturePage()`. Extraction emits `svg-capture` placeholder elements with position and capture rect. Post-extraction step captures each SVG's rendered pixels and replaces placeholder with standard image element.
- [x] **Element gradient rasterisation (Session 6c)**: Elements with CSS gradient backgrounds captured via `capturePage()` with children hidden. Captured PNG used as shape image fill in PptxGenJS. Text still renders on top. Solid colour fallback preserved for capture failures.

**Move from 3e to 3b:**
- Element-level gradient rasterisation is now implemented, not a future consideration.

**Key Decisions — add:**
- **Single capture pass for SVGs and gradients** — Both element-level capture types use `capturePage()` and run in the same post-extraction phase while the hidden window is still open. A single `captureElementImages()` function handles both, avoiding duplicate DOM iteration.
- **Gradient capture hides children, not siblings** — Unlike slide-level gradient capture (which hides all containers), element-level gradient capture only hides the target element's children. This isolates the background gradient from foreground text content.
- **JSON contract extended: `captureRect` on elements, `fillImage` on shapes** — `captureRect` is transient (removed after capture). `fillImage` is consumed by the generator as an alternative to solid fill colour.

**Key Learnings — add:**
- PptxGenJS supports image fills on shapes via `fill: { data: 'data:image/...' }`. Text renders on top of image fills, enabling gradient backgrounds with readable text.
- Element-level `capturePage()` uses the same coordinate space as slide-level capture. Transform stripping (Session 6) ensures both extraction coordinates and capture coordinates are in native layout space.
