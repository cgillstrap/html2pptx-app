# Task: Pre-extraction visibility fix for `display: none` slides

## Problem

HTML decks that use `display: none` to hide inactive slides (e.g. interactive slideshow UIs) produce zero-size bounding rects for all elements inside hidden containers. The extraction script skips these elements on dimension checks, resulting in only the `.active` slide being extracted.

This is distinct from the `opacity: 0` pattern in agile-slides.html, where elements retain layout even when visually hidden.

## Fixture

`test/extraction/fixtures/taxonomy-deck-html.html` — 8 slides using `display: none` / `display: flex` toggled by `.active` class. Only slide 1 has `display: flex` on load; slides 2–8 have `display: none`.

Copy the attached `taxonomy-deck-html.html` into `test/extraction/fixtures/`.

## Approach

Add a new `executeJavaScript()` block in `extractFromHTML()` in `src/extraction/extractor.js`, placed **after** the transform-stripping step and **before** the main `EXTRACTION_SCRIPT` call.

### Step 1: Force visibility of hidden slide containers

```javascript
// Force display on hidden slide containers before extraction.
// Targets the pattern where interactive slideshows use display:none
// to hide inactive slides. Without this, getBoundingClientRect()
// returns zero-size rects and all elements are skipped.
//
// Only affects containers detected as slides — does not modify
// arbitrary elements. Safe for existing fixtures because:
// - opacity-based hiding (agile-slides) already has layout
// - vertically stacked slides (lpm, conformant) are all visible
// - viewport-scaled slides (hr-skills, modern-it) are visible
await hiddenWindow.webContents.executeJavaScript(`
  (function() {
    // Use the same detection logic as the extraction script
    var containers = Array.from(document.querySelectorAll('[data-slide-number]'));
    if (containers.length === 0) {
      containers = Array.from(document.querySelectorAll('section.slide, div.slide'));
    }
    if (containers.length === 0) return;

    var changed = 0;
    for (var i = 0; i < containers.length; i++) {
      var cs = window.getComputedStyle(containers[i]);
      if (cs.display === 'none') {
        // Store original display value for cleanup if needed
        containers[i].dataset._prevDisplay = 'none';
        // Use empty string to revert to stylesheet default,
        // but since the stylesheet says display:none via class,
        // we need to force a visible display value.
        // flex is the most common layout mode for slide containers.
        // Check if the visible slide uses flex; if not, use block.
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
      // Check if containers use absolute/fixed positioning.
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
  })()
`);
```

### Step 2: Re-measure and resize after visibility change

After the visibility fix block, **re-run the body dimension measurement and `setContentSize()`** that already exists earlier in the function. The hidden window needs to accommodate 8 vertically-stacked slides now instead of 1.

The simplest approach: extract the existing body-dimension measurement into a pattern that runs twice — once after initial load, once after the visibility fix. Or just duplicate the measurement block after the new visibility step:

```javascript
// Re-measure after visibility changes — hidden slides are now visible
// and may have changed the document's total height.
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
```

Note: use `scrollHeight` here rather than `parseFloat(s.height)` because once 8 slides are visible the scroll height is the true content height.

### Step 3: No cleanup needed

The hidden window is destroyed after extraction completes. No need to restore original display/position values.

## What NOT to change

- The `EXTRACTION_SCRIPT` itself — no changes needed there. Once elements are visible, bounding rects are correct and existing extraction logic works.
- The `captureGradients()` and `captureElementImages()` functions — the taxonomy deck has gradient slide backgrounds, so these should activate naturally. The container resolution logic in those functions uses the same selectors and will find all 8 containers.
- Existing fixtures must not regress: `agile-slides.html`, `hr-skills-slide.html`, `modern-it-skills.html`, `lpm-slides-v1.html`, `multi-slide-test.html`, `sample-slide.html`, `conformant_sample.html`.

## Validation

Run the app against all fixtures and confirm:

1. **taxonomy-deck-html.html**: 8 slides extracted (not 1). All slides should have elements. Gradient backgrounds on all slides should be captured via `capturePage()`. Interactive controls (buttons, dots with onclick) should be filtered.
2. **agile-slides.html**: No regression — 3 slides, gradient capture works, badge/shape text present.
3. **hr-skills-slide.html**: No regression — single slide, SVG rasterisation, gradient banner.
4. **lpm-slides-v1.html**: No regression — 12 slides.
5. **conformant_sample.html**: No regression — 3 slides.
6. **multi-slide-test.html**: No regression — 3 slides.
7. **sample-slide.html**: No regression — 1 slide.
8. **modern-it-skills.html**: No regression — 1 slide.

Report: detection method, slide count, total element count, and any warnings for each fixture.

## progress.md update

After completion, update the File Status table for `extractor.js` and add to Session 7 notes:

- **Display-none slide visibility fix**: Pre-extraction step forces hidden slide containers to visible display, with position adjustment for stacked layouts. Enables extraction of interactive slideshow decks that use `display: none` toggling.
- Add `taxonomy-deck-html.html` to the HTML Patterns Encountered table with pattern: "Interactive slideshow (display:none toggled)" and key challenge: "Hidden slides have zero-size bounding rects; requires pre-extraction visibility forcing."
- Add to Key Learnings: "`display: none` eliminates layout entirely — unlike `opacity: 0`, elements have zero-size bounding rects. Pre-extraction visibility forcing is needed for slideshow decks that toggle display."
