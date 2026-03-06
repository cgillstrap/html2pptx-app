# Session 5 — Task Descriptions

## Context

These tasks address rendering issues found during visual review of `lpm-slides-v1.html` (12-slide guardrails-compliant deck). All issues stem from content patterns that the extractor doesn't currently handle. The LPM deck uses styled `<span>` elements for labels and metrics, `<hr>` for visual dividers, and flexbox centering for arrow connectors — none of which are covered by the current extraction paths.

**Fixture:** `test/extraction/fixtures/lpm-slides-v1.html`
**Reference files:** `src/extraction/extractor.js`, `src/generation/generator.js`
**Principles:** Read `PRINCIPLES.md` and `claude.md` before starting. In particular: extraction and generation never import each other; the extractor decides what is slide content; the generator decides how it renders in PPTX.

---

## Task 1: Standalone Text SPAN Extraction

**Problem:** Styled `<span>` elements that contain visible text but have no background fill are not extracted. The Session 4 inline element extraction (SPAN/A/LABEL block near the bottom of `extractSlideData`) only captures spans with a background — it was designed for badge/pill patterns. The LPM deck uses backgroundless spans extensively:

| Element | CSS class | Content example | Slide(s) |
|---------|-----------|----------------|----------|
| `<span class="tag">` | uppercase, coloured text, no bg | `THE AMBITION`, `THE CHALLENGE` | All slides |
| `<span class="metric-value">` | large blue number, no bg | `>14%`, `Low 50s%`, `56%` | 2, 5 |
| `<span class="contrast-label">` | small uppercase coloured text, no bg | `TODAY`, `TOMORROW` | 6 |
| `<span class="ask-number">` | large blue number, no bg | `1`, `2`, `3` | 12 |
| `<span class="step-number">` | small blue text, no bg | `Enterprise`, `Divisional`, `Delivery` | 9 |

These spans are not children of `<p>` or heading tags, so `parseInlineFormatting` never processes them. They're not `<div>` elements, so the div-text fallback doesn't apply. They fall through the entire extraction loop.

**Fix location:** `src/extraction/extractor.js` — the SPAN/A/LABEL block in `extractSlideData()`.

**Approach:**

1. In the existing `if (el.tagName === 'SPAN' || el.tagName === 'A' || el.tagName === 'LABEL')` block, after the current background-fill branch, add a second branch for text-only spans:

2. Conditions for the new branch:
   - Element is NOT in the `processed` set (critical — spans inside `<p>` tags will already be marked processed when the parent `<p>` was extracted via `parseInlineFormatting`)
   - Element has visible text (`textContent.trim().length > 0`)
   - Element has a non-zero bounding rect (`width > 0 && height > 0`)
   - Element has NO background fill and NO gradient (i.e. this branch handles the case the existing branch skips)

3. Extract as a `div-text` type element with `isDivFallback: true`, capturing:
   - Position from bounding rect (relative to container offset, converted to inches)
   - Full text styling: `fontSize`, `fontFace`, `color`, `bold`, `italic`, `align`, `textTransform`
   - `lineSpacing`, `paraSpaceBefore`, `paraSpaceAfter`, `margin` from computed styles
   - Apply `textTransform` to the text content before storing

4. Mark the element as processed.

**What NOT to do:**
- Don't change the existing background-fill branch — it works correctly for badges/pills.
- Don't emit these as `shape` type — they have no visual fill. Use `div-text` which the generator already handles.
- Don't change the `processed` Set logic — it already correctly prevents double-extraction of spans that are children of text elements.

**Validation:** Convert `lpm-slides-v1.html` and check:
- Slide 1: `INVESTMENT STEERING FOR THE NEXT PHASE` tag appears in blue
- Slide 2: `>14%`, `Low 50s%`, `>5%` metric values appear in blue
- Slide 5: `56%`, `6–18 mo`, `~60%` metric values appear in blue
- Slide 6: `TODAY` labels appear in red, `TOMORROW` labels in blue
- Slide 12: `1`, `2`, `3` numbers appear in blue
- Existing agile-slides.html badges (Core, Portfolio, Knowledge) still render correctly with background fills — regression check

**Files to update:** `extractor.js` only. No JSON contract change — `div-text` type already exists.

---

## Task 2: HR Element Extraction

**Problem:** `<hr>` elements are not extracted. They're not in `textTags`, not images, not DIVs — they fall through completely. The LPM deck uses `<hr>` on slide 11 as a visual separator between content sections.

**Fix location:** `src/extraction/extractor.js` — in the `extractSlideData()` function's element loop, before the text element handling.

**Approach:**

1. Add an `<hr>` detection block in the `container.querySelectorAll('*').forEach` loop. Place it after the image handling and before the DIV/shape handling (logical position: HR is a visual element, not a container).

2. When `el.tagName === 'HR'`:
   - Get bounding rect
   - Skip if width is 0 or height is 0
   - Get computed styles for `borderTopColor` and `borderTopWidth` (HR renders as a border in most browsers)
   - Emit as a `line` type element:
     ```
     {
       type: 'line',
       x1: pxToInch(rect.left - offX),
       y1: pxToInch(rect.top - offY + rect.height / 2),
       x2: pxToInch(rect.left - offX + rect.width),
       y2: pxToInch(rect.top - offY + rect.height / 2),
       width: pxToPoints(borderTopWidth) || 0.75,
       color: rgbToHex(borderTopColor)
     }
     ```
   - The y-coordinate uses `rect.top + rect.height / 2` to place the line at the vertical centre of the HR's bounding box.
   - Mark as processed.

3. Fallback: if `borderTopWidth` is 0 or not set, use a default width of 0.75pt (1px equivalent). If `borderTopColor` is transparent or not set, use the element's `color` property, then fall back to `'D1D5DB'` (the LPM deck's HR colour).

**What NOT to do:**
- Don't emit as a `shape` — HR is a line, and the `line` type already works in the generator.
- Don't try to handle HR elements that have been styled as decorative blocks (height > 10px, backgrounds, etc.) — that's a future concern. A simple line is the right MVP.

**Validation:** Convert `lpm-slides-v1.html` and check:
- Slide 11: A horizontal line appears between the two content sections in each column
- Line colour should be light grey (#D1D5DB per the CSS)
- Line should span the column width

**Files to update:** `extractor.js` only. No JSON contract change — `line` type already exists.

---

## Task 3: Flex Centering Detection in Div-Text Fallback

**Problem:** Arrow connector divs on LPM slides 9 and 10 use `display: flex; align-items: center; justify-content: center` to centre the `→` character both vertically and horizontally within a tall, narrow box. The div-text fallback captures the full bounding rect but emits `align: 'left'` (from `textAlign: start`) and the generator hardcodes `valign: 'top'` on all text elements. Result: the arrow sits at the top-left of its box instead of centred.

**Fix location:** `src/extraction/extractor.js` (extractor emits valign) AND `src/generation/generator.js` (generator reads valign from style).

**Approach — Extractor changes:**

1. In the div-text fallback path (the `if (!hasBlockChild && fullText.length > 0)` block inside the DIV handling section), after computing `baseStyle`, add flex centering detection:

   ```javascript
   // Detect flex centering (e.g. arrow connector divs)
   var display = computed2.display;
   if (display === 'flex' || display === 'inline-flex') {
     var alignItems = computed2.alignItems;
     var justifyContent = computed2.justifyContent;
     if (alignItems === 'center' || alignItems === 'safe center') {
       baseStyle.valign = 'middle';
     }
     if (justifyContent === 'center' || justifyContent === 'safe center') {
       baseStyle.align = 'center';
     }
   }
   ```

2. This overrides the `textAlign: start → 'left'` default when the actual layout mechanism is flex centering. The `textAlign` property is meaningless on a flex container — the centering comes from flex properties.

**Approach — Generator changes:**

1. In the text rendering section (the final block that handles P, H1-H6, and div-text), the `textOpts` object currently hardcodes `valign: 'top'`. Change this to read from the style:

   ```javascript
   valign: el.style.valign || 'top',
   ```

2. This is a one-line change. All existing elements that don't have `valign` in their style will continue to get `'top'` as before. Only elements where the extractor explicitly sets `valign` (flex-centred divs) will get a different value.

**What NOT to do:**
- Don't apply this to all text elements globally — only div-text fallback elements need flex detection. Standard `<p>` and heading tags don't use flex for text alignment.
- Don't change how the shape text path handles valign — shapes already emit `valign: 'middle'` correctly from Session 4.
- Don't try to detect grid centering — that's a different layout model and not present in current fixtures. Keep scope to flexbox.

**Validation:** Convert `lpm-slides-v1.html` and check:
- Slides 9, 10: Arrow `→` characters are vertically and horizontally centred within their connector boxes
- All other text on all slides renders the same as before (regression check)
- agile-slides.html still renders correctly (regression check — it has flex containers)

**Files to update:** `extractor.js` and `generator.js`. The JSON contract is technically extended (style can now include `valign` on div-text elements) but this is additive — existing elements without `valign` are unaffected. Document this in progress.md.

---

## Execution Order

Run these in sequence: Task 1 → Task 2 → Task 3. Task 1 resolves five of the seven reported issues and is the highest-value change. Task 2 is independent and simple. Task 3 is the only one that touches the generator.

After all three, convert both `lpm-slides-v1.html` and `agile-slides.html` and confirm no regressions.

## Progress.md Updates

After completing all tasks, update progress.md:
- File Status table: `extractor.js` and `generator.js` updated to Session 5
- Phase 3b checklist: add completed items for standalone span extraction, HR extraction, flex centering detection
- Key Decisions Log: add Session 5 section documenting the three fixes and rationale
- Key Learnings: add notes about `textAlign` being meaningless on flex containers, and about HR rendering as border-top in browsers
