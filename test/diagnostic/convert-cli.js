/**
 * Headless CLI runner: HTML file -> PPTX using the app's own extractor and generator.
 * Usage: npx electron test/diagnostic/convert-cli.js <input.html> [output.pptx]
 * Prints extraction warnings so slides that degrade can be checked.
 */
const { app } = require('electron');
const path = require('path');
const { extractFromHTML } = require('../../src/extraction/extractor');
const { generatePPTX } = require('../../src/generation/generator');

const argv = process.argv.slice(2);
const [input, output] = argv.filter((a, i) => !a.startsWith('--') && !(argv[i - 1] || '').startsWith('--'));
if (!input) {
  console.error('Usage: npx electron test/diagnostic/convert-cli.js <input.html> [output.pptx]');
  process.exit(1);
}
const inPath = path.resolve(input);
const outPath = path.resolve(output || inPath.replace(/\.html?$/i, '.pptx'));

// Long multi-slide pages exceed the GPU's max texture size (16384px) and crash the GPU process,
// which drops SVG captures. Software rendering avoids that limit.
app.disableHardwareAcceleration();
// Electron quits by default when its last window closes. The extractor's hidden window closes
// before the PPTX is written, so keep the process alive until we quit explicitly.
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  try {
    // Slide size: --width/--height flags, default 1280x720 (the extractor's own default is 960x540,
    // which clips captures of anything drawn past 960px on wider slides).
    const flag = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 ? Number(process.argv[i + 1]) : d; };
    const result = await extractFromHTML(inPath, { width: flag('width', 1280), minHeight: flag('height', 720) });
    console.log(`Detection: ${result.detectionMethod}; slides: ${result.slides.length}`);
    for (const s of result.slides) {
      const types = {};
      for (const el of s.elements) types[el.type] = (types[el.type] || 0) + 1;
      console.log(`  slide ${s.index + 1}: ${s.elements.length} elements ${JSON.stringify(types)}`);
      for (const e of s.errors || []) console.log(`    ! ${e}`);
    }
    const gen = await generatePPTX(result, outPath, { htmlDir: path.dirname(inPath) });
    console.log('Generated:', outPath, gen && gen.warnings ? `(${gen.warnings.length} generator warnings)` : '');
    if (gen && gen.warnings) for (const w of gen.warnings) console.log(`    ~ ${w}`);
  } catch (err) {
    console.error('FAILED:', err && err.stack || err);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
