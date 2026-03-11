# Test Fixture Manifest

**Version:** 1.0
**Generated:** 2026-03-11
**Canonical path:** `test/fixtures/`

---

## Status Key

| Status | Meaning | Regression Test Behaviour |
|--------|---------|--------------------------|
| `pass` | Converts cleanly | Assert successful conversion |
| `degraded` | Converts with known Tier 2 trade-offs | Assert conversion completes with expected warnings |
| `tier3-reference` | Documents a Tier 3 limitation | Assert conversion completes (output may be fragmented) |
| `regression` | Previously passed, currently broken | Tracked for future fix, not blocking |
| `out-of-scope` | Not a target for this tool | Excluded from regression runs |

---

## Baseline Fixtures

| Filename | Previous Name | Slides | Elements | Detection | Dimensions | Description |
|----------|--------------|--------|----------|-----------|------------|-------------|
| `baseline-semantic-3s.html` | `conformant_sample.html` | 3 | 58 | data-slide-number | 960x540 | Semantic markup, card grids, sequences |
| `baseline-shapes-gradient-3s.html` | `multi-slide-fixture.html` | 3 | 47 | data-slide-number | 960x540 | Shapes, gradient background, paragraphs |
| `baseline-dense-12s.html` | `lpm-slides-v1.html` | 12 | 217 | data-slide-number | 960x540 | Content-dense deck, card grids, overflow |

## Layout Fixtures

| Filename | Previous Name | Slides | Elements | Detection | Dimensions | Description |
|----------|--------------|--------|----------|-----------|------------|-------------|
| `layout-body-fallback-1s.html` | `sample-slide.html` | 1 | 4 | body-fallback | 960x540 | Body-as-slide fallback detection |

## Visual Fixtures

| Filename | Previous Name | Slides | Elements | Detection | Dimensions | Description |
|----------|--------------|--------|----------|-----------|------------|-------------|
| `visual-transform-svg-1s.html` | `hr-skills-slide.html` | 1 | 88 | class-slide | 1280x720 | CSS transform + inline SVGs |
| `visual-svg-grid-1s.html` | `modern-it-skills.html` | 1 | 46 | class-slide | 1280x720 | 12 inline SVG icons in grid |
| `visual-svg-charts-hybrid.html` | `barclays-hybrid.html` | 9 | 151 | class-slide | 960x540 | SVG charts with tables and mixed content |

## Table Fixtures

| Filename | Previous Name | Slides | Elements | Detection | Dimensions | Description |
|----------|--------------|--------|----------|-----------|------------|-------------|
| `table-heatmap-rowspan-12s.html` | `taxonomy-deck-tables.html` | 12 | 255 | class-slide | 920x518 | Heatmap tables, rowspan, vertical text |
| `table-simple-base64img-33s.html` | `barclays_peer_story_draft_lite.html` | 33 | 185 | class-slide | 907x438 | Simple tables, base64 embedded image |

## Slideshow Fixtures

| Filename | Previous Name | Slides | Elements | Detection | Dimensions | Description |
|----------|--------------|--------|----------|-----------|------------|-------------|
| `slideshow-stacked-3s.html` | `agile-slides.html` | 3 | 79 | class-slide | 900x506 | Stacked absolute-positioned, gradients, badges |
| `slideshow-displaynone-8s.html` | `taxonomy-deck-html.html` | 8 | 310 | class-slide | 920x518 | display:none toggling, dense grids |
| `slideshow-heatmap-12s.html` | `taxonomy-deck-v2.html` | 12 | 456 | class-slide | 920x518 | display:none with heatmap grids |

## Engine Fixtures

| Filename | Previous Name | Slides | Elements | Detection | Dimensions | Description |
|----------|--------------|--------|----------|-----------|------------|-------------|
| `engine-claude-financial-14s.html` | `barclays-slides.html` | 14 | 190 | data-slide-number | 960x540 | Claude: financial presentation, SVG charts, tables |
| `engine-chatgpt-workshop-9s.html` | `preview.html` | 9 | 211 | data-slide-number | 960x540 | ChatGPT: workshop deck, SVG icons, tables |
| `engine-copilot-overview-8s.html` | `barclays_simpler_better_balanced.html` | 8 | 29 | class-slide | 1280x720 | Copilot: overview with SVG icons |
| `engine-copilot-peers-tables-11s.html` | `Barclays_vs_Peers_Data_Led_Presentation.html` | 11 | 47 | section-children | 783x128 | Copilot: peer comparison with tables |

## Reference Fixtures

| Filename | Previous Name | Slides | Elements | Status | Description |
|----------|--------------|--------|----------|--------|-------------|
| `ref-tier3-jscharts-10s.html` | `barclays-static-presentation.html` | 10 | 752 | tier3-reference | JS-generated charts fragment into hundreds of elements |
| `ref-regression-copilot-2s.html` | `copilot.html` | 2 | 42 | regression | Copilot section-based output |
| `ref-failure-chatgpt-taxonomy-10s.html` | `chat-gpt-taxonomy.html` | 10 | 151 | out-of-scope | Pseudo-element backgrounds, ui-sans-serif font |
| `ref-failure-scorecard-1s.html` | `Team6_Challenge_3.1b_AI scorecard presentation.html` | 1 | 30 | out-of-scope | 40+ CSS triangles, interactive elements |
| `ref-failure-workshop-agenda-1s.html` | `Workshop Agenda 1.html` | 1 | 23 | out-of-scope | CSS triangles, interactive toggle |
| `ref-failure-executive-agenda-1s.html` | `executive_workshop_agenda_webpage 1.html` | 1 | 130 | out-of-scope | Gradient elements, interactive controls, ui-fonts |

---

## Totals

| Category | Count | Status |
|----------|-------|--------|
| baseline | 3 | all pass |
| layout | 1 | all pass |
| visual | 3 | all pass |
| table | 2 | all pass |
| slideshow | 3 | all pass |
| engine | 4 | all pass |
| ref | 6 | 1 tier3-reference, 1 regression, 4 out-of-scope |
| **Total** | **22** | **16 pass, 6 reference** |
