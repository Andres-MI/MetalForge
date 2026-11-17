// Real-audio check of Forja: the WAV from scripts/make-chords-wav.ts is the microphone and goes through the whole chain
// (capture, worklet, Web Worker detector, strum event, Judge). After every rejected strum the script presses S (skip) so each
// strum is judged against its own chord. Counts accepted / rejected strums. Math.random is fixed: the game's seed is 424242.
// Usage: node scripts/chords-audio.cjs <wav> [url] [level] [label]
const { chromium } = require('playwright');
const { resolve } = require('node:path');
const { ev, pressUntil, waitScene } = require('./chords-lib.cjs');

const wav = resolve(process.argv[2]);
const url = process.argv[3] ?? 'http://localhost:5187/';
const level = process.argv[4] ?? '1';
const label = process.argv[5] ?? 'audio';

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
  await page.goto(url + (url.includes('?') ? '&' : '?') + 'curso=abierto');
  await page.waitForFunction(() => ['picker', 'hub'].includes(window.__metalforge?.scene));
  if ((await ev(page, () => window.__metalforge.scene)) === 'picker') {
    await pressUntil(page, 'ArrowRight', 'guitar');
    await page.keyboard.press('Enter');
  }
  await waitScene(page, 'hub');
  await pressUntil(page, 'ArrowRight', 'forge');
  await page.keyboard.press('Enter');
  await waitScene(page, 'modechoice');
  await pressUntil(page, 'ArrowRight', 'learn');
  await page.keyboard.press('Enter');
  await waitScene(page, 'levelselect');
  await pressUntil(page, 'ArrowRight', level);
  await page.keyboard.press('Enter');
  await waitScene(page, 'forge');
  const log = [];
  let prev = 'none';
  let strum = 0;
  for (let i = 0; i < 400; i++) {
    await page.waitForTimeout(100);
    if ((await ev(page, () => window.__metalforge.scene)) === 'results') break;
    const f = await ev(page, () => window.__metalforge.forge);
    if (!f) continue;
    if (prev === 'listening' && (f.verdict === 'ok' || f.verdict === 'wrong')) {
      strum++;
      log.push({ strum, expected: f.awaited.name, verdict: f.verdict, cleanliness: Number(f.cleanliness.toFixed(2)), missing: f.missing, foreign: f.foreign, msg: f.msg1 || f.msg2 });
      if (f.verdict === 'wrong') await page.keyboard.press('s');
      if (strum === 3) await page.screenshot({ path: `test-results/chords-${label}-3.png` });
    }
    prev = f.verdict;
  }
  const ok = log.filter((l) => l.verdict === 'ok').length;
  console.log(JSON.stringify({ label, strums: log.length, accepted: ok, rejected: log.length - ok, log, errors }, null, 1));
  await browser.close();
})();
