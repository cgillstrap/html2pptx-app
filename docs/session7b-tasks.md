# Task: Re-query container bounding rect at gradient capture time

## Problem

`captureGradients()` uses `slide.background.captureRect` which was recorded during the `EXTRACTION_SCRIPT` execution. By the time `captureGradients()` runs, the DOM has been manipulated (containers hidden/shown, possibly layout-shifted by the display-none fix's position changes and window resizing). The stored coordinates may no longer point at the correct region, causing `capturePage()` to capture a stale area that includes text content instead of just the gradient background.

This is the root cause of the taxonomy-deck-html.html gradient capture issue documented in `docs/issue-taxonomy-gradient-capture.md`.

## Architectural principle

`captureGradients()` should own its own coordinate resolution. It already re-resolves containers via `RESOLVE_CONTAINERS_JS` — it should also re-read geometry from the live DOM rather than trusting extraction-time snapshots. This makes gradient capture resilient to any layout shift between extraction and capture, regardless of cause. No special-case flags needed.

## Change: `captureGradients()` in `src/extraction/extractor.js`

After the hide-all/reveal-target/hide-children manipulation block and the 50ms wait, **before** the `capturePage()` call, add a fresh bounding rect query:

```javascript
// Re-query the target container's bounding rect at capture time.
// The stored captureRect from extraction may be stale if DOM
// manipulations (display-none fix, position changes, window
// resizing, or the hide/show dance above) have shifted layout.
// This makes captureGradients() self-sufficient — it does not
// depend on extraction-time coordinates remaining accurate.
const freshRect = await hiddenWindow.webContents.executeJavaScript(`
  (function() {
    var containers = ${RESOLVE_CONTAINERS_JS};
    var target = containers[${slideIndex}];
    if (!target) return null;
    var r = target.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  })()
`);

if (!freshRect || freshRect.w === 0 || freshRect.h === 0) {
  throw new Error('Target container not found or has zero dimensions at capture time');
}
```

Then change the `capturePage()` call to use `freshRect` instead of `rect`:

```javascript
const nativeImage = await hiddenWindow.webContents.capturePage({
  x: Math.round(freshRect.x),
  y: Math.round(freshRect.y),
  width: Math.round(freshRect.w),
  height: Math.round(freshRect.h)
});
```

Also add diagnostic logging so we can confirm the fix is working — log when stored and fresh rects differ:

```javascript
if (Math.abs(freshRect.x - rect.x) > 1 || Math.abs(freshRect.y - rect.y) > 1) {
  console.log(
    `[Extractor] Slide ${slide.index + 1}: capture rect shifted — ` +
    `stored (${Math.round(rect.x)},${Math.round(rect.y)}) → ` +
    `fresh (${Math.round(freshRect.x)},${Math.round(freshRect.y)})`
  );
}
```

## What NOT to change

- **`EXTRACTION_SCRIPT`** — The extraction still records `captureRect` on the background object. This is fine — it's used as a signal that the slide has a gradient background needing capture. The coordinates just aren't used for the actual capture anymore.
- **`captureElementImages()`** — Leave as-is for now. The same staleness issue could theoretically apply, but it's not manifesting on any fixture. If it does surface later, the same pattern (fresh rect query before capture) can be applied. Don't pre-optimise.
- **The display-none fix** — No changes needed. It's working correctly.
- **The `display:none` on children approach** — Keep it. It's a good evolution from the previous `visibility:hidden` approach.

## Cleanup

Remove `docs/issue-taxonomy-gradient-capture.md` after the fix is validated. The issue is resolved and the investigation notes have served their purpose. The decision and learning should be recorded in `progress.md` instead.

## Validation

Run the app against all fixtures and confirm:

1. **taxonomy-deck-html.html**: 8 slides extracted. Gradient backgrounds should be clean — no text duplication. Check the diagnostic log for "capture rect shifted" messages confirming coordinates were corrected.
2. **multi-slide-test.html**: 3 slides, gradient on slide 1 captured cleanly. Check diagnostic log — stored and fresh rects should match (no shift) since this fixture doesn't go through the display-none path.
3. **agile-slides.html**: 3 slides, gradient capture works, no regression.
4. **hr-skills-slide.html**: 1 slide, SVG rasterisation + gradient banner, no regression.
5. **lpm-slides-v1.html**: 12 slides, no regression.
6. **conformant_sample.html**: 3 slides, no regression.
7. **sample-slide.html**: 1 slide, no regression.
8. **modern-it-skills.html**: 1 slide, no regression.

Report: detection method, slide count, total element count, any "capture rect shifted" log messages, and confirmation that taxonomy-deck gradient backgrounds are text-free.

## progress.md update

After validation:

1. Update File Status for `extractor.js` — note "Fresh bounding rect query in captureGradients()"
2. Mark the gradient capture issue as RESOLVED in the 3b checklist
3. Add to Session 7 decisions: **"captureGradients() re-queries geometry at capture time"** — Gradient capture no longer trusts extraction-time coordinates. The target container's bounding rect is read fresh after the hide/show manipulation, making capture resilient to any layout shift between extraction and capture. This resolved the taxonomy-deck text-leaking issue without any special-case flags.
4. Add to Key Learnings: **"capturePage() coordinates must be fresh, not stored"** — DOM manipulations between extraction and capture can shift layout (especially with flex centering, position changes, and window resizing). Capture functions should re-query bounding rects at the moment of capture rather than relying on coordinates recorded during an earlier phase.
5. Remove `docs/issue-taxonomy-gradient-capture.md`
