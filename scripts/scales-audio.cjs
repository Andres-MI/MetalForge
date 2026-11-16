// Real-audio check of Escalada: the WAV from scripts/make-scales-wav.ts is the microphone; the game runs untimed, so
// every note should be climbed. Math.random is fixed so the game's seed is 424242 (floor(0.424242 * 1e6)).
// Usage: node scripts/scales-audio.cjs <wav> [url] [guitar|bass4|bass5] [level]
const { chromium } = require('playwright');
const { resolve } = require('node:path');

const wav = resolve(process.argv[2]);
const url = process.argv[3] ?? 'http://localhost:5186/';
const instrument = process.argv[4] ?? 'guitar';
const level = process.argv[5] ?? '1';
const ev = (page, fn, a) => page.evaluate(fn, a);

async function pressUntil(page, key, id) {
  for (let i = 0; i < 12 && (await ev(page, () => window.__metalforge.selected)) !== id; i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(150);
  }
}
async function waitScene(page, name, t = 8000) {
  await page.waitForFunction((n) => window.__metalforge.scene === n, name, { timeout: t });
  await page.waitForTimeout(250);
}

(async () => {
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(() => {
    Math.random = () => 0.424242;
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => ['picker', 'hub'].includes(window.__metalforge?.scene));
  if ((await ev(page, () => window.__metalforge.scene)) === 'picker') {
    await pressUntil(page, 'ArrowRight', instrument);
    await page.keyboard.press('Enter');
  }
  await waitScene(page, 'hub');
  await pressUntil(page, 'ArrowRight', 'climb');
  await page.keyboard.press('Enter');
  await waitScene(page, 'modechoice');
  await pressUntil(page, 'ArrowRight', 'learn');
  await page.keyboard.press('Enter');
  await waitScene(page, 'levelselect');
  await pressUntil(page, 'ArrowRight', level);
  await page.keyboard.press('Enter');
  await waitScene(page, 'climb');
  const progress = [];
  let last = null;
  let total = 0;
  for (let i = 0; i < 90; i++) {
    await page.waitForTimeout(500);
    const c = await ev(page, () => window.__metalforge.climb);
    if (!c) break;
    total = c.total;
    if (!last || c.index !== last.index || c.hint !== last.hint || c.phase !== last.phase) progress.push({ t: (i + 1) / 2, index: c.index, phase: c.phase, hint: c.hint, climberHold: c.climberHold });
    last = c;
    if (i === 16) await page.screenshot({ path: `test-results/scales-audio-${instrument}.png` });
    if (c.phase === 'offer') break;
  }
  const wrongHints = progress.filter((p) => p.hint).length;
  console.log(JSON.stringify({ instrument, level, total, recognised: last ? Math.min(last.index, total) : 0, phase: last?.phase, wrongHints, progress, errors }, null, 1));
  await browser.close();
})();
