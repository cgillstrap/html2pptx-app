# Session 6 — Task Descriptions

## Context

These tasks address critical failures when converting single-slide HTML files that use a wrapper/viewport scaling pattern. Two new test fixtures (`hr-skills-slide.html` and `modern-it-skills.html`) produce PPTX files that require repair on open — most content is lost or severely degraded.

Both fixtures use the same layout pattern:
```
body (grey centering container, flex, 100% viewport)
  └─ div.slide-wrap (aspect-ratio wrapper, vw-based sizing)
       └─ div.slide (fixed 1280×720px, transform: scale(...) applied by JS)
            └─ [all slide content]
```

The root cause is a cascade of failures starting with incorrect slide detection, which causes wrong viewport dimensions, wrong coordinate origins, and positions distorted by CSS transforms.

**New fixtures:** `test/extraction/fixtures/hr-skills-slide.html` and `test/extraction/fixtures/modern-it-skills.html`
**Reference files:** `src/extraction/extractor.js`, `src/generation/generator.js`
**Principles:** Read `PRINCIPLES.md` and `claude.md` before starting. Extraction and generation never import each other. The extractor decides what is slide content. Security controls must not be relaxed.

---

## Task 1: Single-Slide Class Detection

**Problem:** The `detectSlideContainers()` function in the extraction script only returns `class-slide` results when there are *more than one* matching elements:

```javascript
containers = Array.from(body.querySelectorAll('section.slide, div.slide'));
if (containers.length > 1) return { containers, method: 'class-slide' };
```

When a single slide has `class="slide"`, this check fails and detection falls through to subsequent methods. In the case of `hr-skills-slide.html` and `modern-it-skills.html`, it eventually hits `body-fallback`, making the entire body the "slide container". This produces wrong viewport dimensions (the body is viewport-sized, not 1280×720), wrong background (grey `#e8e8f0` instead of white), and wrong element coordinates (relative to the body, not the slide div).

**Fix location:** `src/extraction/extractor.js` — inside the `detectSlideContainers()` function in the EXTRACTION_SCRIPT template literal.

**Approach:**

1. Change the `class-slide` detection to accept one or more matches instead of requiring more than one:

```javascript
containers = Array.from(body.querySelectorAll('section.slide, div.slide'));
if (containers.length >= 1) return { containers, method: 'class-slide' };
```

2. This must also be applied to the `data-slide-number` detection, which has the same `> 1` guard:

```javascript
let containers = Array.from(body.querySelectorAll('[data-slide-number]'));
if (containers.length >= 1) {
  containers.sort((a, b) => parseInt(a.dataset.slideNumber) - parseInt(b.dataset.slideNumber));
  return { containers, method: 'data-slide-number' };
}
```

3. The `section-children` and `uniform-divs` paths should remain as `> 1` because their heuristics only make sense with multiple containers (a single `<section>` child or a single `<div>` child doesn't indicate a slide pattern — those are just normal page structure).

**Impact on other fixtures:**
- `multi-slide-test.html` — uses `data-slide-number` with 3 slides, unaffected (still `> 1`).
- `lpm-slides-v1.html` — uses `data-slide-number` with 12 slides, unaffected.
- `agile-slides.html` — uses `div.slide` with 3 slides, unaffected (still `> 1`).
- `sample-slide.html` — uses `body-fallback` (no slide class, no data-slide-number). This file does NOT have a `class="slide"` on any element, so it still correctly falls through to body-fallback. No regression.

**Validation:** After this fix alone (before Tasks 2–3), converting `hr-skills-slide.html` should detect 1 slide via `class-slide` method. The viewport should be based on the `div.slide` bounding rect, not the body. The PPTX should no longer require repair. Content will still have positioning issues (Task 2) and missing SVGs (Task 3), but the file structure should be valid.

**Files to update:** `extractor.js` only.

---

## Task 2: Transform-Aware Extraction

**Problem:** Both new fixtures apply a CSS `transform: scale(...)` to the slide container via JavaScript, shrinking the 1280×720px slide to fit the browser viewport. When the hidden BrowserWindow loads these files, the JS runs and scales the slide. All subsequent `getBoundingClientRect()` calls return the *post-transform* (scaled-down) dimensions. A 1280×720 slide scaled to 0.72x reports bounding rects as ~922×518, and every child element's position and size is similarly compressed. This produces a PPTX with incorrectly sized elements at wrong positions.

The root issue is that `getBoundingClientRect()` returns visual/rendered coordinates that include CSS transforms, not the element's layout coordinates.

**Fix location:** `src/extraction/extractor.js` — in both the EXTRACTION_SCRIPT (inside the browser) and in the `extractFromHTML()` Node.js function.

**Approach — Option A (preferred): Strip transforms before extraction**

This is the cleanest approach. Before running the extraction script, inject a small script that removes CSS transforms from the slide container and its ancestors. This makes `getBoundingClientRect()` return the native layout coordinates.

1. In `extractFromHTML()`, after the page loads and before running `EXTRACTION_SCRIPT`, execute a transform-stripping script:

```javascript
// Strip CSS transforms that distort getBoundingClientRect() values.
// Common in viewport-scaling HTML patterns where JS applies
// transform: scale(...) to fit a fixed-size slide into the browser.
await hiddenWindow.webContents.executeJavaScript(`
  (function() {
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var cs = window.getComputedStyle(el);
      if (cs.transform && cs.transform !== 'none') {
        el.style.transform = 'none';
      }
    }
  })()
`);
// Brief pause for layout reflow after transform removal
await new Promise(resolve => setTimeout(resolve, 100));
```

2. This runs after the page's own JavaScript has executed (the 300ms wait is already in place), so the HTML's scale function has already run and set the transform. We then override it to `none` before extraction begins.

3. The hidden window sizing logic already sets the content size to accommodate the body dimensions. After stripping transforms, the body dimensions may change (the slide is now full-size instead of scaled down). The existing resize logic should handle this, but verify.

**Why not Option B (resize window to native dimensions)?** Resizing the window changes the viewport, which re-triggers the HTML's responsive scale function, which changes the transform, which changes the layout in a circular way. Stripping the transform is a one-shot fix that doesn't interact with the HTML's own resize logic.

**What NOT to do:**
- Don't try to mathematically invert the transform on extracted coordinates — this is fragile and error-prone with nested transforms.
- Don't prevent the HTML's JavaScript from running — it may set up other layout-critical styles beyond the transform.
- Don't strip transforms inside the EXTRACTION_SCRIPT itself — the transform needs to be removed before the extraction function runs, so layout has reflowed to native coordinates.

**Validation:** Convert `hr-skills-slide.html` and check:
- Viewport reports as 1280×720 (not ~922×518 or whatever the scaled size was)
- Element positions correspond to the native 1280×720 coordinate space
- Text elements are at correct positions relative to each other (title at top, grid below, banner at bottom)
- Compare visually against the Python-generated PPTX for layout accuracy

Also validate against ALL existing fixtures:
- `multi-slide-test.html` — no transforms present, should be unaffected
- `lpm-slides-v1.html` — no transforms present, should be unaffected
- `agile-slides.html` — uses opacity transitions but no scale transforms, should be unaffected
- `sample-slide.html` — no transforms present, should be unaffected

**Files to update:** `extractor.js` only (the `extractFromHTML()` function, not the EXTRACTION_SCRIPT).

---

## Task 3: SVG Element Handling

**Problem:** Both new fixtures contain inline `<svg>` elements — icons in column headers (`hr-skills-slide.html`) and row label icons plus arrow indicators (`modern-it-skills.html`). The extraction script's element loop iterates over all descendants via `container.querySelectorAll('*')`, which includes SVG elements and their children (`<path>`, `<circle>`, `<rect>`, `<ellipse>`, `<line>`, etc.).

These SVG child elements don't match any extraction path (not images, not DIVs, not text tags, not spans), but they may have non-zero bounding rects and computed styles. Depending on how they interact with the extraction logic, they could:
- Fall through to the text element check and produce malformed text entries
- Hit the div-text fallback via their parent `<svg>` container
- Produce zero-dimension elements that clutter the output

SVG elements should be explicitly skipped and their children marked as processed.

**Fix location:** `src/extraction/extractor.js` — in the `extractSlideData()` function's element loop, inside the EXTRACTION_SCRIPT template literal.

**Approach:**

1. Add SVG detection early in the element loop, after the `processed` check and the interactive element filtering, but before any content extraction paths:

```javascript
// ── SVG element handling ────────────────────────────────────
// Inline SVGs and their children (path, circle, rect, etc.)
// cannot be faithfully represented in PPTX as vector elements.
// Skip the entire SVG subtree and count for summary warning.
if (el.tagName === 'svg' || el instanceof SVGElement) {
  el.querySelectorAll('*').forEach(function(child) { processed.add(child); });
  processed.add(el);
  // Only count top-level SVGs, not their children
  if (el.tagName === 'svg') svgSkipCount++;
  return;
}
```

2. Declare `var svgSkipCount = 0;` at the top of `extractSlideData()` alongside `interactiveSkipCount`.

3. After the element loop, emit a summary warning if any SVGs were skipped:

```javascript
if (svgSkipCount > 0) {
  errors.push(
    svgSkipCount + ' inline SVG element(s) skipped — vector graphics ' +
    'cannot be converted to PPTX shapes. Consider replacing with ' +
    'images for better conversion fidelity.'
  );
}
```

4. **Important `instanceof` check:** Inside the hidden BrowserWindow, `SVGElement` is available as a global. Using `el instanceof SVGElement` catches all SVG namespace elements (path, circle, g, etc.) even if their `tagName` doesn't match simple string checks. However, since we mark all children as processed when we encounter the parent `<svg>`, most SVG children will be skipped by the `processed` check before reaching this code. The `instanceof` check is a safety net for edge cases (e.g. `<svg>` elements used outside a parent SVG context).

5. **Note on `el.tagName` for SVG elements:** In HTML documents (not XHTML), SVG element tag names may be returned in lowercase (`svg`, `path`) unlike HTML elements which are uppercase (`DIV`, `SPAN`). The check should use `el.tagName === 'svg' || el.tagName === 'SVG'` or the `instanceof` approach to be safe. Alternatively, normalise: `el.tagName.toUpperCase() === 'SVG'`.

**Future enhancement (not in scope for this task):** SVG elements could be rasterised to PNG via `capturePage()` of their bounding rect, similar to gradient capture. This would preserve the visual appearance of icons and arrows. This is noted as a future consideration, not implemented now.

**What NOT to do:**
- Don't try to convert SVG paths to PptxGenJS freeform shapes — the mapping is complex, unreliable, and not worth the effort for icon-level graphics.
- Don't skip the parent container of SVGs — only the SVG subtree itself. The `div.col-header` that contains an SVG also contains text, which should still be extracted.
- Don't use `el.closest('svg')` as the detection method — this misses the top-level `<svg>` element itself.

**Validation:** Convert `hr-skills-slide.html` and check:
- No malformed elements in the PPTX from SVG content
- Icons are absent (expected — they're skipped) but all text content around them is preserved
- Warning message reports the count of skipped SVGs
- Column header text (BUILD, PARTNER, BORROW, EMBED) still appears
- Row label text in `modern-it-skills.html` still appears

Also verify no regressions on existing fixtures (none of which contain inline SVGs).

**Files to update:** `extractor.js` only.

---

## Task 4: Validation and Regression Testing

**This is not a code task — it's a testing checklist for after Tasks 1–3 are complete.**

Convert ALL six fixtures and verify:

| Fixture | Expected Detection | Key Checks |
|---------|-------------------|------------|
| `hr-skills-slide.html` | `class-slide`, 1 slide | Valid PPTX (no repair needed). Title, subtitle, 4-column grid with header text, skill pills, bullet items, footer text, banner. SVGs absent with warning. White background, 1280×720 viewport. |
| `modern-it-skills.html` | `class-slide`, 1 slide | Valid PPTX (no repair needed). Title, column headers, 6 skill rows with label/description/implementation text, banner, footer. SVGs and arrow SVGs absent with warning. White background, 1280×720 viewport. |
| `multi-slide-test.html` | `data-slide-number`, 3 slides | No regressions. Gradient on slide 1. Cards on slide 2. Metrics on slide 3. |
| `lpm-slides-v1.html` | `data-slide-number`, 12 slides | No regressions. Tags, metrics, contrast labels, HR lines, centred arrows, ask numbers all present. |
| `agile-slides.html` | `class-slide`, 3 slides | No regressions. Badges, phase durations, shape text all present. CSS triangles skipped. |
| `sample-slide.html` | `body-fallback`, 1 slide | No regressions. Div-text fallback, placeholder visible, list with inline spans. |

**Specific regression risk from Task 1:** The `data-slide-number >= 1` change means a single element with `data-slide-number` would be detected as a slide rather than falling through. Check that `sample-slide.html` (which has no `data-slide-number` attributes) still correctly falls through to `body-fallback`.

**Specific regression risk from Task 2:** The transform-stripping script runs on ALL pages, including those without transforms. Verify that `lpm-slides-v1.html` and `multi-slide-test.html` (which have no CSS transforms) are completely unaffected — same element counts, same viewport dimensions, same visual output.

**Specific regression risk from Task 3:** The SVG detection uses `instanceof SVGElement`. Verify this doesn't accidentally match any non-SVG elements in existing fixtures. The `processed` Set should prevent any double-extraction issues.

---

## Execution Order

**Task 1 → Task 2 → Task 3 → Task 4.**

Task 1 is the prerequisite — without correct detection, Tasks 2 and 3 can't be validated. Task 2 must come before Task 3 because SVG bounding rect accuracy depends on transforms being stripped. Task 4 is the comprehensive validation pass.

After each task, do a quick conversion of `hr-skills-slide.html` to confirm incremental progress:
- After Task 1: PPTX should open without repair. Content present but positions may be wrong (transform issue).
- After Task 2: Element positions should be correct. SVGs may produce warnings or empty elements.
- After Task 3: Clean output with SVG skip warnings. Full content minus icons.

## Progress.md Updates

After completing all tasks, update progress.md:

**File Status table:**
- `extractor.js` updated to Session 6

**Phase 3b checklist — add:**
- [x] **Single-slide class detection (Session 6)**: `class-slide` and `data-slide-number` detection accepts single-element matches (>= 1 instead of > 1). Enables correct detection of single-slide HTML files with `class="slide"`.
- [x] **Transform-aware extraction (Session 6)**: CSS transforms stripped from all elements before extraction runs, ensuring `getBoundingClientRect()` returns native layout coordinates. Handles viewport-scaling HTML patterns where JS applies `transform: scale(...)`.
- [x] **SVG element handling (Session 6)**: Inline `<svg>` elements and their subtrees skipped during extraction with summary warning. Prevents malformed extraction data from SVG paths, circles, and other vector elements.

**Key Decisions Log — add Session 6 section:**
1. **Single-element class detection is valid** — A `div.slide` or `section[data-slide-number]` with only one match is equally valid as multiple matches. The class/attribute signal is intentional markup, not a heuristic. The `section-children` and `uniform-divs` paths retain their `> 1` requirement because those are structural heuristics that only work with multiple containers.
2. **Transform stripping over window resizing** — Resizing the hidden window re-triggers responsive JS (scale functions), creating circular dependencies. Stripping transforms is a one-shot operation that lets the browser reflow to native layout coordinates without interacting with the HTML's own resize logic.
3. **SVG skip with warning, not rasterisation** — Rasterising SVGs via `capturePage()` is technically feasible (same approach as gradient capture) but adds complexity. For MVP, skipping with a warning is the right balance. Users can replace inline SVGs with `<img>` tags referencing PNG/SVG files for better conversion.

**Key Learnings — add:**
- `getBoundingClientRect()` returns post-transform visual coordinates, not layout coordinates. CSS `transform: scale(0.7)` on a 1280px-wide element makes it report ~896px width from the bounding rect.
- Single-slide HTML files are a valid and common pattern — the detection cascade must not assume multiple containers.
- SVG elements in HTML documents may have lowercase tag names (`svg`, `path`) unlike HTML elements (`DIV`, `SPAN`). Use `instanceof SVGElement` or case-insensitive checks.

**HTML Patterns Encountered table — add:**
| **Viewport-scaled single slide** | `hr-skills-slide.html`, `modern-it-skills.html` | `class-slide` (single) | Single slide at 1280×720 inside a scaling wrapper. JS applies `transform: scale(...)` to fit viewport. | Transform distorts bounding rects. Inline SVGs for icons. Requires transform stripping before extraction. |

**Test fixtures table — add:**
| `hr-skills-slide.html` | `test/extraction/fixtures/` | Single slide: viewport-scaled wrapper pattern, 1280×720, CSS grid 4-column layout, inline SVGs, gradient banner, skill pills as styled spans. |
| `modern-it-skills.html` | `test/extraction/fixtures/` | Single slide: viewport-scaled wrapper pattern, 1280×720, CSS grid tabular layout, inline SVGs for icons and arrows, gradient banner. |
