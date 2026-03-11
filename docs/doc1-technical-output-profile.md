# Technical Output Profile: HTML for PowerPoint Conversion

## Version 2.0

> **Purpose:** This document defines the HTML/CSS that automated conversion tooling can translate into Microsoft PowerPoint (.pptx) slides. It is organised into three tiers based on empirical testing across Claude, Copilot and ChatGPT output: features that convert faithfully, features that degrade gracefully, and features that are not supported.
>
> **What's new in v2.0:** This version replaces v1.0 and v1.1. The supported feature set has expanded significantly — gradients, SVG, transparency, absolute positioning, box shadows, tables with merged cells, and inline SVG charts are now handled by the converter. The document is restructured around capability tiers rather than a restrictive allowlist. The conversion intents file (v1.1) has been removed — the converter's heuristic detection is sufficient.
>
> **When to use:** Attach this document to your AI prompt when the intended output format is a single-file HTML document destined for automated PPTX conversion.
>
> **Companion documents:**
> - *Presentation Design Principles* — medium-agnostic guidance on effective visual communication. Apply alongside this document.
> - *Brand Token Layer [Brand Name]* — brand-specific visual identity tokens. Apply when output must conform to a specific brand.
>
> **Audience:** Any AI assistant used to generate slide-based HTML content for PowerPoint conversion.

---

## 1. Slide Structure

### 1.1 Slide Boundary Convention

Each slide MUST be a distinct HTML element. The converter detects slides using the following cascade (first match wins):

| Priority | Pattern | Example |
|----------|---------|---------|
| 1 | `data-slide-number` attribute | `<section data-slide-number="1">` |
| 2 | `class="slide"` on `<section>` or `<div>` | `<div class="slide">` |
| 3 | Multiple `<section>` children of `<body>` | `<body><section>…</section><section>…</section></body>` |
| 4 | Multiple uniform-width `<div>` children of `<body>` | Heuristic — similar width, > 100px tall |
| 5 | `<body>` as single slide | Fallback for single-slide documents |

**Recommended approach:** Use `<section class="slide" data-slide-number="N">` for each slide. This is unambiguous, works with any number of slides, and gives the converter a reliable signal.

**Rules:**
- Every slide container produces exactly one PowerPoint slide.
- Slides are rendered in document order.
- All slides must be siblings — do not nest slides inside other slides.
- Each slide must be self-contained.

**Optional metadata attributes:**
- `data-slide-number` — explicit ordering hint
- `data-layout` — layout intent label (informational — the converter detects layout from CSS)
- `data-title` — slide title for PowerPoint's outline view
- `data-notes` — content placed in PowerPoint speaker notes pane. If absent, the converter generates a breadcrumb from the slide's first heading.
- `data-background` — background colour hint (hex)

### 1.2 Slide Dimensions

Fixed pixel dimensions are recommended. The converter uses the slide container's bounding rect as the viewport for positioning all content.

| Dimension | Recommended | Also supported |
|-----------|-------------|----------------|
| Standard | 960 × 540 px | Any 16:9 ratio |
| Widescreen | 1280 × 720 px | Any fixed dimensions |

The converter creates a custom PowerPoint layout matching the first slide's dimensions. All slides in a deck use the same layout.

### 1.3 Document Structure

Every generated HTML file should follow this structure:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Presentation Title</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    .slide {
      width: 960px;
      height: 540px;
      padding: 48px 56px;
      background-color: #FFFFFF;
      font-family: Arial, 'Segoe UI', sans-serif;
      font-size: 12pt;
      color: #000000;
      overflow: hidden;
      page-break-after: always;
    }

    /* All presentation styles below — use class selectors */
  </style>
</head>
<body>
  <section class="slide" data-slide-number="1">
    <!-- Slide 1 content -->
  </section>
  <section class="slide" data-slide-number="2">
    <!-- Slide 2 content -->
  </section>
</body>
</html>
```

**Key requirements:**
- Single `<style>` block in `<head>` — no external stylesheets.
- No navigation UI (buttons, dots, slide counters).
- Define colour values as hex in class-based CSS to enable downstream brand remapping.

### 1.4 Vertically Stacked Layout

Slides should be arranged vertically in document flow (one after the other). This is the simplest pattern and produces the most reliable extraction. The converter also handles `display: none` slideshow patterns and `position: absolute` stacked layouts — these work but are unnecessary complexity when generating fresh content.

---

## 2. Tier 1 — Faithful Conversion

These features convert with high fidelity. The PowerPoint output closely matches the browser rendering. **Use these freely.**

### 2.1 Text

| Feature | Details |
|---------|---------|
| Semantic text elements | `<p>`, `<h1>`–`<h6>` — extracted with full styling |
| Inline formatting | `<b>`, `<strong>`, `<i>`, `<em>`, `<u>`, `<span>` with per-run colour, font size, bold, italic, underline |
| Text in bare `<div>` elements | Extracted via fallback — use semantic tags when possible for best results |
| `text-transform` | `uppercase`, `lowercase`, `capitalize` |
| Text alignment | `text-align: left / center / right` |
| Line spacing and paragraph spacing | From `line-height`, `margin-top`, `margin-bottom` |
| Bullet and numbered lists | `<ul>`, `<ol>` with `<li>` — including inline formatting within list items |
| Hyperlinks | `<a>` with `href` — preserved as clickable links in PowerPoint |
| Subscript and superscript | `<sub>`, `<sup>` |

**Font guidance:** Use fonts available on Windows 11 with Office installed. The converter warns when non-standard fonts are used. Safe choices: Arial, Calibri, Segoe UI, Georgia, Consolas, Courier New, Times New Roman, Verdana, Tahoma, Trebuchet MS, Garamond, Aptos.

**Heading guidance:** Use `<h1>`–`<h6>` elements for headings rather than styled `<div>` elements. The converter extracts semantic heading elements with full styling fidelity. Styled divs are supported via fallback but may lose heading hierarchy information.

### 2.2 Shapes and Containers

| Feature | Details |
|---------|---------|
| `<div>` with solid background | Extracted as a shape with fill colour |
| Border (uniform) | Single colour and width on all four sides → shape outline |
| Border (partial) | Different widths per side → rendered as individual lines |
| `border-radius` | Converted to PowerPoint rounded rectangle. Values ≥ 50% produce a pill/circle. |
| `box-shadow` | Outer shadows converted to PowerPoint shadow (angle, blur, offset, opacity) |
| Transparency | `rgba()` alpha on backgrounds and text → PowerPoint transparency percentage |
| Text inside shapes | Divs with backgrounds containing text render as shapes with styled text (font, size, colour, alignment, padding) |
| Styled inline elements | `<span>`, `<a>`, `<label>` with backgrounds render as pill/badge shapes with centred text |

### 2.3 Layout and Positioning

| Feature | Details |
|---------|---------|
| `display: flex` | Flex containers produce correctly positioned children; `justify-content` and `align-items` detected |
| `display: grid` | Grid containers produce correctly positioned children |
| `display: block / inline-block` | Standard flow layout |
| `position: absolute / relative` | Elements positioned at their computed bounding rect coordinates |
| `gap` | Flex and grid gap |
| Padding and margin | Applied as PowerPoint text box margins |
| `width`, `height`, `max-width` | Pixels and percentages |
| `writing-mode: vertical-rl` | Converted to 90° text rotation |
| CSS `transform: rotate()` | Rotation angle extracted and applied to the PowerPoint shape |
| `calc()` | Resolved by the browser before extraction — use freely |
| CSS custom properties (`var()`) | Resolved by the browser before extraction — use freely for theming and brand token mapping |

### 2.4 Images

| Feature | Details |
|---------|---------|
| `<img>` with local `src` | Image embedded in PPTX from local file path |
| `<img>` with `data:` URI | Base64 image data embedded directly |

**Guidance:** For embedded charts, diagrams, or icons that are provided as images, use `data:` URIs (base64-encoded). Remote URLs (`http://`, `https://`) are blocked by security policy.

### 2.5 Tables

| Feature | Details |
|---------|---------|
| `<table>` / `<tr>` / `<td>` / `<th>` | Extracted as native PptxGenJS tables with cell-level styling |
| `<thead>` / `<tbody>` | Header rows distinguished from body rows |
| Cell background colours | Per-cell `backgroundColor` extracted and applied |
| Cell text styling | Font size, colour, weight, alignment per cell |
| Cell borders | Extracted from computed border styles |
| `colspan` and `rowspan` | Converted to merged cells in PowerPoint |
| Row-level highlighting | Background colour on `<tr>` elements propagated to child cells |
| Table overflow | When content exceeds available space, font sizes and margins are scaled proportionally |

**Guidance:** Use real `<table>` elements for tabular data. All tested engines produce standard table markup that converts correctly. For complex data grids with per-cell colours (heatmaps, RAG status matrices), tables with cell-level styling are the recommended approach.

### 2.6 Other Elements

| Feature | Details |
|---------|---------|
| `<hr>` | Horizontal line at the element's vertical centre, with border colour and width |
| `<blockquote>` | Styled text frame with indent |
| Placeholder elements | Elements with `class="placeholder"` rendered as grey shapes (configurable) |
| Scale-to-fit | Content exceeding the slide viewport is uniformly scaled down and centred |
| `overflow: hidden` | Converter handles overflow clipping — content is extracted regardless |

### 2.7 Supported Layout Patterns

The converter handles any layout that uses the CSS features listed above. These common patterns are tested and reliable:

**Title slide** — heading, subtitle, optional section label.

**Title + body** — heading with paragraphs and/or lists below.

**Card grid** — `display: grid` with `grid-template-columns: repeat(N, 1fr)`. Typically 2–4 columns, maximum 6 cards per slide.

**Two-column layout** — `display: grid` with `grid-template-columns: 1fr 1fr` (or weighted: `2fr 1fr`).

**Horizontal sequence / timeline** — `display: flex` with step containers. Arrow connectors between steps should use styled `<div>` elements with text arrow characters (e.g., `→`), not CSS border tricks or pseudo-elements.

**Data highlight / key metrics** — `display: flex` with metric containers, each containing a large value and a description label.

**Pillar layout** — `display: flex` with accent `border-left` on each pillar.

**Contrast / compare** — two-column grid with visually distinct background treatments.

Creative variations beyond these patterns are supported — the converter extracts from computed styles, not from pattern matching. If it renders correctly in a browser, it will generally extract correctly.

---

## 3. Tier 2 — Graceful Degradation

These features are supported but with known fidelity trade-offs. The output is usable and editable in PowerPoint, but won't match the browser pixel-for-pixel. **Use these with awareness of the trade-offs noted.**

### 3.1 Gradient Backgrounds

| Pattern | Behaviour | Trade-off |
|---------|-----------|-----------|
| Slide-level gradient | Captured as a raster PNG background image | Exact colours preserved. Very subtle gradients (< 10% opacity stops) may show banding. |
| Element-level gradient | Captured as a raster PNG behind the shape, text overlaid separately | Gradient preserved visually. The shape is no longer editable as a native PowerPoint object. |
| Gradient fallback | If capture fails, first colour stop used as solid fill | Colour is approximate. |

**Guidance:** Gradients add visual depth and are worth using for section transitions, hero elements, and backgrounds. For best results, use colour stops with enough contrast to survive 8-bit PNG quantisation. Near-transparent gradients (e.g., `rgba(x,y,z,0.08)`) may degrade.

### 3.2 Inline SVG Elements

| Pattern | Behaviour | Trade-off |
|---------|-----------|-----------|
| Inline `<svg>` | Rasterised to PNG via screen capture at rendered pixel dimensions | Appears as an image in PowerPoint — not editable as vector. Resolution matches screen rendering. |

**Guidance:** SVG is the recommended approach for charts and data visualisations. SVG charts convert more reliably than JavaScript-generated DOM charts (which are not supported — see Tier 3). For charts that the consultant needs to edit natively in PowerPoint, use HTML/CSS shapes (divs with backgrounds, text, borders) instead of SVG.

**Edge case:** Slides whose content exceeds the viewport height may have partial capture of SVG elements near the scroll boundary. Recommendation: keep total slide content within the declared slide dimensions, or limit SVG chart grids to one row per slide.

### 3.3 Interactive Slideshow Markup

The converter handles these patterns when encountered in existing HTML, but they are unnecessary when generating fresh content (use vertically stacked slides instead).

| Pattern | Behaviour | Trade-off |
|---------|-----------|-----------|
| `display: none` slide toggling | Hidden slides forced visible before extraction | All slides extracted. |
| `position: absolute` stacking | Stacked slides converted to vertical flow | Minor positioning shifts possible. |
| `transform: scale()` viewport wrappers | Transforms stripped; native dimensions recovered | Correct dimensions. Content transforms within slides preserved. |
| Navigation buttons, dots, controls | Filtered out automatically | Interactive chrome does not appear in output. |
| CSS viewport units (`100vh`) | Inflated containers detected and corrected | Automatic. |

### 3.4 Table Edge Cases

| Pattern | Behaviour | Trade-off |
|---------|-----------|-----------|
| Vertical text in cells (`writing-mode: vertical-rl`) | Rendered as horizontal text | Content preserved, orientation differs |
| `border-spacing` gaps between cells | Collapsed in PowerPoint | Minor visual difference |

### 3.5 Fonts and Emoji

| Pattern | Behaviour | Trade-off |
|---------|-----------|-----------|
| Non-standard fonts | Extracted with specified font name | PowerPoint substitutes if font is not installed. Converter warns. |
| Emoji characters in text | Passed through as Unicode | Appearance varies by platform. Acceptable as placeholders. |

### 3.6 Mixed Content Containers

| Pattern | Behaviour | Trade-off |
|---------|-----------|-----------|
| Text alongside decorative block children | Text extracted with Range-based positioning; decorative elements as separate shapes | Minor spacing differences possible |

---

## 4. Tier 3 — Not Supported

These patterns will result in missing or visually broken content. **Do not use these.**

### 4.1 Pseudo-Elements — The Critical Restriction

| Pattern | Why it fails |
|---------|-------------|
| `::before` / `::after` for backgrounds, decorations, or content | Pseudo-elements have no DOM representation. No JavaScript API can enumerate them. The converter cannot detect or capture them. |

**This is the single most important restriction.** Use real DOM elements (a `<div>` or `<span>`) for all visual content — decorative backgrounds, accent bars, bullet markers, quotation marks, and any element that should appear in the PowerPoint output. If it matters visually, it must exist in the DOM.

### 4.2 JavaScript-Generated Content

| Pattern | Why it fails |
|---------|-------------|
| Inline `<script>` blocks | Blocked by Content Security Policy. Charts or content generated by JavaScript will not render. |
| Dynamic content requiring JS execution | Content must be present in the static HTML DOM. |

**Guidance:** Use inline SVG for charts and data visualisations. Do not use JavaScript to generate chart elements at runtime.

### 4.3 Hidden and Interactive Content

| Pattern | Why it fails |
|---------|-------------|
| Hover-triggered tooltips | Content `display: none` at extraction time has zero bounding rect — not captured. |
| Accordion/collapsible content | Same — only visible content is extracted. |
| Tab panels with hidden content | Only the initially visible panel is captured. |
| Dropdown menus | Hidden content not extracted. |

**All content intended for the slide must be visible in the static HTML without user interaction.**

### 4.4 CSS Visual Effects Without DOM Representation

| Pattern | Why it fails |
|---------|-------------|
| `clip-path` | Rendering-layer effect; bounding rect unaffected but visual clipping lost. |
| `mask` / `mask-image` | Same — no DOM geometry equivalent. |
| CSS `filter` (blur, brightness, etc.) | No PowerPoint equivalent. Element renders without the filter. |
| `backdrop-filter` | No PowerPoint equivalent. |
| `mix-blend-mode` | No PowerPoint equivalent. |

### 4.5 CSS Shape Tricks

| Pattern | Why it fails |
|---------|-------------|
| Border-based triangles and arrows | Zero-dimension elements with borders. Detected and skipped. No PowerPoint primitive equivalent. |

**Guidance:** Use SVG or HTML/CSS shapes (divs with backgrounds and border-radius) instead of border tricks.

### 4.6 Media and Embedded Content

| Pattern | Why it fails |
|---------|-------------|
| `<video>`, `<audio>` | No extraction path. |
| `<canvas>` | Rendered content not in the DOM. |
| `<iframe>` | Blocked by security policy. |
| Remote images (`http://`, `https://`) | Blocked by security policy. Use local file paths or `data:` URIs. |

---

## 5. Engine-Specific Guidance

### Claude

Produces the cleanest HTML for conversion. Uses semantic elements, avoids pseudo-elements, and structures slides with clear class/attribute signals. Naturally uses `<table>` elements for tabular data and inline SVG for charts. The layered document approach works well — start with this document alone to get conversion-safe output, add the Design Principles for quality, add the Brand Token Layer for brand compliance.

### Copilot

Similar quality to Claude. Uses `<section>` tags for slide containers (handled correctly). Occasionally produces deeper div nesting than necessary — the converter handles this via div-text fallback. Produces standard `<table>` markup for tabular data. Benefits from more explicit layout instructions in the prompt (e.g., "use a three-column card grid" rather than relying on interpretation of the design principles).

### ChatGPT

Most likely to produce patterns that hit Tier 3 limits. Specific risks and mitigations:

- **Pseudo-elements:** Heavy use of `::before` / `::after` for decorative backgrounds and accent elements. Must be explicitly instructed to use real DOM elements.
- **JavaScript charts:** May generate inline `<script>` blocks for chart rendering. Must be instructed to use inline SVG instead.
- **Interactive features:** May embed hover tooltips, animated transitions, and navigation controls. Must be instructed to produce static content.
- **Base64 images:** May embed charts as `data:` URI `<img>` tags — these convert correctly and are acceptable.

**Recommended prompt addition for ChatGPT:** "Produce static HTML slides. Use real DOM elements for all visual content — do not use `::before` or `::after` pseudo-elements. Do not include hover effects, tooltips, or animation. Use inline SVG for any charts or data visualisations — do not use JavaScript to generate chart elements. All content must be visible without user interaction."

---

## 6. Conversion Safety Checklist

Before finalising generated HTML, verify:

- [ ] Every slide is a `<section class="slide">` with `data-slide-number`
- [ ] All styles in a single `<style>` block in `<head>` — no external CSS
- [ ] No `<script>` tags anywhere
- [ ] No pseudo-elements (`::before`, `::after`) used for visible content
- [ ] No hover-dependent or interaction-dependent content
- [ ] All images use local file paths or `data:` URIs — no remote URLs
- [ ] All `<img>` tags include explicit `width` and `height` attributes
- [ ] No web-app navigation chrome (buttons, dots, slide counters)
- [ ] Tables use `<thead>`/`<tbody>` where applicable
- [ ] Slide dimensions set to 960×540px or 1280×720px (or equivalent 16:9)

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025 | Initial release — restrictive HTML/CSS allowlist |
| 1.1 | 2026 | Added conversion intents file. Added pillar and contrast layout patterns. |
| 2.0 | 2026 | Complete restructure around capability tiers. Gradients, SVG, transparency, absolute positioning, box shadows, tables with merged cells, CSS custom properties, and calc() now supported. Intents file removed (converter heuristic detection sufficient). Engine-specific guidance updated. |
