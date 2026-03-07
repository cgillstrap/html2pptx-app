# Session 6b — Duplicate Text Extraction Fix

## Context

Visual review of `hr-skills-slide.html`, `sample-slide.html`, and `conformant_sample.html` reveals duplicate text elements in the PPTX output. The root cause is consistent: when a parent element extracts text content (via shape text capture, list extraction, or div-text fallback), the child elements that contributed that text are NOT marked in the `processed` Set. These children are then re-extracted independently through later code paths (standalone span extraction, shape extraction, or div-text fallback), producing duplicate overlapping text.

This is a single architectural issue in the extractor's `processed` Set management. The fix has five coordinated parts, all within `extractSlideData()` in the EXTRACTION_SCRIPT.

**Fixtures affected:** `hr-skills-slide.html`, `sample-slide.html`, `conformant_sample.html`
**Regression fixtures:** ALL other fixtures must be tested — `multi-slide-test.html`, `lpm-slides-v1.html`, `agile-slides.html`, `modern-it-skills.html`
**File to update:** `src/extraction/extractor.js` only (all changes within EXTRACTION_SCRIPT template literal)

---

## The Five Parts

### Part A: List Handler — Mark All Descendants

**Problem:** The UL/OL handler marks only `<li>` elements as processed:
```javascript
liElements.forEach(li => processed.add(li));
processed.add(el);
```

Inline elements inside list items (`<span>`, `<b>`, `<strong>`, `<em>`, `<a>`) are NOT marked. The Session 5 standalone text span path then re-extracts these as div-text elements.

**Symptom:** In `sample-slide.html`, the `<span class="accent">Revenue</span>` etc. inside list items appear twice — once as coloured text within the list, once as separate overlapping text boxes.

**Fix:** Replace the LI-only marking with full descendant marking. In the UL/OL handling block, change:

```javascript
liElements.forEach(li => processed.add(li));
processed.add(el);
```

to:

```javascript
el.querySelectorAll('*').forEach(function(child) { processed.add(child); });
processed.add(el);
```

This marks every descendant of the UL/OL — LI elements, spans, strongs, ems, anchors, etc. — preventing any child from being re-extracted through later paths.

**Safety:** The descendants of a list are always part of the list content. There is no case where a child of a `<ul>` should be extracted independently as a separate PPTX element. Images inside lists would be an edge case, but images are processed BEFORE lists in the loop (they come first in the code), so an `<img>` inside a `<li>` would already be processed and marked before the UL handler runs.

---

### Part B: Shape Text Capture — Mark Descendants When Text Is Captured

**Problem:** When a shape div captures text content (the `shapeText` path for divs with backgrounds but no block children), the div itself is marked as processed, but its child elements are not. These children are then re-extracted through later paths.

**Symptom:** In `hr-skills-slide.html`, the `<div class="col-header">` captures text "BUILD Train & Develop Internally" as shape text. The `<span class="col-header-text">` inside is later re-extracted as a standalone text span.

**Fix:** After the shape text capture block (where `shapeText` is populated), if text was captured, mark all descendants as processed. Find the section where shape text is captured:

```javascript
if (!shapeHasBlockChild && shapeInnerText.length > 0) {
  // ... existing shape text capture code ...
}
```

After this block, add descendant marking:

```javascript
if (!shapeHasBlockChild && shapeInnerText.length > 0) {
  // ... existing shape text capture code (unchanged) ...

  // Mark descendants as processed to prevent re-extraction.
  // Safe because shapeHasBlockChild is false — children are
  // inline elements whose text is now captured in shapeText.
  el.querySelectorAll('*').forEach(function(child) { processed.add(child); });
}
```

**Safety:** This only runs when `!shapeHasBlockChild`, meaning all children are inline elements (spans, b, i, em, etc.). These elements' text is fully captured in the shape text. There's no case where an inline child of a shape-text div should also be an independent PPTX element.

---

### Part C: Text Element Extraction — Mark Descendants

**Problem:** When a `<p>` or heading element with inline formatting is extracted, `parseInlineFormatting()` captures the text runs from child spans/b/i/etc. The text element is marked as processed, but its children are not. This hasn't caused visible issues yet because most text elements have children that wouldn't match later extraction paths, but it's the same architectural gap and should be fixed for consistency.

**Fix:** At the end of the text element handling block (the section that handles P, H1-H6), after the element is added to the `elements` array, add descendant marking:

```javascript
// At the end of the text element block, just before processed.add(el):
el.querySelectorAll('*').forEach(function(child) { processed.add(child); });
processed.add(el);
```

Currently the code does only `processed.add(el)` at the end. Change it to mark all descendants too.

**Safety:** Children of text elements are always inline formatting elements (span, b, i, strong, em, u, a). Their text is captured via `parseInlineFormatting()`. None should be extracted independently.

---

### Part D: Div-Text Fallback — Skip When Children Have Visual Fills

**Problem:** The div-text fallback captures the combined text content of a div when it has no block children and has text. But if the div's children have their own visual fills (backgrounds, gradients), those children will be individually extracted as shapes with text through later iterations. This produces duplication — the parent captures combined text, and each child captures individual text.

**Symptom:** In `hr-skills-slide.html`, the `<div class="pills">` (no background, children are styled spans) is extracted as div-text with combined text "AI & Agentic Data Governance Cyber & AI Ethics". Each `<span class="pill">` is separately extracted as a shape with its individual text.

**Fix:** In the div-text fallback path, before extracting, check if any immediate child elements have visual fills. If so, skip the div-text extraction — the children will be extracted individually through later iterations.

Find the div-text fallback block (the `if (!hasBlockChild && fullText.length > 0)` section inside the DIV handler). Add a visual-children check at the start:

```javascript
if (!hasBlockChild && fullText.length > 0) {
  // ── Skip if children have visual fills (Session 6b) ────────
  // If child elements have backgrounds/gradients, they'll be
  // individually extracted as shapes. Don't also extract the
  // parent as combined text — that produces duplication.
  var hasVisualChildren = false;
  for (var vci = 0; vci < el.children.length; vci++) {
    var vcComp = window.getComputedStyle(el.children[vci]);
    var vcBg = vcComp.backgroundColor;
    var vcBgImg = vcComp.backgroundImage;
    if ((vcBg && vcBg !== 'rgba(0, 0, 0, 0)' && vcBg !== 'transparent') ||
        (vcBgImg && vcBgImg !== 'none' && vcBgImg.includes('gradient'))) {
      hasVisualChildren = true;
      break;
    }
  }
  if (hasVisualChildren) {
    processed.add(el);
    return;
  }

  // ... existing div-text extraction code continues unchanged ...
```

**Key behaviour:** The parent div is marked as processed (so it won't be revisited) but NO element is emitted for it. Its children will be processed individually in later loop iterations and extracted as shapes with their correct individual text and styling.

**Safety:** This check only looks at immediate children (`el.children`), not all descendants. It uses the same background detection logic as the shape path (`backgroundColor` and `backgroundImage`). The check is conservative — if ANY child has a visual fill, the parent is skipped. This might occasionally skip a div-text that would have been useful (e.g., a div where only one of several children has a background), but the alternative (duplication) is worse.

---

### Part E: Div-Text Fallback — Mark Descendants When Extracted

**Problem:** When the div-text fallback DOES extract (after passing the visual-children check from Part D), it marks only the div itself as processed. Child inline elements (spans, b, i, etc.) are not marked, allowing re-extraction.

**Fix:** At the end of the div-text extraction (both the `hasFormatting` and plain text branches), mark all descendants:

```javascript
// In the hasFormatting branch, after elements.push(...):
el.querySelectorAll('*').forEach(function(child) { processed.add(child); });
processed.add(el);
return;

// In the plain text branch, after elements.push(...):
el.querySelectorAll('*').forEach(function(child) { processed.add(child); });
processed.add(el);
return;
```

**Safety:** Same reasoning as Parts B and C — when a parent captures text from inline children, those children should not be independently re-extracted.

---

## Implementation Notes

**All five parts are in the same file and function.** They're all modifications to the `extractSlideData()` function inside the EXTRACTION_SCRIPT template literal in `extractor.js`. No other files need changes. No JSON contract changes. No generator changes.

**The `querySelectorAll('*')` call is lightweight** in this context — it's called on individual elements (a UL, a shape div, a P tag), not on the entire document. The number of descendants is typically small (3–20 elements).

**Order of parts matters for testing but not for implementation.** All five parts can be implemented together. However, for validation:
- Part A alone fixes the sample-slide.html regression
- Parts B + D together fix the HR skills duplication
- Part C is preventive (no current visible symptom)
- Part E is preventive for future cases after Part D's check

---

## Validation

### Primary Checks

| Fixture | What to check |
|---------|--------------|
| `sample-slide.html` | Red accent text ("Revenue", "Client NPS", etc.) appears ONCE, not doubled. List renders correctly with coloured inline spans. |
| `hr-skills-slide.html` | Column header text ("BUILD Train & Develop Internally" etc.) appears ONCE. Pill labels ("AI & Agentic", "Data Governance" etc.) appear as individual coloured shapes, NOT also as combined plain text behind them. Body bullet text is not duplicated. |
| `conformant_sample.html` | Slide 3: check if bullet items and "Weeks 1-4" entries still overlap. If they do, this is a separate positioning issue (not duplication) — note for follow-up. |

### Regression Checks

| Fixture | What to check |
|---------|--------------|
| `multi-slide-test.html` | Cards on slide 2 render correctly. Metrics on slide 3 show values. No missing text. |
| `lpm-slides-v1.html` | Tags, metric values, contrast labels, HR lines, arrows, ask numbers all present. No missing content from the descendant marking. |
| `agile-slides.html` | Badge shapes (Core, Portfolio, Knowledge) still render with text. Phase duration shapes still render. Gradient capture still works. |
| `modern-it-skills.html` | Skill labels, descriptions, and implementation text all present. No duplication. |

### Specific Regression Risks

1. **Could marking descendants prevent legitimate extractions?** No — descendants are only marked after their text has been captured by the parent's extraction. The marked descendants are inline elements (spans, b, i, etc.) that would otherwise produce duplicate text.

2. **Could the visual-children check (Part D) skip div-text extractions that shouldn't be skipped?** Potentially in edge cases — if a div contains one child with a background and other children without, the entire div-text is skipped. The children without backgrounds would then need to be extracted through their own paths (standalone span, or they'll fall through). For current fixtures this doesn't cause issues. If it does in future fixtures, the check can be refined to only skip when ALL children have visual fills.

3. **Could Part B (shape descendant marking) interact with the shape's own `processed.add(el)`?** No — the descendants are marked in addition to the element itself. The shape is still emitted correctly; only its children are prevented from re-extraction.

---

## Conformant Sample Slide 3 — Follow-Up If Still Overlapping

If the bullet/weeks overlap on conformant_sample.html slide 3 persists after the duplication fix, it's a separate layout issue. Likely causes:
- The UL's extracted bounding rect and the step-duration div's extracted bounding rect may be too close together, and PptxGenJS text rendering adds slightly more height than the HTML browser rendering.
- The scale-to-fit logic may be compressing the vertical spacing.

To investigate: add console.log output in the extractor to print the y-position and height of the UL and step-duration elements within each step card. Check if the positions are correct (step-duration.y > UL.y + UL.h) or overlapping in the extraction data.

This would be a separate task if needed — do not attempt to fix layout issues in this task.

---

## Progress.md Updates

After completing this task, update progress.md:

**Phase 3b checklist — add:**
- [x] **Processed set propagation (Session 6b)**: All extraction paths (list, shape text, text elements, div-text) now mark descendants as processed after capturing their text. Div-text fallback skips extraction when children have visual fills. Fixes duplicate text in hr-skills-slide, sample-slide, and similar patterns.

**Key Decisions Log — add to Session 6:**
4. **Processed set must propagate to descendants** — When any extraction path captures text from child elements, all descendants must be marked in the `processed` Set. The Session 4/5 additions (standalone span extraction, shape text capture) created new extraction paths that could re-capture text already captured by a parent. The fix is systematic: every path that captures text from children marks those children as processed.
5. **Div-text skips when children have visual fills** — A parent div whose children have backgrounds will produce duplication if extracted as div-text, because the children will also be individually extracted as shapes. The div-text fallback now checks for visual children first and defers to individual child extraction when found.

**Key Learnings — add:**
- The `processed` Set is the primary defence against duplicate extraction. Every extraction path that captures text from child elements MUST mark those children as processed. This is an invariant, not a case-by-case decision.
- Div-text fallback must be aware of children's visual properties. A container div with no background but with visually-styled children is NOT a text element — it's a layout container whose children should be extracted individually.
