# HTML to PPTX Converter

Convert AI-generated HTML presentations into PowerPoint files. Drop an HTML file, get a .pptx.

---

## Getting Started

### Installation

1. Extract the zip file to a folder of your choice (e.g. `Documents\HTML to PPTX Converter`)
2. Open the folder and double-click **HTML to PPTX Converter.exe**

### First Run — Windows SmartScreen

On first launch, Windows may show a "Windows protected your PC" warning. This is expected — the app is not yet code-signed.

To proceed:
1. Click **More info**
2. Click **Run anyway**

This only happens once. Subsequent launches open normally.

---

## How to Use

1. **Launch the app** — you'll see a dark window with a drop zone
2. **Drag and drop** one or more `.html` files onto the drop zone
3. **Wait** — the app extracts styles and content, then generates PowerPoint slides
4. **Find your file** — by default, the `.pptx` file is saved in the same folder as the HTML file, with the same name

That's it. No configuration required for basic use.

### Multiple Files

You can drop several HTML files at once. Each is converted independently and you'll see a status summary when the batch completes.

---

## Settings

Click the **gear icon** (⚙) in the top-right corner to access settings.

| Setting | What it does |
|---------|-------------|
| **Output** | Choose where .pptx files are saved: alongside the HTML file, in a specific folder you choose, or prompted each time |
| **Default Slide Dimensions** | Override the slide size (in pixels). Leave blank to detect automatically from the HTML |
| **Show extraction warnings** | Toggle whether technical warnings appear in the status panel |
| **Remember last used folder** | When using "Ask where to save", remembers your last chosen location |

Settings are saved automatically and persist between sessions.

---

## Generating HTML for Conversion

The converter works with HTML files produced by AI assistants. For best results, use the provided prompt documents when generating presentations:

1. **Prompting Methodology** (`doc0`) — how to structure your prompt for the best output
2. **Technical Output Profile** (`doc1`) — what HTML/CSS features the converter supports
3. **Design Principles** (`doc2`) — visual communication guidance for effective slides
4. **Brand Tokens** (`doc3`) — brand-specific colours, fonts, and styling

Your team lead can provide these documents. Include them as context when asking an AI assistant to create a presentation.

### Supported AI Engines

The converter has been validated with output from:
- **Claude** — recommended for analytical and narrative-heavy content
- **ChatGPT** — produces good results when given the constraint documents
- **Microsoft Copilot** — produces compatible output; best for simpler presentations

---

## What Converts Well

- Text with formatting (bold, italic, colour, size)
- Shapes with backgrounds, borders, and rounded corners
- Tables with merged cells, row highlighting, and per-cell colours
- Bullet and numbered lists
- Images (embedded and base64)
- SVG charts and icons (converted to images)
- Gradient backgrounds
- Multi-slide decks in various layout patterns

## Known Limitations

- **CSS triangles and decorative pseudo-elements** — these cannot be extracted from the HTML and are skipped
- **Interactive elements** (buttons, toggles, navigation) — skipped, as they have no PowerPoint equivalent
- **JavaScript-generated charts** — basic shapes extract, but complex JS charts may fragment. SVG charts work well
- **Fonts** — if the HTML uses fonts not installed on your machine, PowerPoint substitutes a default. The app warns you when this happens
- **Large/complex slides** — content that overflows the slide boundary is scaled to fit, which may reduce text size

---

## Troubleshooting

| Symptom | Likely cause | Solution |
|---------|-------------|----------|
| App won't launch | SmartScreen blocking | See "First Run" section above |
| No .pptx file appears | Output folder permissions | Try changing the output setting to "Ask where to save" and choose a different folder |
| Slides look different from the HTML | CSS features outside converter scope | Check warnings in the status panel for specifics |
| Text is tiny on some slides | Content overflow — auto-scaled to fit | The HTML slide has more content than fits the slide dimensions |
| "Font may not be available" warning | HTML uses non-standard fonts | The slide will render with a substitute font in PowerPoint |

---

## Version

Check the version number in the top-right corner of the app window. Include this when reporting issues.

**Current release:** v1.0.0 (Beta)

---

## Support

This is a beta release. For issues or feedback, contact your team lead or the development team.
