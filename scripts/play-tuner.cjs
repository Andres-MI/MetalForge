// End-to-end check: opens the game with a WAV as fake microphone, picks the instrument, walks the hall to
// the tuner with the keyboard and reports what the tuner heard.
// Usage: node scripts/play-tuner.cjs <guitar|bass4|bass5> [url]
const { chromium } = require('playwright');
const { resolve } = require('node:path');

const scene = (page) => page.evaluate(() => window.__metalforge.scene);
const selected = (page) => page.evaluate(() => window.__metalforge.selected);

async function pressUntil(page, key, id) {
  for (let i = 0; i < 12 && (await selected(page)) !== id; i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(60);
  }
  if ((await selected(page)) !== id) throw new Error(`could not select ${id}`);
}

(async () => {
  const instrument = process.argv[2] ?? 'guitar';
  const url = process.argv[3] ?? 'http://localhost:5173/';
  const wav = resolve(`tests/fixtures/${instrument}-open-strings.wav`);
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url + (url.includes('?') ? '&' : '?') + 'curso=abierto');
  await page.waitForFunction(() => ['picker', 'hub'].includes(window.__metalforge?.scene));
  if ((await scene(page)) === 'picker') {
    await pressUntil(page, 'ArrowRight', instrument);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__metalforge.scene === 'hub');
  }
  await pressUntil(page, 'ArrowRight', 'tuner');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__metalforge.scene === 'tuner');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `test-results/tuner-${instrument}.png` });
  await page.waitForTimeout(11000);
  const heard = await page.evaluate(() => window.__metalforge.heard);
  console.log(JSON.stringify({ instrument, heard, errors }));
  await browser.close();
})();
