# Issue: Slide-level gradient capture shows text on taxonomy-deck-html.html

## Status: OPEN (Session 7a)

## Problem

When converting `taxonomy-deck-html.html`, the slide-level gradient background capture (`captureGradients()`) produces images that include the slide's text content baked into the captured PNG. The text is then also rendered as separate PPTX elements on top, creating visible duplication (doubled text in different fonts/sizes).

This issue is specific to the taxonomy deck. All other fixtures with gradient backgrounds (multi-slide-test.html slide 1, agile-slides.html slides 1-3) capture clean gradient-only backgrounds.

## What makes taxonomy-deck-html.html different

- **8 slides using `display: none` / `display: flex` toggling** — only the `.active` slide is visible on load. The Session 7a display-none fix forces all slides visible before extraction.
- **Slides are `position: absolute` inside a wrapper** — the display-none fix changes them to `position: relative` so they stack vertically.
- **Body uses `display: flex; justify-content: center; min-height: 100vh`** — flex centering layout on the body.
- **Gradient is on the `.slide` div itself** — `linear-gradient(135deg, #0a1628 0%, #0d1b33 50%, #122240 100%)`.
- **Content is in child divs with inline styles** — deeply nested structure with styled spans, h1/h2 elements, etc.
- **Re-measurement resizes window** — after making hidden slides visible, the window is resized to `scrollHeight` to fit all 8 slides.

## Approaches tried (all failed)

### 1. visibility:hidden on direct children + color:transparent on container
The original approach from Session 3 (hide children, reveal container). Added `color: transparent` to hide direct text nodes. **Failed** — text still appeared in capture.

### 2. visibility:hidden on ALL descendants + color:transparent
Changed from direct children to `querySelectorAll('*')` to hide every descendant element. **Failed** — text still appeared.

### 3. Overlay div approach
Created a temporary empty `<div>` with the same gradient background, positioned absolutely with `z-index: 2147483647` over the slide area. Captured the overlay instead of the actual slide. **Failed** — text from the underlying slide still appeared in the capture, suggesting the overlay wasn't covering the capture area or `capturePage()` was capturing below it.

### 4. display:none on children
Set `display: none` on all direct children of the target container (completely removes from rendering tree). Container keeps its gradient background. **Failed** — text still appeared.

## Observations

- The same `captureGradients()` function works correctly for multi-slide-test.html (vertically stacked, no display-none fix needed) and agile-slides.html (opacity-based hiding, position:absolute).
- The taxonomy deck is the ONLY fixture that goes through the display-none fix + re-measurement path.
- The re-measurement changes the window from `h * 10` to `scrollHeight`. When we made re-measurement conditional (`displayFixResult > 0`), it fixed the regressions on other fixtures.
- Despite `display: none` on children completely removing them from rendering, text still appeared in the capture. This is very surprising and suggests the issue may not be about content hiding at all.

## Theories to investigate

### A. capturePage() coordinate mismatch
The `captureRect` is computed during extraction (inside EXTRACTION_SCRIPT via `containerRect.left/top/width/height`). The `capturePage()` call uses these coordinates later. If the layout shifted between extraction and capture (e.g., due to DOM changes from the gradient capture process itself), the capture rect might be pointing at the wrong area — possibly capturing a different slide or the raw page content.

**How to test:** Add diagnostic logging to compare the `captureRect` from extraction with a fresh `getBoundingClientRect()` at capture time. If they differ, the coordinates are stale.

### B. Window sizing / capturePage viewport issue
The re-measurement sets the window to `scrollHeight` (e.g., ~4320px for 8 slides). The original `h * 10` would have been much larger. `capturePage()` may behave differently with different window sizes — perhaps it clips or composites differently when the content exactly fills the viewport vs. having headroom.

**How to test:** After the re-measurement, multiply the height by 2 or 3 to add buffer (like the original `* 10` approach), and see if the capture improves.

### C. The display-none fix is interfering with container resolution
`captureGradients()` re-resolves containers via `RESOLVE_CONTAINERS_JS` at capture time. After the display-none fix changed `position` from `absolute` to `relative`, the container resolution might find different elements or the same elements at different positions. The `slideIndex` used to select the target might not match.

**How to test:** Log the number of containers found by `RESOLVE_CONTAINERS_JS` and compare with `result.slideCount`. Also log the target container's `getBoundingClientRect()` vs the stored `captureRect`.

### D. CSS stacking context preventing overlay approach
The failed overlay approach suggests something structural. The slides might create a stacking context (via `overflow: hidden`, `border-radius`, or the combination with `position: relative`) that puts them visually above a body-level overlay in `capturePage()`'s compositing.

**How to test:** Try appending the overlay INSIDE the target container (as first child) with `position: absolute; inset: 0; z-index: 999999` instead of on the body. This ensures it's in the same stacking context.

### E. capturePage() is capturing a cached/stale frame
Chromium may not have repainted after the DOM changes. The 50ms wait might not be sufficient for the taxonomy deck's complex layout with 8 slides.

**How to test:** Increase the wait to 200ms or 500ms. Or force a repaint by reading a layout property (e.g., `document.body.offsetHeight`) after the DOM changes.

### F. Nuclear option: skip gradient capture for display-none-fixed slides
If the capture can't be fixed, fall back to the solid colour for slides that went through the display-none fix. The gradient on the taxonomy deck is subtle (dark blue variations) — the solid fallback would be acceptable. This could be implemented by flagging slides that were display-none-fixed and skipping them in `captureGradients()`.

## Recommended next steps

1. Start with **Theory A** (coordinate mismatch) — cheapest to diagnose with logging.
2. Try **Theory E** (longer wait / forced repaint) — quick to test.
3. Try **Theory D** (overlay inside container) — different approach to the overlay.
4. If none work, implement **Theory F** (skip capture for display-none slides) as a pragmatic fallback.

## Files involved

- `src/extraction/extractor.js` — `captureGradients()` function and `extractFromHTML()` display-none fix
- `tests/extraction/fixtures/taxonomy-deck-html.html` — the fixture
- `tests/extraction/fixtures/taxonomy-deck-html.png` — screenshot showing the issue
