/**
 * Diagnostic runner: extracts a single fixture and dumps results.
 * Usage: npx electron test/diagnostic/dump-extraction.js --fixture <name>.html
 */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { extractFromHTML } = require('../../src/extraction/extractor');

const args = process.argv.slice(2);
const fixtureIdx = args.indexOf('--fixture');
if (fixtureIdx === -1 || !args[fixtureIdx + 1]) {
  console.error('Usage: npx electron test/diagnostic/dump-extraction.js --fixture <name>.html');
  process.exit(1);
}

const fixtureName = args[fixtureIdx + 1];

// Search fixture directories (canonical path first)
const fixturePaths = [
  path.join(__dirname, '..', 'fixtures', fixtureName),
  path.join(__dirname, '..', '..', 'tests', 'extraction', 'fixtures', fixtureName),
  path.join(__dirname, '..', '..', 'test', 'extraction', 'fixtures', fixtureName)
];

let fixturePath = null;
for (const p of fixturePaths) {
  if (fs.existsSync(p)) {
    fixturePath = p;
    break;
  }
}

if (!fixturePath) {
  console.error(`Fixture not found: ${fixtureName}`);
  console.error('Searched:', fixturePaths.join(', '));
  process.exit(1);
}

// Enable diagnostic mode via environment variable
process.env.CAPTURE_DIAGNOSTIC = '1';

app.whenReady().then(async () => {
  try {
    console.log(`\n=== Extracting: ${fixtureName} ===\n`);
    const result = await extractFromHTML(fixturePath);

    console.log(`\n=== Results ===`);
    console.log(`Detection method: ${result.detectionMethod}`);
    console.log(`Slides: ${result.slides.length}`);

    for (const slide of result.slides) {
      const svgs = slide.elements.filter(el => el.type === 'image' && el.src && el.src.startsWith('data:'));
      const shapes = slide.elements.filter(el => el.type === 'shape');
      const gradientShapes = shapes.filter(el => el.shape && el.shape.fillImage);
      console.log(
        `  Slide ${slide.index + 1}: ${slide.elements.length} elements, ` +
        `${svgs.length} captured images, ${gradientShapes.length} gradient shapes`
      );
      if (slide.errors && slide.errors.length > 0) {
        slide.errors.forEach(e => console.log(`    WARNING: ${e}`));
      }
    }

    console.log('\n=== Done ===\n');
  } catch (err) {
    console.error('Extraction failed:', err.message);
    console.error(err.stack);
  } finally {
    app.quit();
  }
});
