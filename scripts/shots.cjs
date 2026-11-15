// Takes screenshots of each screen at two window sizes into test-results/.
// Usage: node scripts/shots.cjs [url]
const { chromium } = require('playwright');
const { resolve } = require('node:path');

const url = process.argv[2] ?? 'http://localhost:5173/';
const wav = resolve('tests/fixtures/guitar-open-strings.wav');

async function pressUntil(page, key, id) {
  for (let i = 0; i < 12 && (await page.evaluate(() => window.__metalforge.selected)) !== id; i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(60);
  }
}

(async () => {
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`],
  });
  for (const [w, h] of [[1280, 720], [1920, 1080]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => window.__metalforge?.scene === 'picker');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `test-results/picker-${w}.png` });
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__metalforge.scene === 'hub');
    await pressUntil(page, 'ArrowRight', 'forge');
    await page.waitForTimeout(700);
    await page.screenshot({ path: `test-results/hub-${w}.png` });
    await pressUntil(page, 'ArrowLeft', 'pulse');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__metalforge.scene === 'soon');
    await page.waitForTimeout(600);
    await page.screenshot({ path: `test-results/soon-${w}.png` });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__metalforge.scene === 'hub');
    await pressUntil(page, 'ArrowRight', 'tuner');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__metalforge.scene === 'tuner');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `test-results/tuner-${w}.png` });
    console.log(w, JSON.stringify({ errors }));
    await page.close();
  }
  await browser.close();
})();
