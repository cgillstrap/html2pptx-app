/**
 * Regression test harness for the HTML → intermediate JSON extraction pipeline.
 *
 * Runs every fixture listed in test/fixtures/manifest.json through extractFromHTML()
 * and makes structural assertions. The manifest drives everything — no hardcoded
 * fixture knowledge lives in this file.
 *
 * Must run in the Electron main process (not --renderer) because extractFromHTML
 * creates hidden BrowserWindows.
 *
 * Usage: npm run test:regression
 */

const { expect } = require('chai');
const path = require('path');
const fs = require('fs');
const { extractFromHTML } = require('../../src/extraction/extractor');

const FIXTURES_DIR = path.resolve(__dirname, '..', 'fixtures');
const MANIFEST_PATH = path.join(FIXTURES_DIR, 'manifest.json');

// Mocha registers tests synchronously at require-time, so we read the manifest here.
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
const passFixtures = manifest.fixtures.filter(f => f.status === 'pass');
const skipFixtures = manifest.fixtures.filter(f => f.status !== 'pass');

describe('Extraction pipeline — regression tests', function () {

  // Heavy fixtures (33 slides, 456 elements) need time for BrowserWindow + capture
  this.timeout(30000);

  describe('pass fixtures', function () {
    for (const fixture of passFixtures) {
      it(`${fixture.filename} — ${fixture.slides} slides, ${fixture.elements} elements`, async function () {
        const filePath = path.join(FIXTURES_DIR, fixture.filename);

        // Skip gracefully if fixture file is missing
        if (!fs.existsSync(filePath)) {
          this.skip(`Fixture file missing: ${fixture.filename}`);
          return;
        }

        const result = await extractFromHTML(filePath);

        // Slide count matches manifest exactly
        expect(result.slides).to.be.an('array');
        expect(result.slides.length).to.equal(
          fixture.slides,
          `Expected ${fixture.slides} slides, got ${result.slides.length}`
        );

        // Detection method matches manifest
        expect(result.detectionMethod).to.equal(
          fixture.detectionMethod,
          `Expected detection "${fixture.detectionMethod}", got "${result.detectionMethod}"`
        );

        // Every slide has elements
        for (let i = 0; i < result.slides.length; i++) {
          const slide = result.slides[i];
          expect(slide.elements).to.be.an('array');
          expect(slide.elements.length).to.be.greaterThan(
            0,
            `Slide ${i + 1} has no elements`
          );
        }

        // Every slide has viewport dimensions
        for (let i = 0; i < result.slides.length; i++) {
          const slide = result.slides[i];
          expect(slide.viewport).to.exist;
          expect(slide.viewport.w).to.be.greaterThan(
            0,
            `Slide ${i + 1} viewport width is 0`
          );
          expect(slide.viewport.h).to.be.greaterThan(
            0,
            `Slide ${i + 1} viewport height is 0`
          );
        }

        // Total element count is reasonable (>= 50% of manifest baseline)
        const totalElements = result.slides.reduce(
          (sum, s) => sum + s.elements.length, 0
        );
        const floor = Math.floor(fixture.elements * 0.5);
        expect(totalElements).to.be.at.least(
          floor,
          `Total elements ${totalElements} below 50% floor (${floor}) of expected ${fixture.elements}`
        );
      });
    }
  });

  describe('skip fixtures', function () {
    for (const fixture of skipFixtures) {
      it.skip(`${fixture.filename} — ${fixture.status}: ${fixture.description}`);
    }
  });
});
