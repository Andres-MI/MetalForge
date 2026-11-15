// Proves rapid key presses are counted exactly once (Phaser 3.90 re-dispatched queued key events; see
// src/engine/keyboardFix.ts). Sends bursts of N presses with no pause in the hub and the level selector and
// checks the selection moved exactly N steps. Usage: node scripts/keys-rapid.cjs [url]   Exit code 1 on failure.
const { chromium } = require('playwright');
const url = process.argv[2] ?? 'http://localhost:5183/';

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await page.goto(url);
  await page.waitForFunction(() => ['picker', 'hub'].includes(window.__metalforge?.scene));
  if ((await page.evaluate(() => window.__metalforge.scene)) === 'picker') await page.keyboard.press('Enter');
  const waitScene = async (n) => {
    await page.waitForFunction((s) => window.__metalforge.scene === s, n);
    await page.waitForTimeout(300);
  };
  await waitScene('hub');
  const sel = () => page.evaluate(() => window.__metalforge.selected);
  const results = [];
  let bad = 0;
  // Hub: learn the cabinet order by pressing singly, then check bursts against it (it wraps around).
  const order = [];
  for (let i = 0; i < 12; i++) {
    const s = await sel();
    if (order.includes(s)) break;
    order.push(s);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
  }
  const idx = async () => order.indexOf(await sel());
  for (const n of [2, 3, 4, 5]) {
    const before = await idx();
    for (let i = 0; i < n; i++) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(250);
    const moved = ((((await idx()) - before) % order.length) + order.length) % order.length;
    const ok = moved === n % order.length;
    results.push({ scene: 'hub', presses: n, moved, ok });
    if (!ok) bad++;
  }
  // Level selector: Pulso -> Aprender -> levels 1..10 (no wrap).
  await page.evaluate(() => (window.__metalforge.useFakeInput = true));
  while ((await sel()) !== 'pulse') {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
  }
  await page.keyboard.press('Enter');
  await waitScene('modechoice');
  await page.keyboard.press('Enter');
  await waitScene('levelselect');
  for (const [key, n] of [['ArrowRight', 2], ['ArrowRight', 3], ['ArrowLeft', 4], ['ArrowRight', 5], ['ArrowLeft', 5], ['ArrowUp', 3], ['ArrowDown', 3], ['ArrowRight', 1]]) {
    const before = +(await sel());
    for (let i = 0; i < n; i++) await page.keyboard.press(key);
    await page.waitForTimeout(250);
    const moved = +(await sel()) - before;
    const expect = (key === 'ArrowRight' || key === 'ArrowUp' ? 1 : -1) * n;
    const clamped = Math.max(1, Math.min(10, before + expect)) - before;
    const ok = moved === clamped;
    results.push({ scene: 'levelselect', key, presses: n, from: before, moved, ok });
    if (!ok) bad++;
  }
  console.log(JSON.stringify(results));
  console.log(bad ? `FAIL: ${bad} bursts miscounted` : `OK: ${results.length} bursts counted exactly`);
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
