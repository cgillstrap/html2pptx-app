# Architectural Principles — HTML to PPTX Converter

## Context

These principles govern the design and development of a standalone Electron desktop application deployed to a managed Windows 11 estate within a professional services organisation. The target users are management consultants — technically literate but not developers. The codebase should be maintainable by a developer or competent technologist who may not have authored the original code.

These principles are pragmatic, not academic. They are derived from enterprise architectural standards (separation of concerns, clean architecture, domain-driven design) but scaled to fit a focused desktop tool. Where a principle from the enterprise playbook doesn't apply, we say so and move on.

---

## Principle 1: Security by Default

**The application must not introduce risk or vulnerability to the end user's security posture.**

This is the non-negotiable. The target estate is well-defended and we must not undermine that. Specific commitments:

- **No network access.** The app processes local files only. Remote images, scripts, and fetches are blocked at multiple layers (CSP headers, navigation guards, path validation in the generator).
- **No Node.js in the renderer.** The renderer process runs with `nodeIntegration: false`, `contextIsolation: true`, and communicates with the main process exclusively through a controlled IPC bridge (`preload.js`).
- **Input validation at the boundary.** File paths from drag-and-drop are validated (extension whitelist, path normalisation, traversal checks) before any processing begins. The extractor and generator each independently validate paths they receive — defence in depth, not single-gate trust.
- **Principle of least privilege.** Hidden BrowserWindows used for extraction run sandboxed with no preload script. They execute a self-contained extraction function and are destroyed immediately after use.
- **No persistence of sensitive data.** Configuration is currently in-memory. When persistence is added (Phase 3), it will store user preferences only — never file contents or paths.

**Decision test:** Before adding any capability, ask: "Does this require relaxing a security control?" If yes, document the justification and the compensating control, and discuss before committing.

---

## Principle 2: Separation of Concerns

**Each module has a single, well-defined responsibility. Modules communicate through clear contracts, not shared state.**

The current module boundaries and their responsibilities:

| Module | Responsibility | Does NOT do |
|--------|---------------|-------------|
| `main.js` | Orchestration, IPC routing, app lifecycle | Conversion logic, DOM access |
| `preload.js` | Secure IPC bridge between renderer and main | Business logic, file I/O |
| `security.js` | CSP, navigation guards, path validation | Conversion, UI |
| `config.js` | Centralised settings, defaults, validation | File I/O (yet), UI rendering |
| `extractor.js` | HTML → intermediate JSON (runs in Chromium) | File writing, PPTX generation |
| `generator.js` | Intermediate JSON → PPTX via pptxgenjs | DOM access, HTML parsing |
| `renderer.js` + `index.html` | User interface, drag-and-drop, status display | File system access, conversion |

**The critical boundary:** Extraction produces a JSON intermediate representation. Generation consumes it. These two modules never import each other and share no state. This boundary exists deliberately — it means either side can be replaced, extended, or tested independently. If we later want to generate Google Slides or PDF output, only the generator changes.

**Decision test:** If a change requires a module to import from a layer it currently doesn't depend on, stop and discuss whether the responsibility boundary needs redrawing.

---

## Principle 3: Documentation for Handover

**Code must be readable and understandable by someone who didn't write it, without requiring a walkthrough from the author.**

This means:

- **Architectural intent at the top of every file.** Each source file opens with a comment block explaining *why* the module exists, *what* decisions shaped it, and *what contract* it fulfils (inputs, outputs, error behaviour). This is already established in the codebase — maintain it for all new files.
- **Inline comments for non-obvious decisions.** We don't comment what the code does (the code says that). We comment *why* a particular approach was chosen, especially where it differs from what a reader might expect. Example: the `// PptxGenJS margin order is [left, right, bottom, top] — NOT CSS order` comment in the generator.
- **Progress.md as the living project log.** Decisions, pivots, phase status, and known issues are recorded here. New sessions start by reading it. It's not a design document — it's a decision journal.
- **End-user documentation when packaging.** MVP packaging must include a minimal README or in-app guidance: what file formats are supported, what to expect, what known limitations exist. Consultants won't read source code to troubleshoot.

**Decision test:** Could someone with Node.js and Electron familiarity (but no context on this project) read a module and understand what it does, why, and how it fits into the whole? If not, add documentation before moving on.

---

## Principle 4: Design for Extensibility and Maintainability

**Make the likely future changes easy. Don't over-engineer for unlikely ones.**

Based on the project roadmap, the likely extension points are:

- **New output strategies** (save dialog, fixed folder) — handled by `config.js` settings and a strategy pattern in `main.js`
- **New output formats** (Google Slides, PDF) — enabled by the extraction/generation boundary; new generators consume the same intermediate JSON
- **New slide detection heuristics** — the detection cascade in the extractor is ordered and additive; new methods slot in without disrupting existing ones
- **Settings UI** — config.js is already designed for this; the renderer just needs a panel that calls `updateConfig()`
- **Brand/template support** — the extraction layer already captures data attributes; the generator can use these to select layouts

What we explicitly do *not* design for:

- Plugin architectures or dynamic module loading
- Multi-user or server-side deployment
- Real-time collaboration or cloud sync
- Hex/onion/clean architecture layering — the app is a pipeline (HTML → extract → generate → file), not a request/response system with domain aggregates

**Decision test:** "Is this extension point on the roadmap or a natural consequence of the current architecture?" If yes, design for it. If it's speculative, don't add abstractions for it — just keep the code clean enough that refactoring is straightforward.

---

## Principle 5: Reuse Before Building

**Check what exists before writing new code. Ported and proven beats novel and untested.**

This was learned the hard way in Phase 2. We spent time building a custom generator, discovered fidelity gaps, then pivoted to porting the battle-tested logic from `html2pptx-local.cjs`. The ported code — `extractSlideData()`, `addElements()`, `addBackground()`, `parseInlineFormatting()` — carries the accumulated edge-case handling of the original project.

This principle applies at every level:

- **Libraries over custom code.** pptxgenjs for PPTX generation, Electron's BrowserWindow for rendering, webUtils for file path resolution. We don't reimplement what a maintained library provides.
- **Upstream logic over reimplementation.** When the source repository handles a case (rotation, shadows, partial borders, inline formatting runs), we port that handling rather than inventing our own approach.
- **Platform capabilities over workarounds.** Electron provides CSP, context isolation, navigation guards, and sandboxing. We use these rather than building application-level equivalents.

When we do build something new (multi-slide detection, div-text fallback, placeholder rendering), it's because no upstream equivalent exists for our specific use case. These additions are clearly marked in the code with comments distinguishing ported logic from our additions.

**Decision test:** Before writing a new function or module, ask: "Does the source repo, a library, or the platform already handle this?" If yes, use it. If partially, extend it. If no, build it and document why.

---

## What We Deliberately Excluded from Enterprise Patterns

The SKILL.md reference document describes patterns appropriate for large-scale enterprise applications. For this project, the following are explicitly out of scope and should not be introduced:

- **Hexagonal / Clean Architecture layering** — This is a conversion pipeline, not a domain-rich application. The extraction→generation flow is the architecture.
- **Domain-Driven Design constructs** (aggregates, bounded contexts, domain events) — There is no complex domain model here. The "domain" is: HTML goes in, PPTX comes out.
- **Interface-first / ports-and-adapters** — With only one implementation per concern and no dependency injection framework, adding interfaces would be ceremony without value. If we later need multiple generators, we refactor then.
- **Immutable domain models** — Config is the closest thing to a domain model and it's already handled with frozen copies. No need for a broader immutability pattern.
- **Mandatory 80% test coverage** — The extraction logic runs inside Chromium's `executeJavaScript()` and is not unit-testable in a conventional sense. We test through integration (fixture HTML → expected PPTX output). Unit tests where practical (config, path validation), integration tests for the pipeline.

These exclusions are pragmatic, not lazy. If the project grows in scope to warrant these patterns, we revisit.
