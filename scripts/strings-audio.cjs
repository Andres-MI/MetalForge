// Real-audio check of Telar (untimed): a WAV with the right notes (scripts/make-strings-wav.ts) is the fake
// microphone. Math.random is fixed so the launcher's seed is known (floor(0.5 * 1e6) = 500000).
// Usage: node scripts/strings-audio.cjs <wav> [url] [guitar|bass4|bass5] [level]
const { chromium } = require('playwright');
const { resolve } = require('node:path');

(async () => {
  const wav = resolve(process.argv[2] ?? 'test-results/strings.wav');
  const url = process.argv[3] ?? 'http://localhost:5185/';
  const instrument = process.argv[4] ?? 'guitar';
  const level = Number(process.argv[5] ?? 1);
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(() => {
    Math.random = () => 0.5;
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  const press = async (key, id) => {
    for (let i = 0; i < 14 && (await page.evaluate(() => window.__metalforge.selected)) !== id; i++) {
      await page.keyboard.press(key);
      await page.waitForTimeout(150);
    }
  };
  const scene = (n) => page.waitForFunction((s) => window.__metalforge.scene === s, n, { timeout: 8000 }).then(() => page.waitForTimeout(250));
  await page.goto(url);
  await page.waitForFunction(() => ['picker', 'hub'].includes(window.__metalforge?.scene));
  if ((await page.evaluate(() => window.__metalforge.scene)) === 'picker') {
    await press('ArrowRight', instrument);
    await page.keyboard.press('Enter');
  }
  await scene('hub');
  await press('ArrowRight', 'loom');
  await page.keyboard.press('Enter');
  await scene('modechoice');
  await press('ArrowRight', 'learn');
  await page.keyboard.press('Enter');
  await scene('levelselect');
  await press('ArrowRight', String(level));
  await page.keyboard.press('Enter');
  await scene('telar');
  const t0 = Date.now();
  await page.waitForFunction(() => window.__metalforge.scene === 'results', null, { timeout: 120000 });
  const r = await page.evaluate(() => ({ judged: window.__metalforge.judged.slice(), results: window.__metalforge.results }));
  const hits = r.judged.filter((j) => j.judgement === 'hit').length;
  console.log(JSON.stringify({ instrument, level, seconds: Math.round((Date.now() - t0) / 100) / 10, judged: r.judged.length, hits, results: r.results, errors }));
  await browser.close();
})();
