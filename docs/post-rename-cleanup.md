# Post-Rename Cleanup: Outstanding Items

**Date:** 2026-03-11
**Context:** Fixture rename completed in commit `d178be4`. This document lists remaining cleanup items identified during the rename.

---

## Action Required

### 1. Diagnostic script default argument

**File:** `test/diagnostic/slide-geometry.js` (line 15)
```javascript
const fixtureName = args[fixtureIdx + 1] || 'barclays-hybrid.html';
```
**Action:** Update default to `visual-svg-charts-hybrid.html`.

### 2. Diagnostic script fixture search paths

**Files:** `test/diagnostic/dump-extraction.js` (lines 20–23), `test/diagnostic/slide-geometry.js`

Both scripts search `tests/extraction/fixtures/` and `test/extraction/fixtures/` — neither searches the new canonical path `test/fixtures/`.

**Action:** Add `test/fixtures/` to the search paths in both scripts. Example:
```javascript
const fixturePaths = [
  path.join(__dirname, '..', 'fixtures', fixtureName),           // new canonical
  path.join(__dirname, '..', '..', 'tests', 'extraction', 'fixtures', fixtureName),
  path.join(__dirname, '..', '..', 'test', 'extraction', 'fixtures', fixtureName)
];
```

### 3. Old .pptx output files

**Location:** `tests/extraction/fixtures/*.pptx` (19 files)

These are previously-generated PPTX outputs named to match the old HTML fixture names. They are untracked.

**Options:**
- **Delete** — they can be regenerated from the renamed fixtures at any time
- **Rename and move** to `test/fixtures/` to match new names — useful if keeping as visual comparison references

**Recommendation:** Delete. The regression harness will generate fresh outputs. Old outputs add confusion with mismatched names.

### 4. Old HTML fixture copies in `tests/extraction/fixtures/`

**Location:** `tests/extraction/fixtures/` — 11 untracked HTML files remain after the git rm of tracked files

These are the previously-untracked fixtures (barclays-*, copilot, preview, etc.) that were copied to `test/fixtures/` with new names. The originals are now redundant.

**Action:** Delete the untracked HTML files. The canonical copies are in `test/fixtures/`.

### 5. CLAUDE.md fixture path reference

**File:** `CLAUDE.md` (line 33 in Project Structure section)
```
test/
  extraction/
    fixtures/        # Test HTML files (sample-slide, multi-slide-test, agile-slides, lpm-slides-v1)
```
**Action:** Update to reflect the new structure:
```
test/
  fixtures/          # Renamed test fixtures — see manifest.md for full listing
  diagnostic/        # Diagnostic scripts and output
```

### 6. LEARNINGS.md patterns table

**File:** `LEARNINGS.md` (lines 70–82)

The HTML Patterns table references old fixture names (e.g., `multi-slide-test.html`, `sample-slide.html`, `agile-slides.html`). These are historical references that document when patterns were first encountered.

**Recommendation:** Leave as-is for historical traceability, OR add a note at the top of the table: "Fixture names below are historical — see `test/fixtures/manifest.md` for current names."

### 7. progress.md Testing Notes table

**File:** `progress.md` (lines ~236–242)

References old fixture names in the Testing Notes section.

**Recommendation:** Leave as-is (historical record). Progress.md is due for a Session 14+ update separately.

---

## No Action Required (historical references)

These files contain old fixture names in historical/documentation context. They are correct as written and should **not** be updated:

| File | Reason to keep |
|------|---------------|
| `test/fixtures/manifest.json` | `previousName` field is the authoritative old→new mapping |
| `test/fixtures/manifest.md` | "Previous Name" column serves same purpose |
| `src/extraction/extractor.js` (comments) | Architectural notes explaining why code exists for specific patterns |
| `test/diagnostic/session13-branch-assessment.md` | Historical assessment report |
| `test/diagnostic/output/session13c-regression-report.md` | Historical diagnostic output |
| `test/diagnostic/output/session13e-overflow-report.md` | Historical diagnostic output |
| `test/diagnostic/output/assessment-results.json` | Historical assessment data |
| `docs/tasks/*.md` | Session task documentation |
| `task-fixture-rename.md`, `task-branch-comparison.md` | Task specifications (completed) |

---

## Summary

| Item | Priority | Scope |
|------|----------|-------|
| Diagnostic script fixture paths | High | 2 files, ~5 lines each |
| Delete old fixture copies + .pptx | High | File cleanup only |
| CLAUDE.md project structure | Medium | 3-line edit |
| slide-geometry.js default arg | Low | 1-line edit |
| LEARNINGS.md patterns table note | Low | Optional 1-line addition |
| progress.md Testing Notes | None | Deferred to next session update |
