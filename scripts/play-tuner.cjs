// End-to-end check: opens the tuner with a WAV as fake microphone and reports what the game heard.
// Usage: node scripts/play-tuner.cjs <instrument> [url]
const { chromium } = require('playwright');
const { resolve } = require('node:path');
(async () => {

const instrument = process.argv[2] ?? 'guitar';
const url = process.argv[3] ?? 'http://localhost:5173/';
const wav = resolve(`tests/fixtures/${instrument}-open-strings.wav`);
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`],
});
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url);
await page.click(`.pick[data-id="${instrument}"]`);
await page.click('[data-testid="listen"]');
await page.waitForTimeout(4000);
await page.screenshot({ path: `test-results/tuner-${instrument}.png` });
await page.waitForTimeout(11000);
const heard = await page.evaluate(() => window.__abisal.heard);
console.log(JSON.stringify({ instrument, heard, errors }));
await browser.close();
})();
