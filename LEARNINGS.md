# Key Learnings & HTML Pattern Catalogue

## Purpose

Stable reference material for Claude Code and chat sessions. Consult before making implementation decisions. Entries are added when discoveries are made but do not change once written.

Updated by: Chat sessions, when new learnings are captured.

---

## Key Learnings

1. **Electron v33+ deprecates File.path** — must use webUtils.getPathForFile() via preload
2. **Don't reinvent tested logic** — porting html2pptx-local.cjs directly was far more productive than writing a custom generator (see Principle 5)
3. **The original assumes strict HTML structure** — text must be in `<p>`/`<h1>`-`<h6>` tags, not bare divs. Our fallback handles this.
4. **parseInlineFormatting() is the key function** — builds text run arrays with per-span colour/bold/italic
5. **PptxGenJS margin order** is [left, right, bottom, top] — NOT CSS order
6. **inset: 0** is critical on text boxes to remove default PowerPoint internal padding
7. **Multi-engine HTML varies significantly** — Claude produces semantic HTML; ChatGPT/Copilot tend toward div-heavy structures. Div-text fallback is essential.
8. **capturePage() captures rendered pixels, not layers** — Must hide foreground content first. Session 3 extended this: must also hide sibling containers in stacked layouts.
9. **Artifact versioning matters** — When updating files across sessions, produce complete file artifacts rather than partial updates.
10. **Layout strategy affects gradient capture** — Vertically stacked slides (each at a different Y offset) only need children hidden. Stacked overlapping slides (same coordinates, toggled via opacity) need ALL containers hidden except the target.
11. **Overflow is an extraction concern; fitting is a generation concern** — The extractor reports reality (content exceeds bounds). The generator decides what to do about it (scale to fit).
12. **backgroundColor is unreliable for gradient-only elements** — When the only background is a CSS gradient, `backgroundColor` resolves to `transparent`. Must parse the gradient string to extract a solid fallback colour (first colour stop).
13. **box-sizing: border-box makes computed.width unreliable for content-area checks** — A `width: 0` element with `border-left: 14px` reports `computed.width = 14px`. Use `rect.width - totalBorderWidths` instead.
14. **Shape elements can hold text in PptxGenJS** — The `addText()` method works on shapes. The original ported code always set `text: ''` on shapes, but PptxGenJS fully supports text with font, colour, and alignment properties inside shape objects.
15. **`textAlign` is meaningless on flex containers** — A div with `display: flex; justify-content: center` reports `textAlign: start` from computed styles. Must check `display` and read `justifyContent`/`alignItems` to detect the real alignment.
16. **HR renders as `border-top` in browsers** — The visual line of an `<hr>` element comes from `borderTopColor` and `borderTopWidth`, not from `color` or `backgroundColor`.
17. **`getBoundingClientRect()` returns post-transform visual coordinates** — CSS `transform: scale(0.7)` on a 1280px-wide element makes it report ~896px width. Must strip transforms before extraction to get native layout coordinates.
18. **Single-slide HTML files are a valid and common pattern** — The detection cascade must not assume multiple containers. `class-slide` and `data-slide-number` are intentional markup signals valid with any count >= 1.
19. **SVG elements in HTML documents may have lowercase tag names** — Unlike HTML elements (`DIV`, `SPAN`), SVG elements may report `svg`, `path` etc. Use `instanceof SVGElement` or check both cases.
20. **Transform stripping must be scoped, not global** — Stripping transforms from all elements breaks gradient capture. Only strip from slide containers and their ancestors.
21. **The `processed` Set is the primary defence against duplicate extraction** — Every extraction path that captures text from child elements MUST mark those children as processed. This is an invariant, not a case-by-case decision.
22. **Div-text fallback must be aware of children's visual properties** — A container div with no background but with visually-styled children is NOT a text element — it's a layout container whose children should be extracted individually.
23. **PptxGenJS addText() does not support image fills** — `fill: { data: '...' }` only works with `addImage()`. For gradient backgrounds on shapes with text, use a two-layer approach.
24. **Element-level capturePage() needs the same slide isolation as slide-level** — On stacked layouts, other containers must be hidden before capturing individual elements.
25. **Hiding children is not enough for gradient capture — must also hide text** — `visibility: hidden` on child elements doesn't affect direct text nodes. Setting `color: transparent` on the target element ensures the captured image contains only the gradient background.
26. **capturePage() coordinates should be fresh, not stored** — DOM manipulations between extraction and capture can shift layout. `captureGradients()` now re-queries bounding rects at capture time.
27. **Coordinate correctness does not guarantee clean captures** — The taxonomy-deck gradient text-leaking issue persisted despite correct capture coordinates. The problem was in the rendering layer (stale compositor frames).
28. **capturePage() serves stale frames for off-viewport regions** — Chromium's compositor does not reliably re-render content far from the viewport origin. Fix: always capture gradient clones at (0,0).
29. **Diagnostic PNG-to-disk writes are invaluable** — Writing captured PNGs to the temp directory and visually inspecting them immediately revealed the compositor stale-frame issue.
30. **For pixel capture, prefer clean clones over in-place hiding** — Creating an empty element with the same CSS background is more reliable than hiding content within the real element.
31. **Relaxing extraction guards has wide blast radius** — Changing `hasBlockChild` to require text content affected every flex/grid layout container with decorative block children. Extraction guard changes must be validated against all layout patterns.
32. **Range API provides precise text-only bounding rects** — `Range.getBoundingClientRect()` on text nodes and inline elements gives the exact area occupied by text, excluding sibling block elements.
33. **The processed Set must never suppress SVG elements** — SVG elements require the `svg-capture` extraction path. The `instanceof SVGElement` check catches both top-level `<svg>` and child elements.
34. **`display: none` children must be skipped in block-child checks** — A hidden DIV is not a layout participant. *Note: implementation attempted and reverted in Session 8c — principle is valid but addressed through engine guidance instead.*
35. **Pseudo-elements are architecturally invisible to DOM extraction** — `::before` and `::after` exist only in the rendering layer. No JavaScript API can enumerate them. Fundamental platform limit.
36. **Near-transparent gradients degrade in raster capture** — Gradient colour stops below ~10% opacity produce visible banding in 8-bit PNG. Compression artifact, not a capture error.
37. **Engine behaviour varies significantly in conversion-relevant ways** — Claude and Copilot naturally produce DOM-based visuals. ChatGPT favours pseudo-elements and embeds interactive features. Engine-specific prompt guidance is necessary.
38. **Prescriptive guardrails should be replaced by descriptive capability profiles** — A tiered capability profile (faithful / graceful / unsupported) gives engines maximum creative range while setting clear expectations.
39. **All tested engines produce real `<table>` elements for tabular content** — Claude, ChatGPT, and Copilot all use `<table>/<tr>/<th>/<td>` markup. Table extraction can focus on `<table>` elements exclusively.
40. **Table extraction must intercept before shape/div-text paths** — Without a dedicated table path, cells with background fills are individually extracted as shapes. The `<table>` handler must fire early and mark all descendants as processed.
41. **Row-level styling requires explicit propagation** — The `tr.hl` pattern applies `backgroundColor` to a `<tr>`. Per-cell computed `backgroundColor` on `<td>` may be transparent even though visually filled. Must check `<tr>` and propagate.
42. **ChatGPT embeds charts as base64 data URIs in `<img>` tags** — The generator must detect the `data:` prefix and use pptxgenjs's `data` property instead of `path`.
43. **Copilot uses `<section>` tags for slide containers** — The existing `section-children` detection method handles this correctly.
44. **pptxgenjs table API uses lowercase property names** — `rowspan` and `colspan` (not camelCase). The library silently ignores unrecognised properties. It auto-inserts `vMerge` continuation cells — do not include placeholder cells at spanned positions.
45. **CSS viewport units break when the hidden window is resized** — `100vh` is relative to the viewport, not the document. When `setContentSize()` changes the hidden window, `100vh` recalculates to the new (much larger) viewport height. Must fix at DOM level before extraction.
46. **CSP `script-src 'self'` blocks inline scripts in loaded HTML** — Inline `<script>` blocks in loaded HTML files do not execute under the default CSP. Relaxed to `'unsafe-inline'` for the extraction window only (Session 12b). Previous learning was wrong — inline scripts were blocked, charts never rendered during extraction.
47. **JS-generated charts should be rasterised, not decomposed** — `makeBarChart()` produces ~48 elements per chart (12 banks × name + track + fill + value). Extracting individually produces fragmented, incoherent PPTX output. Capturing the chart container as a raster image (like SVGs) produces clean results with dramatically fewer elements.
48. **`cloneNode(true)` loses flex layout context** — Chart containers have layout dependencies (flex, percentage widths, CSS variables) that don't survive clone-and-reposition. Slide reposition preserves the full CSS cascade by keeping elements in their original DOM.
49. **CSS `inset` shorthand overwrites `top`/`left`** — Setting `style.inset = 'auto'` after `style.top = '0px'` resets top/left to auto. Must set `inset` before individual properties.
50. **capturePage() needs a compositor frame flush after DOM changes** — After repositioning a slide container, the first `capturePage()` call may return a stale frame. A dummy 1×1 capture forces the compositor to render a fresh frame.
51. **`overflow: hidden` clips capturePage() output** — Content clipped by CSS overflow is not rendered by the compositor. Must temporarily remove overflow clipping to capture chart content that extends beyond the slide viewport boundary.
52. **SVG elements near scroll boundaries may capture incompletely after overflow lift** — Flex layout recalculation during overflow lift can shift elements. A partially-visible SVG at the scroll boundary may capture only the portion that was originally in view. Accepted as Tier 2 graceful degradation for content-dense slides exceeding the viewport.

---

## HTML Patterns Encountered

> **Note:** Fixture names below are historical — see `test/fixtures/manifest.md` for current names.

| Pattern | Example Fixture | Detection Method | Layout Strategy | Key Challenges |
|---------|----------------|-----------------|----------------|----------------|
| **Guardrails-compliant** | `multi-slide-test.html` | `data-slide-number` | Vertically stacked sections, 960×540px each | Clean case. Gradient on slide 1 tested. |
| **Body-as-single-slide** | `sample-slide.html` | `body-fallback` | Single slide, body is the viewport | Div-text fallback needed. Placeholder rendering tested. |
| **Content-dense compliant** | `lpm-slides-v1.html` | `data-slide-number` | Vertically stacked sections, dense card grids and two-column layouts | Overflow: slides 3 and 11 exceed 540px height. Scale-to-fit needed. |
| **CSS slideshow (stacked)** | `agile-slides.html` | `class-slide` (div.slide) | All slides `position: absolute; inset: 0` in a wrapper, toggled via opacity | Gradient capture, interactive chrome filtering, badge/shape text, CSS triangles. |
| **Div-heavy (ChatGPT/Copilot)** | Not yet tested | Expected: `uniform-divs` or `body-fallback` | Deeply nested wrapper divs, text in bare divs | Div-text fallback essential. No fixture yet. |
| **Viewport-scaled single slide** | `hr-skills-slide.html`, `modern-it-skills.html` | `class-slide` (single) | Single slide at 1280x720 inside a scaling wrapper. JS applies `transform: scale(...)`. | Transform distorts bounding rects. Inline SVGs. Requires transform stripping. |
| **Interactive slideshow (display:none)** | `taxonomy-deck-html.html` | `class-slide` (div.slide) | 8 slides, `display:none` toggled by `.active` class. `position:absolute` inside wrapper. | Hidden slides have zero-size bounding rects; requires pre-extraction display-none fix. |
| **Interactive slideshow with static data grids** | `taxonomy-deck-v2.html` | `class-slide` (div.slide) | 12 slides, `display:none` toggling, static heatmap grids with coloured cells and text labels. | Display:none slide fix handles slideshow. Dense small-text grids exercise shape text capture. |
| **Pseudo-element backgrounds (ChatGPT)** | No fixture (Tier 3 limit) | N/A | `::before`/`::after` for decorative backgrounds and accents | Hard limit: pseudo-elements have no DOM representation. Engine guidance. |
| **Heatmap table (Claude)** | `taxonomy-deck-tables.html` | `class-slide` (div.slide) | Display-none slideshow with heatmap `<table>` elements. `rowspan`, per-cell colours, vertical text. | Vertical text Tier 2. `border-spacing` gap Tier 2. |
| **Financial data tables (Claude)** | `barclays-static-presentation.html` | `class-slide` (display-none divs) | Display-none slideshow. Multiple data tables with `tr.hl` row highlighting. JS-generated bar charts. | Row-level fill propagation. JS charts extract via existing paths. 100vh viewport inflation. |
| **Simple tables + base64 image (ChatGPT)** | `barclays_peer_story_draft_lite.html` | `section-children` | Vertically stacked `<section>` elements. Plain tables. Embedded base64 `<img>`. | Data URI image handled by existing support. Simplest table structure. |
