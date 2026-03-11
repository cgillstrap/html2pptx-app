/**
 * Diagnostic: queries slide container and SVG element geometry after
 * all pre-extraction DOM preparation (display-none fix, viewport-height fix,
 * transform stripping). Reports positions to understand clipping.
 *
 * Usage: npx electron test/diagnostic/slide-geometry.js --fixture visual-svg-charts-hybrid.html
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { getSecureWebPreferences, installNavigationGuards } = require('../../src/main/security');

const args = process.argv.slice(2);
const fixtureIdx = args.indexOf('--fixture');
const fixtureName = args[fixtureIdx + 1] || 'visual-svg-charts-hybrid.html';

const fixturePaths = [
  path.join(__dirname, '..', 'fixtures', fixtureName),
  path.join(__dirname, '..', '..', 'tests', 'extraction', 'fixtures', fixtureName),
  path.join(__dirname, '..', '..', 'test', 'extraction', 'fixtures', fixtureName)
];
let fixturePath = fixturePaths.find(p => fs.existsSync(p));
if (!fixturePath) { console.error('Not found:', fixtureName); process.exit(1); }

app.whenReady().then(async () => {
  const hiddenWindow = new BrowserWindow({
    show: false, width: 960, height: 5400, useContentSize: true,
    webPreferences: { ...getSecureWebPreferences(null), sandbox: true }
  });
  installNavigationGuards(hiddenWindow);

  await hiddenWindow.loadFile(fixturePath);
  await new Promise(r => setTimeout(r, 300));

  // Measure body and resize (same as extractFromHTML)
  const bodyDims = await hiddenWindow.webContents.executeJavaScript(`
    (function() {
      var s = window.getComputedStyle(document.body);
      return { w: parseFloat(s.width) || document.body.scrollWidth,
               h: parseFloat(s.height) || document.body.scrollHeight };
    })()`);
  console.log('Body dims:', bodyDims);

  if (bodyDims.w > 0 && bodyDims.h > 0) {
    hiddenWindow.setContentSize(Math.round(bodyDims.w), Math.round(bodyDims.h * 10));
    await new Promise(r => setTimeout(r, 100));
  }
  const contentSize = hiddenWindow.getContentSize();
  console.log('Window content size:', contentSize);

  // Force hidden slides visible (same as extractor)
  const fixCount = await hiddenWindow.webContents.executeJavaScript(`
    (function() {
      var count = 0;
      var slides = document.querySelectorAll('.slide, div.slide, section.slide');
      for (var i = 0; i < slides.length; i++) {
        var cs = window.getComputedStyle(slides[i]);
        if (cs.display === 'none') {
          slides[i].style.setProperty('display', 'flex', 'important');
          count++;
        }
      }
      return count;
    })()`);
  console.log('Display-none fixes:', fixCount);

  if (fixCount > 0) {
    // Remeasure
    const newDims = await hiddenWindow.webContents.executeJavaScript(`
      (function() { return { w: document.body.scrollWidth, h: document.body.scrollHeight }; })()`);
    hiddenWindow.setContentSize(Math.round(newDims.w), Math.round(newDims.h));
    await new Promise(r => setTimeout(r, 100));
    console.log('After display fix - body:', newDims, 'window:', hiddenWindow.getContentSize());

    // Fix viewport unit heights (simplified version)
    const vhFixes = await hiddenWindow.webContents.executeJavaScript(`
      (function() {
        var slides = document.querySelectorAll('.slide, div.slide, section.slide');
        var minH = 540;
        var refH = minH;
        var count = 0;
        for (var i = 0; i < slides.length; i++) {
          var r = slides[i].getBoundingClientRect();
          if (r.height > refH * 2) {
            slides[i].style.overflow = 'hidden';
            slides[i].style.maxHeight = refH + 'px';
            count++;
          }
        }
        return count;
      })()`);
    console.log('Viewport height fixes:', vhFixes);
    await new Promise(r => setTimeout(r, 100));
  }

  // Now query all slide containers and their SVG children
  const geometry = await hiddenWindow.webContents.executeJavaScript(`
    (function() {
      var slides = document.querySelectorAll('.slide, div.slide, section.slide');
      var result = [];
      for (var i = 0; i < slides.length; i++) {
        var sr = slides[i].getBoundingClientRect();
        var slideInfo = {
          index: i,
          id: slides[i].id,
          rect: { x: sr.left, y: sr.top, w: sr.width, h: sr.height },
          overflow: window.getComputedStyle(slides[i]).overflow,
          overflowY: window.getComputedStyle(slides[i]).overflowY,
          maxHeight: slides[i].style.maxHeight,
          svgs: []
        };
        // Find SVGs within this slide
        var svgEls = slides[i].querySelectorAll('svg');
        for (var j = 0; j < svgEls.length; j++) {
          var svgR = svgEls[j].getBoundingClientRect();
          slideInfo.svgs.push({
            index: j,
            rect: { x: svgR.left, y: svgR.top, w: svgR.width, h: svgR.height },
            withinSlide: svgR.top >= sr.top && (svgR.top + svgR.height) <= (sr.top + sr.height),
            belowSlide: svgR.top >= (sr.top + sr.height),
            viewBox: svgEls[j].getAttribute('viewBox')
          });
        }
        // Also check .slide-body overflow
        var body = slides[i].querySelector('.slide-body');
        if (body) {
          var bodyR = body.getBoundingClientRect();
          slideInfo.slideBody = {
            rect: { x: bodyR.left, y: bodyR.top, w: bodyR.width, h: bodyR.height },
            overflow: window.getComputedStyle(body).overflow,
            overflowY: window.getComputedStyle(body).overflowY,
            scrollHeight: body.scrollHeight
          };
        }
        result.push(slideInfo);
      }
      return result;
    })()`);

  console.log('\n=== Slide Geometry Report ===\n');
  for (const slide of geometry) {
    console.log(`Slide ${slide.index + 1} (${slide.id}):`);
    console.log(`  Container: y=${slide.rect.y.toFixed(0)}, h=${slide.rect.h.toFixed(0)}, bottom=${(slide.rect.y + slide.rect.h).toFixed(0)}`);
    console.log(`  overflow=${slide.overflow}, overflowY=${slide.overflowY}, maxHeight=${slide.maxHeight || 'none'}`);
    if (slide.slideBody) {
      const sb = slide.slideBody;
      console.log(`  .slide-body: y=${sb.rect.y.toFixed(0)}, h=${sb.rect.h.toFixed(0)}, scrollHeight=${sb.scrollHeight}, overflow=${sb.overflowY}`);
    }
    if (slide.svgs.length > 0) {
      for (const svg of slide.svgs) {
        const status = svg.withinSlide ? 'WITHIN' : svg.belowSlide ? 'BELOW SLIDE' : 'PARTIAL';
        console.log(`  SVG ${svg.index}: y=${svg.rect.y.toFixed(0)}, h=${svg.rect.h.toFixed(0)}, bottom=${(svg.rect.y + svg.rect.h).toFixed(0)} — ${status}`);
      }
    }
    console.log();
  }

  // Now test: what happens when we lift overflow on slide 2?
  console.log('=== After lifting overflow on slide s1 (index 1) ===\n');
  await hiddenWindow.webContents.executeJavaScript(`
    (function() {
      var slides = document.querySelectorAll('.slide, div.slide, section.slide');
      var target = slides[1];
      if (!target) return;
      target.style.overflow = 'visible';
      target.style.maxHeight = 'none';
      // Also lift overflow on .slide-body
      var body = target.querySelector('.slide-body');
      if (body) {
        body.style.overflow = 'visible';
        body.style.overflowY = 'visible';
      }
    })()`);
  await new Promise(r => setTimeout(r, 100));

  const afterLift = await hiddenWindow.webContents.executeJavaScript(`
    (function() {
      var slides = document.querySelectorAll('.slide, div.slide, section.slide');
      var target = slides[1];
      var sr = target.getBoundingClientRect();
      var result = {
        rect: { y: sr.top, h: sr.height, bottom: sr.top + sr.height },
        overflow: window.getComputedStyle(target).overflow,
        svgs: []
      };
      var svgEls = target.querySelectorAll('svg');
      for (var j = 0; j < svgEls.length; j++) {
        var svgR = svgEls[j].getBoundingClientRect();
        result.svgs.push({
          index: j,
          rect: { y: svgR.top, h: svgR.height, bottom: svgR.top + svgR.height },
          withinContainer: svgR.top >= sr.top && (svgR.top + svgR.height) <= (sr.top + sr.height)
        });
      }
      return result;
    })()`);

  console.log(`Slide container: y=${afterLift.rect.y.toFixed(0)}, h=${afterLift.rect.h.toFixed(0)}, bottom=${afterLift.rect.bottom.toFixed(0)}, overflow=${afterLift.overflow}`);
  for (const svg of afterLift.svgs) {
    const status = svg.withinContainer ? 'WITHIN' : 'OUTSIDE';
    console.log(`  SVG ${svg.index}: y=${svg.rect.y.toFixed(0)}, h=${svg.rect.h.toFixed(0)}, bottom=${svg.rect.bottom.toFixed(0)} — ${status}`);
  }

  hiddenWindow.destroy();
  app.quit();
});
