// Real-audio chain check: hub -> Pulso level 1, expecting the automatic calibration first, then reports the
// audio diagnostics (worker lag, device latencies) and takes a screenshot of the calibration and of Pulso.
// Usage: node scripts/audio-chain.cjs <wav> [url]
const { chromium } = require('playwright');
const { resolve } = require('node:path');

(async () => {
  const wav = resolve(process.argv[2] ?? 'test-results/calibration.wav');
  const url = process.argv[3] ?? 'http://localhost:5182/';
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
  const wait = async (n) => page.waitForFunction((x) => window.__metalforge.scene === x, n, { timeout: 30000 });
  await wait('hub');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await wait('modechoice');
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await wait('levelselect');
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await wait('calibration'); // offered automatically: never calibrated
  console.log('calibration offered automatically: yes');
  await page.waitForFunction(() => window.__metalforge.calibration !== null, null, { timeout: 40000 });
  await page.waitForTimeout(300);
  console.log('calibration', JSON.stringify(await page.evaluate(() => window.__metalforge.calibration)));
  await page.keyboard.press('Enter');
  await wait('pulso');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'test-results/07-pulso-audio-real.png' });
  console.log('audio', JSON.stringify(await page.evaluate(() => window.__metalforge.audio)));
  await page.keyboard.press('Escape');
  await wait('hub');
  console.log(JSON.stringify({ errors }));
  await browser.close();
})();
