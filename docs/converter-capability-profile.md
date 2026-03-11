# HTML → PPTX Converter — Capability Profile

## Purpose

This document defines what the HTML to PPTX converter can and cannot do. It serves three audiences:

1. **AI engine prompts** — tells the engine what HTML/CSS subset to produce for clean conversion
2. **Consultants** — sets expectations for what the output will look like
3. **Converter development** — provides the regression baseline for validating changes

The profile is organised into three tiers based on empirical testing across Claude, Copilot and ChatGPT output, validated against 22 test fixtures (see `test/fixtures/manifest.md` for the full catalogue) covering card grids, heatmaps, timelines, metrics layouts, multi-column text, interactive slideshows, viewport-scaled single slides, content-dense decks, data tables, financial presentations, and SVG chart patterns.

---

## Slide Structure

### Required

Each slide must be a distinct HTML element. The converter detects slides using the following cascade (first match wins):

| Priority | Pattern | Example |
|----------|---------|---------|
| 1 | `data-slide-number` attribute | `<section data-slide-number="1">` |
| 2 | `class="slide"` on `<section>` or `<div>` | `<div class="slide">` |
| 3 | Multiple `<section>` children of `<body>` | `<body><section>...</section><section>...</section></body>` |
| 4 | Multiple uniform-width `<div>` children of `<body>` | Heuristic — all divs must be similar width and > 100px tall |
| 5 | `<body>` as single slide | Fallback for single-slide documents |

**Recommended approach:** Use `<section class="slide" data-slide-number="N">` for each slide. This is unambiguous, works with any number of slides, and gives the converter a reliable signal.

### Slide dimensions

Fixed pixel dimensions are recommended. The converter uses the slide container's bounding rect as the viewport for positioning all content.

| Dimension | Recommended | Also supported |
|-----------|-------------|----------------|
| Standard | 960 × 540 px | Any 16:9 ratio |
| Widescreen | 1280 × 720 px | Any fixed dimensions |

The converter creates a custom PowerPoint layout matching the first slide's dimensions. All slides in a deck use the same layout.

### Speaker notes

Add `data-notes="..."` to the slide container element. The text is added as PowerPoint speaker notes. If no `data-notes` is present, the converter generates a breadcrumb from the slide's first heading.

---

## Tier 1 — Faithful Conversion

These patterns convert with high fidelity. The PowerPoint output closely matches the browser rendering. **Use these freely.**

### Text

| Feature | Details |
|---------|---------|
| Semantic text elements | `<p>`, `<h1>`–`<h6>` — extracted with full styling |
| Inline formatting | `<b>`, `<strong>`, `<i>`, `<em>`, `<u>`, `<span>` with per-run colour, font size, bold, italic, underline |
| Text in bare `<div>` elements | Extracted via fallback — use semantic tags when possible for best results |
| `text-transform` | `uppercase`, `lowercase`, `capitalize` applied correctly |
| Text alignment | `text-align: left / center / right` |
| Line spacing and paragraph spacing | Extracted from `line-height`, `margin-top`, `margin-bottom` |
| Bullet and numbered lists | `<ul>`, `<ol>` with `<li>` — including inline formatting within list items |

**Font guidance:** Use fonts available on Windows 11 with Office installed. The converter warns when non-standard fonts are used. Safe choices: Arial, Calibri, Segoe UI, Georgia, Consolas, Courier New, Times New Roman, Verdana, Tahoma, Trebuchet MS, Garamond, Aptos.

### Shapes and Containers

| Feature | Details |
|---------|---------|
| `<div>` with solid background | Extracted as a shape with fill colour |
| Border (uniform) | Single colour and width on all four sides → shape outline |
| Border (partial) | Different widths per side → rendered as individual lines |
| `border-radius` | Converted to PowerPoint rounded rectangle. Values ≥ 50% produce a pill/circle. |
| `box-shadow` | Outer shadows converted to PowerPoint shadow (angle, blur, offset, opacity) |
| Transparency | `rgba()` alpha on backgrounds and text converted to PowerPoint transparency percentage |
| Text inside shapes | Divs with backgrounds containing text render as shapes with styled text (font, size, colour, alignment, padding) |
| Styled inline elements | `<span>`, `<a>`, `<label>` with backgrounds render as pill/badge shapes with centred text |

### Layout and Positioning

| Feature | Details |
|---------|---------|
| `position: absolute / relative` | Elements positioned at their computed bounding rect coordinates |
| CSS Grid | Grid containers produce correctly positioned children |
| Flexbox | Flex containers produce correctly positioned children; flex centering detected for text alignment |
| Padding and margin | Extracted and applied as PowerPoint text box margins |
| `writing-mode: vertical-rl` | Converted to 90° text rotation |
| CSS `transform: rotate()` | Rotation angle extracted and applied |

### Images

| Feature | Details |
|---------|---------|
| `<img>` with local `src` | Image embedded in PPTX from local file path |
| `<img>` with `data:` URI | Base64 image data embedded directly (including in table cells) |
| Inline `<svg>` elements | Rasterised to PNG via screen capture — see Tier 2 for caveats |

### Tables

| Feature | Details |
|---------|---------|
| `<table>` / `<tr>` / `<td>` / `<th>` | Extracted as native PptxGenJS tables with cell-level styling |
| Cell background colours | Per-cell `backgroundColor` extracted and applied |
| Cell text styling | Font size, colour, weight, alignment per cell |
| Cell borders | Extracted from computed border styles |
| Column and row spans | `colspan` and `rowspan` attributes converted to merged cells |
| Row-level highlighting | Background colour on `<tr>` elements propagated to child cells (e.g. `tr.hl` pattern) |
| Table height overflow | When estimated table height exceeds available space, font sizes and margins are scaled down proportionally to fit |

**Guidance for engines:** Use real `<table>` elements for tabular data. All tested engines (Claude, Copilot, ChatGPT) produce standard table markup that converts correctly.

### Other Elements

| Feature | Details |
|---------|---------|
| `<hr>` | Extracted as a horizontal line at the element's vertical centre, with border colour and width |
| Placeholder elements | Elements with `class="placeholder"` rendered as visible grey shapes (configurable) |
| Scale-to-fit | Content exceeding the slide viewport is uniformly scaled down and centred, with a warning |
| Overflow detection | Content extending beyond slide boundaries generates a warning |

---

## Tier 2 — Graceful Degradation

These patterns are supported but with known fidelity trade-offs. The output is usable and the consultant can work with it, but it won't match the browser pixel-for-pixel. **Use these with awareness of the trade-offs noted.**

### Gradient Backgrounds

| Pattern | Behaviour | Trade-off |
|---------|-----------|-----------|
| Slide-level gradient | Captured as a raster PNG background image | Exact colours preserved. Very subtle gradients (< 10% opacity stops) may show banding due to PNG compression. |
| Element-level gradient | Captured as a raster PNG behind the shape, text overlaid separately | Gradient preserved visually. The shape is no longer editable as a native PowerPoint object. |
| Gradient fallback | If capture fails, first colour stop used as solid fill | Colour is approximate. Warning surfaced to the user. |

**Guidance for engines:** Gradients are supported. For best results, use colour stops with enough contrast to survive 8-bit PNG quantisation. Near-transparent gradients (e.g. `rgba(x,y,z,0.08)`) will degrade.

### SVG Elements

| Pattern | Behaviour | Trade-off |
|---------|-----------|-----------|
| Inline `<svg>` | Rasterised to PNG via screen capture at rendered pixel dimensions | Appears as an image in PowerPoint — not editable as vector. Resolution matches screen rendering. |
| SVG charts (recommended for data visualisation) | Captured as raster images with correct positioning | Clean capture for all standard layouts. See scrollable content caveat below. |

**Guidance for engines:** SVG is the recommended approach for charts and data visualisations. SVG charts convert more reliably than JS-generated DOM charts (which are Tier 3 — see below). For charts that the consultant needs to edit in PowerPoint, use HTML/CSS shapes instead.

### Scrollable Slide Content with SVG Charts

Slides whose content exceeds the viewport height (requiring scroll in the browser) may have partial capture of SVG elements near the scroll boundary. All content is extracted and positioned; scale-to-fit reduces element sizes to fit the slide. **Recommendation:** limit SVG chart grids to one row per slide, or reduce SVG `viewBox` heights to keep total content within the viewport.

### Interactive Slideshow Markup

| Pattern | Behaviour | Trade-off |
|---------|-----------|-----------|
| `display: none` slide toggling | Hidden slides are forced visible before extraction | All slides extracted regardless of initial visibility state. |
| `position: absolute` stacking | Stacked slides converted to vertical flow for extraction | Layout recalculation may cause minor positioning shifts. |
| `transform: scale()` viewport wrappers | Transforms stripped from containers; native dimensions used | Correct dimensions recovered. Content transforms within slides preserved. |
| Navigation buttons, dots, controls | Filtered out (buttons, inputs, nav, form elements, onclick handlers) | Interactive chrome does not appear in the PowerPoint output. |
| CSS viewport units (`100vh`) | Inflated containers detected and corrected to original viewport height | Automatic. No action needed from engines. |

**Guidance for engines:** Navigation controls are automatically removed. Don't create hover-dependent content (tooltips, dropdowns) — see Tier 3.

### Tables — Edge Cases

| Pattern | Behaviour | Trade-off |
|---------|-----------|-----------|
| Vertical text in cells (`writing-mode: vertical-rl`) | Rendered as horizontal text with a warning | Content preserved, orientation differs from browser rendering |
| `border-spacing` gaps between cells | Collapsed in PowerPoint output | Minor visual difference — PowerPoint tables don't support cell spacing |

### Fonts

| Pattern | Behaviour | Trade-off |
|---------|-----------|-----------|
| Non-standard fonts | Extracted with the specified font name | PowerPoint silently substitutes if the font is not installed on the viewing machine. The converter warns about non-standard fonts. |

### Emojis

| Pattern | Behaviour | Trade-off |
|---------|-----------|-----------|
| Emoji characters in text | Passed through as Unicode text | Appearance varies by PowerPoint version and platform. May not match browser rendering. Acceptable as placeholders that consultants replace with the organisation's icon suite. |

### Mixed Content Containers

| Pattern | Behaviour | Trade-off |
|---------|-----------|-----------|
| Text alongside decorative block children (swatches, dots) | Text extracted with precise Range-based positioning; decorative elements extracted as separate shapes | Positioning is accurate but derived from the text's actual bounding rect rather than the container's rect. Minor spacing differences possible. |

---

## Tier 3 — Not Supported

These patterns will result in missing or visually broken content. **Do not use these.** AI engine prompts should explicitly exclude them.

### Pseudo-Elements

| Pattern | Why it fails |
|---------|-------------|
| `::before` / `::after` for backgrounds, decorations, or content | Pseudo-elements have no DOM representation. `querySelectorAll('*')` cannot see them. `getComputedStyle()` on the parent does not include pseudo-element styles. The converter has no mechanism to detect or capture them. |

**This is the single most important restriction for AI engine prompts.** ChatGPT in particular uses `::before` extensively for decorative backgrounds and accent elements. A single prompt instruction — "use real DOM elements for all visual content; never use ::before or ::after pseudo-elements" — eliminates this class of issue.

### JS-Generated DOM Charts

| Pattern | Why it fails |
|---------|-------------|
| Inline `<script>` blocks that generate chart elements at runtime | The converter's Content Security Policy blocks inline script execution. Charts generated by `<script>` tags (e.g. `makeBarChart()`) will not render and will be missing from the output. |

**Guidance:** Use inline SVG elements for charts and data visualisations instead of JavaScript-generated DOM elements. SVG charts are Tier 1/2 and produce clean, reliable output. See the SVG section under Tier 2 for details.

### Hidden and Interactive Content

| Pattern | Why it fails |
|---------|-------------|
| Hover-triggered tooltips (`display: none` toggled on hover) | Content that is `display: none` at extraction time is invisible — zero bounding rect, not captured. |
| Accordion/collapsible content hidden by default | Same as above — content must be visible to be extracted. |
| Tab panels with hidden content | Only the initially visible panel is captured. |
| Dropdown menus | Hidden content not extracted. |

**Guidance:** All content intended for the slide must be visible in the static HTML without user interaction.

### CSS Visual Effects Without DOM Representation

| Pattern | Why it fails |
|---------|-------------|
| `clip-path` | Applied in the rendering layer; the element's bounding rect is unaffected but visual clipping is lost. |
| `mask` / `mask-image` | Same — rendering-layer effect with no DOM geometry equivalent. |
| CSS `filter` (blur, brightness, etc.) | No PowerPoint equivalent. The element renders without the filter. |
| `backdrop-filter` | Same — no equivalent in the output format. |
| `mix-blend-mode` | Blending modes have no PowerPoint equivalent. |

### CSS Shape Tricks

| Pattern | Why it fails |
|---------|-------------|
| Border-based shapes (CSS triangles, arrows) | Zero-dimension elements with borders used to create visual shapes. Detected and skipped with a warning. No PowerPoint primitive equivalent. |

**Guidance:** Use actual HTML/CSS shapes (divs with backgrounds and border-radius) or SVG instead of border tricks.

### Media and Embedded Content

| Pattern | Why it fails |
|---------|-------------|
| `<video>`, `<audio>` | No extraction path. Silently ignored. |
| `<canvas>` | Rendered content is not in the DOM. Would require screenshot-based capture (not implemented). |
| `<iframe>` | Blocked by security policy. |
| Remote images (`http://`, `https://`) | Blocked by security policy. All images must be local files or data URIs. |

---

## Engine-Specific Notes

### Claude

Produces the cleanest HTML for conversion. Uses semantic elements, avoids pseudo-elements for decorative content, and structures slides with clear class/attribute signals. Naturally uses `<table>` elements for tabular data and inline SVG for charts. Minimal issues observed.

### Copilot

Similar quality to Claude. Uses `<section>` tags for slide containers (handled correctly by the converter). Occasionally produces deeper div nesting than necessary, but the div-text fallback handles this reliably. Produces standard `<table>` markup for tabular data.

### ChatGPT

Most likely to produce patterns that hit Tier 3 limits:
- Heavy use of `::before` / `::after` for decorative backgrounds and accent elements
- Interactive features (hover tooltips, animated transitions) embedded in slide content
- Inline `<script>` blocks for chart generation (blocked by CSP)
- `min()` and `calc()` expressions for responsive sizing (convert correctly but may produce unexpected dimensions in the fixed extraction viewport)
- May embed charts as base64 `<img>` data URIs — these convert correctly

**Recommended prompt addition for ChatGPT:** "Produce static HTML slides. Use real DOM elements for all visual content — do not use ::before or ::after pseudo-elements. Do not include hover effects, tooltips, or animation. Use inline SVG for any charts or data visualisations — do not use JavaScript to generate chart elements. All content must be visible without user interaction."

---

## Regression Validation

When the converter is modified, validate against the fixture set to confirm no regressions. Each fixture exercises specific capability tiers.

| Fixture | Slides | Key capabilities exercised |
|---------|--------|---------------------------|
| `baseline-semantic-3s.html` | 3 | Tier 1 baseline: semantic markup, card grids, sequences, data-slide-number detection |
| `baseline-shapes-gradient-3s.html` | 3 | Tier 1 shapes + Tier 2 gradient on slide 1 |
| `layout-body-fallback-1s.html` | 1 | Tier 1 div-text fallback, lists, placeholder rendering, body-fallback detection |
| `baseline-dense-12s.html` | 12 | Tier 1 dense content: metrics, cards, two-column, contrast blocks, data-notes. Tier 1 scale-to-fit. |
| `slideshow-stacked-3s.html` | 3 | Tier 2 stacked slideshow: gradient capture, interactive filtering, badge/shape text, CSS triangle detection |
| `visual-transform-svg-1s.html` | 1 | Tier 2 viewport scaling + Tier 2 SVG rasterisation + Tier 1 pill shapes |
| `visual-svg-grid-1s.html` | 1 | Tier 2 viewport scaling + Tier 2 SVG rasterisation (12 SVGs) |
| `slideshow-displaynone-8s.html` | 8 | Tier 2 display-none slideshow + Tier 2 gradient capture at scale |
| `slideshow-heatmap-12s.html` | 12 | Tier 2 display-none slideshow + Tier 1 heatmap grid (shapes with text) |
| `table-heatmap-rowspan-12s.html` | 12 | Tier 1 tables: rowspan, per-cell colours. Tier 2 vertical text warning. |
| `ref-tier3-jscharts-10s.html` | 10 | Tier 1 tables with row highlighting. Tier 2 viewport unit fix. JS chart Tier 3 limit. |
| `table-simple-base64img-33s.html` | 33 | Tier 1 tables + base64 images. Section-based slide detection. |
| `visual-svg-charts-hybrid.html` | 9 | Tier 2 inline SVG charts via slide-reposition capture. Reference SVG chart fixture. |
| `engine-claude-financial-14s.html` | 14 | Tier 1/2 integration: SVG charts, tables, data-slide-number, Claude engine output |
| `engine-chatgpt-workshop-9s.html` | 9 | Tier 1/2 integration: SVG icons, tables, shapes, ChatGPT engine output |
| `engine-copilot-overview-8s.html` | 8 | Tier 1/2 integration: SVG icons, class-slide detection, Copilot engine output |
| `engine-copilot-peers-tables-11s.html` | 11 | Tier 1 tables, lists, section-children detection, Copilot engine output |

### Validation checklist

For each fixture, confirm:

1. **Slide count** — correct number of slides detected
2. **Detection method** — correct method used (data-slide-number, class-slide, section-children, body-fallback, etc.)
3. **Element count** — no significant change (small variations acceptable from extraction improvements)
4. **Visual spot check** — open the PPTX and confirm key content is present and positioned correctly
5. **Warnings** — expected warnings present (font warnings, gradient fallbacks, etc.), no unexpected errors

---

## Configuration

The converter supports the following user-configurable options:

| Setting | Default | Options |
|---------|---------|---------|
| Output location | Same directory as source HTML | Same directory, Save As dialog, fixed folder |
| Div text handling | `fallback` (render text in bare divs) | `fallback`, `strict` (skip with warning) |
| Placeholder rendering | `visible` (grey shapes) | `visible`, `hidden` |
| Placeholder fill colour | `#D9D9D9` | Any 6-char hex |
| Placeholder transparency | 50% | 0–100 |

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Feb 2026 | Initial capability profile derived from 8 development sessions and 12 test fixtures |
| 2.0 | Mar 2026 | Tables promoted from Tier 3 to Tier 1/2 (Sessions 9/9b). JS-generated DOM charts added to Tier 3 (Session 12/13). SVG chart guidance expanded. Scrollable content edge case documented. Regression table updated with new fixture names and 4 new engine fixtures. Engine-specific guidance updated for ChatGPT chart patterns. Viewport unit fix added to Tier 2. Fixture names updated to match canonical manifest. |
