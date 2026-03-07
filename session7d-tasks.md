# Task: Diagnostic — write gradient capture PNGs to disk for inspection

## Context

Five different strategies for capturing gradient backgrounds on taxonomy-deck-html.html have all produced "ghosted text" in the final PPTX. This strongly suggests the problem may not be in `captureGradients()` at all. Before trying a sixth strategy, we need to determine WHERE the text is coming from.

## What to do

Add a temporary diagnostic that writes each captured gradient PNG to disk as a file, so we can visually inspect whether the PNG itself is clean (gradient only) or contains baked-in text.

### Step 1: Write PNGs to disk in `captureGradients()`

In `src/extraction/extractor.js`, in the `captureGradients()` function, after `const dataUri = nativeImage.toDataURL();` and before `slide.background = { type: 'image', data: dataUri };`, add:

```javascript
// DIAGNOSTIC: Write captured gradient PNG to disk for inspection
// Remove this block after diagnosis is complete
try {
  const fs = require('fs');
  const pngBuffer = nativeImage.toPNG();
  const diagPath = require('path').join(
    require('os').tmpdir(),
    `gradient-capture-slide-${slide.index + 1}.png`
  );
  fs.writeFileSync(diagPath, pngBuffer);
  console.log(`[Extractor] DIAGNOSTIC: Gradient PNG written to ${diagPath}`);
} catch (diagErr) {
  console.warn(`[Extractor] DIAGNOSTIC: Failed to write PNG: ${diagErr.message}`);
}
```

### Step 2: Also write element-level gradient PNGs

In `captureElementImages()`, after `const dataUri = nativeImage.toDataURL();` in the element gradient capture section, add the same diagnostic:

```javascript
// DIAGNOSTIC: Write element gradient PNG to disk for inspection
try {
  const fs = require('fs');
  const pngBuffer = nativeImage.toPNG();
  const diagPath = require('path').join(
    require('os').tmpdir(),
    `element-gradient-capture-slide-${slide.index + 1}-el-${i}.png`
  );
  fs.writeFileSync(diagPath, pngBuffer);
  console.log(`[Extractor] DIAGNOSTIC: Element gradient PNG written to ${diagPath}`);
} catch (diagErr) {
  console.warn(`[Extractor] DIAGNOSTIC: Failed to write PNG: ${diagErr.message}`);
}
```

### Step 3: Run against taxonomy-deck-html.html only

Run the app, convert taxonomy-deck-html.html, then inspect the PNG files in the temp directory.

### Step 4: Report findings

For each captured PNG, report:
1. **File name and slide number**
2. **Is the PNG clean?** (gradient only, no text visible)
3. **Or does the PNG contain text?** (text visible in the image)
4. **PNG dimensions** — do they match the expected slide size?

Also check: how many element-level gradient PNGs were written? The taxonomy deck has `.slide-topbar` divs with `background: linear-gradient(...)` and `.divider` divs with gradient backgrounds. If element-level gradient captures exist for these slides, they might be the source of the ghosted text (captured with content visible behind them).

### Step 5: If PNGs are clean — investigate the generator

If all slide-level gradient PNGs are clean (gradient only), the problem is downstream. Check:

1. **Are element-level gradient captures clean?** The `.slide-topbar` elements have a gradient. If their capture includes text from the slide behind them, that image gets rendered as an element overlay, producing the ghosted appearance.

2. **Is the generator placing the background correctly?** In `addBackground()`, data URI backgrounds should be set via `targetSlide.background = { data: bg.data }` — confirm this renders behind all other content, not on top.

3. **Are there duplicate text elements in the extraction data?** Log the element count and types for taxonomy-deck slide 1. If there are unexplained div-text elements that duplicate h1/h2 content, that's the source.

### Step 6: Clean up

After diagnosis, remove the diagnostic `fs.writeFileSync` blocks. They use `require('fs')` which shouldn't remain in production code (though it's fine for the main process where this runs).

## What NOT to change

- Don't change the capture logic itself
- Don't change the clone approach — it's cleaner than the previous hide-children approach regardless of this issue
- Don't change any other fixture handling

## Expected outcome

This task produces diagnostic data, not a fix. The output should be a clear statement of whether the gradient PNGs are clean or contaminated, which tells us whether to look upstream (capturePage/compositor) or downstream (generator/extraction duplication) for the root cause.
