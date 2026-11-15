// Real-audio calibration check: a WAV of plucks aligned to the calibration metronome is the fake microphone.
// Usage: node scripts/calibrate.cjs <wav> [url] [tag]   (make the WAV with scripts/make-calibration-wav.ts)
const { chromium } = require('playwright');
const { resolve } = require('node:path');

(async () => {
  const wav = resolve(process.argv[2] ?? 'test-results/calibration.wav');
  const url = process.argv[3] ?? 'http://localhost:5182/';
  const tag = process.argv[4] ?? 'a';
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => ['picker', 'hub'].includes(window.__metalforge?.scene));
  if ((await page.evaluate(() => window.__metalforge.scene)) === 'picker') await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__metalforge.scene === 'hub');
  await page.waitForTimeout(300);
  await page.keyboard.press('c');
  await page.waitForFunction(() => window.__metalforge.scene === 'calibration');
  await page.waitForTimeout(6500);
  await page.screenshot({ path: `test-results/06-calibracion-curso-${tag}.png` });
  await page.waitForFunction(() => window.__metalforge.calibration !== null, null, { timeout: 30000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `test-results/06-calibracion-${tag}.png` });
  const result = await page.evaluate(() => window.__metalforge.calibration);
  console.log(JSON.stringify({ wav: process.argv[2], tag, result, errors }));
  await browser.close();
})();
