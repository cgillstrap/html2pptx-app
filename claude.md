# CLAUDE.md — html2pptx-app

## What This Project Is

A standalone Electron desktop app that converts AI-generated HTML files to PowerPoint (.pptx). Target users are management consultants on managed Windows 11 machines. The conversion pipeline is: HTML → extract (hidden BrowserWindow) → intermediate JSON → generate (pptxgenjs) → .pptx file.

## How to Run

```bash
npm install
npm start                # Launch the Electron app
npm run test:regression  # Run fixture-driven regression tests (16 pass, 6 skip)
npm test                 # Run renderer-side unit tests (electron-mocha --renderer)
```

## Project Structure

```
src/
  main/
    main.js          # Electron entry point, orchestration, IPC routing
    preload.js       # Secure IPC bridge (contextBridge)
    security.js      # CSP, navigation guards, path validation
    config.js        # Centralised settings, defaults, validation
  extraction/
    extractor.js     # HTML → intermediate JSON via hidden BrowserWindow
  generation/
    generator.js     # Intermediate JSON → PPTX via pptxgenjs
  renderer/
    index.html       # Drag-and-drop UI
    renderer.js      # UI logic, IPC callbacks, status display
test/
  fixtures/          # Renamed test fixtures — see manifest.md for full listing
  diagnostic/        # Diagnostic scripts and output
```

## Critical Architecture Rules

These are non-negotiable. Read PRINCIPLES.md for the full rationale.

1. **Extraction and generation never import each other.** They communicate through the intermediate JSON structure. If you need to change the JSON contract, document it in progress.md.

2. **No Node.js in the renderer.** The renderer communicates with main exclusively through the IPC bridge in preload.js. Never add nodeIntegration or disable contextIsolation.

3. **No network access.** Remote images, scripts, and fetches are blocked. CSP headers enforce this. Never add exceptions.

4. **Hidden BrowserWindows run sandboxed with no preload.** They execute the extraction script via executeJavaScript() and are destroyed immediately after use.

5. **Security validation at every boundary.** File paths are validated in security.js AND in the generator (defence in depth). Image paths are checked for traversal. Remote URLs are blocked.

## Module Responsibilities — What Goes Where

| Decision | Owner |
|----------|-------|
| "Is this element slide content?" | extractor.js |
| "What does this element look like?" | extractor.js (computed styles) |
| "Does content fit the slide?" | generator.js (scale-to-fit) |
| "How is this rendered in PPTX?" | generator.js (pptxgenjs calls) |
| "What settings apply?" | config.js (always via getConfig()) |
| "Is this file safe to process?" | security.js (path validation) |
| "What should the user see?" | renderer.js (status, warnings) |

If a change requires a module to import from a layer it currently doesn't depend on, stop and discuss in a chat session first.

## Coding Conventions

### Extraction Script (inside EXTRACTION_SCRIPT template literal)

- Runs in Chromium via `executeJavaScript()` — **no Node.js APIs available**
- Use `var` and `function()` (not `const`/`let`/arrow functions) for the extraction script's own variables and callbacks. The surrounding template literal uses modern JS, but injected code should be conservative for compatibility.
- All positions are extracted relative to the container offset (`offX`, `offY`)
- Units: positions in inches (via `pxToInch`), font sizes in points (via `pxToPoints`)
- The `processed` Set prevents duplicate extraction of nested elements
- Warnings go in the `errors` array (naming is legacy — they surface as warnings in the UI)

### Generator

- PptxGenJS margin order is `[left, right, bottom, top]` — NOT CSS order
- `inset: 0` on text boxes removes default PowerPoint internal padding
- Single-line text gets 2% width increase to prevent clipping
- Security: all image paths validated, remote URLs blocked, traversal checked

### General

- Every source file has a header comment block explaining why the module exists, what decisions shaped it, and what contract it fulfils
- Inline comments explain *why*, not *what* — especially where behaviour differs from expectation
- No new dependencies without discussion in a chat session first

## Key Technical Details

### Slide Detection Cascade
The extractor tries detection methods in this order:
1. `[data-slide-number]` attributes (guardrails-compliant HTML)
2. `section.slide` or `div.slide` class (CSS slideshow patterns)
3. Direct `<section>` children of body
4. Uniform-width direct `<div>` children of body
5. Body as single slide (fallback)

### Intermediate JSON Contract
Each slide in the extraction result contains:
- `viewport` — `{ w, h }` in pixels
- `background` — `{ type, value/data/path }` 
- `elements[]` — each with `type`, `position`, `style`, `text`
- `placeholders[]` — `{ id, x, y, w, h }` in inches
- `errors[]` — warning strings surfaced to the UI
- `dataAttributes` — from the container's dataset
- `title` — extracted from first h1/h2

Element types: `image`, `line`, `shape`, `list`, `div-text`, `p`, `h1`–`h6`

Shapes can have a `style` property with text styling (font, colour, alignment) when they contain text content. The generator applies these via addText().

### Gradient Handling
- Slide-level gradients: detected in extraction, rasterised via capturePage() before hidden window closes
- Element-level gradients: detected, warning surfaced, first colour stop extracted as solid fallback via `extractGradientFallbackColor()`
- `resolveShapeFill()` handles the backgroundColor-is-transparent case

## Current State

**Always read `progress.md` before starting work.** It contains:
- What's done and what's pending
- The current session priorities
- Known issues and test gaps
- Decision log with rationale

## Task Workflow

Tasks arrive in one of two ways:

1. **From progress.md** — the "Next Session Priorities" section lists agreed work items with enough context to execute.

2. **From a task description** — the user will describe what to do, sometimes referencing a chat session discussion. The task will be specific and scoped.

When completing a task:
- Update the relevant section of progress.md (File Status table, phase checklist, decision log if a decision was made)
- If you changed the intermediate JSON contract, document what changed
- If you added a new fixture, add it to the Testing Notes table
- Run `npm start` and test with the relevant fixtures if the change affects extraction or generation
- Commit with a descriptive message referencing the session/phase

## What NOT to Do Without Chat Discussion First

- Add new dependencies to package.json
- Change the module boundary between extraction and generation
- Modify security controls (CSP, sandbox, navigation guards)
- Add network access of any kind
- Change the slide detection cascade order
- Restructure the intermediate JSON contract
