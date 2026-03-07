# Task: Replace content-hiding with clone-based gradient capture

## Problem

Slide-level gradient capture on taxonomy-deck-html.html produces images with text content baked in, despite multiple hiding approaches (visibility:hidden, display:none, overlays). The root cause is that hiding children in place fights with CSS specificity, compositor timing, pseudo-elements, and stacking contexts. Four separate hiding strategies have all failed on this fixture.

## Solution

Instead of hiding children within the real slide container, create a temporary empty div that reproduces only the gradient background, capture that, then remove it. An element with no children, no text, and no pseudo-elements has nothing to leak.

## Change: `captureGradients()` in `src/extraction/extractor.js`

Replace the entire hide/show/capture sequence inside the `try` block with a clone-based approach. The overall structure of the function stays the same — the loop, the error handling, the restore logic, the fallback path. Only the capture strategy changes.

Here is the new approach for the core of the `try` block (replacing everything between `try {` and the `nativeImage.isEmpty()` check):

```javascript
try {
  // Hide ALL containers so only our clone is visible in the capture area.
  // This prevents other slides from appearing in the captured region,
  // which matters for stacked layouts where containers may overlap.
  await hiddenWindow.webContents.executeJavaScript(`
    (function() {
      var containers = ${RESOLVE_CONTAINERS_JS};
      for (var i = 0; i < containers.length; i++) {
        var c = containers[i];
        c.dataset._prevOpacity = c.style.opacity || '';
        c.dataset._prevVisibility = c.style.visibility || '';
        c.style.opacity = '0';
        c.style.visibility = 'hidden';
      }
    })()
  `);

  // Re-query the target container's bounding rect and computed gradient
  // at capture time. Coordinates may have shifted since extraction due
  // to display-none fix, position changes, or window resizing.
  // Also read the gradient background so the clone reproduces it exactly.
  const captureInfo = await hiddenWindow.webContents.executeJavaScript(`
    (function() {
      var containers = ${RESOLVE_CONTAINERS_JS};
      var target = containers[${slideIndex}];
      if (!target) return null;
      var r = target.getBoundingClientRect();
      var cs = window.getComputedStyle(target);
      return {
        x: r.left, y: r.top, w: r.width, h: r.height,
        backgroundImage: cs.backgroundImage,
        backgroundColor: cs.backgroundColor,
        borderRadius: cs.borderRadius
      };
    })()
  `);

  if (!captureInfo || captureInfo.w === 0 || captureInfo.h === 0) {
    throw new Error('Target container not found or has zero dimensions at capture time');
  }

  if (Math.abs(captureInfo.x - rect.x) > 1 || Math.abs(captureInfo.y - rect.y) > 1) {
    console.log(
      '[Extractor] Slide ' + (slide.index + 1) + ': capture rect shifted — ' +
      'stored (' + Math.round(rect.x) + ',' + Math.round(rect.y) + ') → ' +
      'fresh (' + Math.round(captureInfo.x) + ',' + Math.round(captureInfo.y) + ')'
    );
  }

  // Create a temporary empty div with ONLY the gradient background.
  // This is the key insight: instead of hiding content inside the
  // real container (which fights CSS specificity, compositor timing,
  // pseudo-elements, and stacking contexts), we create a clean element
  // with nothing to leak. No children, no text, no ::before/::after.
  await hiddenWindow.webContents.executeJavaScript(`
    (function() {
      var clone = document.createElement('div');
      clone.id = '__gradient_capture_clone__';
      clone.style.cssText =
        'position:absolute;' +
        'left:' + ${captureInfo.x} + 'px;' +
        'top:' + ${captureInfo.y} + 'px;' +
        'width:' + ${captureInfo.w} + 'px;' +
        'height:' + ${captureInfo.h} + 'px;' +
        'background-image:' + '${captureInfo.backgroundImage.replace(/'/g, "\\'")}' + ';' +
        'background-color:' + '${captureInfo.backgroundColor.replace(/'/g, "\\'")}' + ';' +
        'border-radius:' + '${captureInfo.borderRadius}' + ';' +
        'z-index:2147483647;' +
        'pointer-events:none;' +
        'margin:0;padding:0;border:none;' +
        'overflow:hidden;';
      document.body.appendChild(clone);
    })()
  `);

  await new Promise(resolve => setTimeout(resolve, 50));

  const nativeImage = await hiddenWindow.webContents.capturePage({
    x: Math.round(captureInfo.x),
    y: Math.round(captureInfo.y),
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
        c.style.opacity = c.dataset._prevOpacity || '';
        c.style.visibility = c.dataset._prevVisibility || '';
        delete c.dataset._prevOpacity;
        delete c.dataset._prevVisibility;
      }
    })()
  `);

  if (nativeImage.isEmpty()) {
    throw new Error('capturePage returned empty image');
  }
```

### Important implementation note: escaping CSS values

The `backgroundImage` value contains CSS gradient strings with parentheses, commas, and potentially single quotes. When interpolating into the template literal for `executeJavaScript()`, these need to be safe for JavaScript string embedding. The approach above uses `replace(/'/g, "\\\\'")` but this may not be sufficient for all gradient formats.

A **safer approach** is to pass the values via a separate `executeJavaScript` call that sets them on a temporary global, or to build the style properties individually:

```javascript
// Safer: set style properties individually rather than via cssText interpolation
await hiddenWindow.webContents.executeJavaScript(`
  (function() {
    var clone = document.createElement('div');
    clone.id = '__gradient_capture_clone__';
    clone.style.position = 'absolute';
    clone.style.left = '${captureInfo.x}px';
    clone.style.top = '${captureInfo.y}px';
    clone.style.width = '${captureInfo.w}px';
    clone.style.height = '${captureInfo.h}px';
    clone.style.zIndex = '2147483647';
    clone.style.pointerEvents = 'none';
    clone.style.margin = '0';
    clone.style.padding = '0';
    clone.style.border = 'none';
    clone.style.overflow = 'hidden';
    // Read gradient from the actual target to avoid string escaping issues
    var containers = ${RESOLVE_CONTAINERS_JS};
    var target = containers[${slideIndex}];
    if (target) {
      var cs = window.getComputedStyle(target);
      clone.style.backgroundImage = cs.backgroundImage;
      clone.style.backgroundColor = cs.backgroundColor;
      clone.style.borderRadius = cs.borderRadius;
    }
    document.body.appendChild(clone);
  })()
`);
```

**Use this safer approach.** It reads the gradient directly from the DOM inside the browser context, eliminating all string escaping risks. The `captureInfo` return then only needs `x, y, w, h` for the `capturePage()` call and the coordinate shift logging.

### Error/cleanup path

The `catch` block needs to clean up the clone if it was created, plus restore containers:

```javascript
catch (err) {
  try {
    await hiddenWindow.webContents.executeJavaScript(`
      (function() {
        var clone = document.getElementById('__gradient_capture_clone__');
        if (clone) clone.remove();
        var containers = ${RESOLVE_CONTAINERS_JS};
        for (var i = 0; i < containers.length; i++) {
          var c = containers[i];
          if (c.dataset._prevOpacity !== undefined) {
            c.style.opacity = c.dataset._prevOpacity || '';
            c.style.visibility = c.dataset._prevVisibility || '';
            delete c.dataset._prevOpacity;
            delete c.dataset._prevVisibility;
          }
        }
      })()
    `);
  } catch (_) { /* best effort */ }
  // ... rest of error handling unchanged
}
```

## What does NOT change

- **`captureElementImages()`** — Element-level gradient capture still uses the hide-children approach. That works correctly on all fixtures because element-level gradients haven't gone through the display-none fix path.
- **`EXTRACTION_SCRIPT`** — No changes to extraction logic.
- **`extractFromHTML()`** — The display-none fix, transform stripping, re-measurement — all unchanged.
- **The generator** — No changes needed.
- **The `captureInfo` fresh rect query** — Keep this. It's needed for clone positioning and is good defensive practice from Session 7b.

## Validation

Run the app against all fixtures and confirm:

1. **taxonomy-deck-html.html**: 8 slides. Gradient backgrounds should be **clean — no text duplication**. This is the key validation. Open the PPTX and check that slide titles/content appear once, not doubled.
2. **multi-slide-test.html**: 3 slides, gradient on slide 1 should be captured cleanly (this already works — confirm no regression).
3. **agile-slides.html**: 3 slides, gradient capture clean, badge/shape text present, no regression.
4. **hr-skills-slide.html**: 1 slide, SVG rasterisation + gradient banner, no regression.
5. **lpm-slides-v1.html**: 12 slides, no regression.
6. **conformant_sample.html**: 3 slides, no regression.
7. **sample-slide.html**: 1 slide, no regression.
8. **modern-it-skills.html**: 1 slide, no regression.

Report: detection method, slide count, element count, gradient capture results, and specific confirmation that taxonomy-deck slide backgrounds are text-free.

## progress.md update

After validation:

1. Update File Status for `extractor.js` — "Clone-based gradient capture replaces content-hiding approach"
2. Mark the taxonomy gradient capture issue as **RESOLVED** in the 3b checklist
3. Add to Session 7 decisions: **"Clone-based gradient capture replaces in-place content hiding"** — Instead of hiding children inside the real slide container (which fights CSS specificity, compositor timing, pseudo-elements, and stacking contexts), `captureGradients()` now creates a temporary empty div that reproduces only the gradient background. An element with no children has nothing to leak. This resolved the taxonomy-deck text-leaking issue that persisted through four different hiding strategies. The approach is simpler, more robust, and works universally.
4. Add to Key Learnings: **"For pixel capture, prefer clean clones over in-place hiding"** — When capturing a background in isolation, creating an empty element with the same CSS background is more reliable than hiding content within the real element. In-place hiding must fight CSS specificity, !important rules, pseudo-elements, compositor timing, and stacking contexts. A clone has none of these problems.
5. **Delete `docs/issue-taxonomy-gradient-capture.md`** — the issue is resolved. The investigation notes have served their purpose; the decision and learning are captured in progress.md.
