// Plays Pulso deterministically with the fake input (window.__metalforge.fake) and takes screenshots.
// Usage: node scripts/pulso-fake.cjs [url] [instrument]   (dev server running, e.g. port 5182)
const { chromium } = require('playwright');

const url = process.argv[2] ?? 'http://localhost:5182/';
const instrument = process.argv[3] ?? 'guitar';
const shot = (page, name) => page.screenshot({ path: `test-results/${name}.png` });
const scene = (page) => page.evaluate(() => window.__metalforge.scene);

async function pressUntil(page, key, id) {
  for (let i = 0; i < 12 && (await page.evaluate(() => window.__metalforge.selected)) !== id; i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(60);
  }
}
async function waitScene(page, name) {
  await page.waitForFunction((n) => window.__metalforge.scene === n, name, { timeout: 8000 });
  await page.waitForTimeout(250);
}

async function toLevelSelect(page) {
  await waitScene(page, 'hub');
  await pressUntil(page, 'ArrowRight', 'pulse'); // first cabinet; no-op if already there
  await page.keyboard.press('Enter');
  await waitScene(page, 'modechoice');
}

(async () => {
  const browser = await chromium.launch();
  const out = {};
  for (const scenario of ['perfect', 'late', 'silent']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url + (url.includes('?') ? '&' : '?') + 'curso=abierto');
    await page.waitForFunction(() => ['picker', 'hub'].includes(window.__metalforge?.scene));
    if ((await scene(page)) === 'picker') {
      await pressUntil(page, 'ArrowRight', instrument);
      await page.keyboard.press('Enter');
    }
    await page.evaluate(() => (window.__metalforge.useFakeInput = true));
    await toLevelSelect(page);
    if (scenario === 'perfect') await shot(page, `01-modo-${instrument}`);
    await page.keyboard.press('Enter'); // Aprender
    await waitScene(page, 'levelselect');
    for (let i = 0; i < 2; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150); } // level 3
    await page.waitForTimeout(150);
    if (scenario === 'perfect') await shot(page, `02-nivel-${instrument}`);
    await page.keyboard.press('Enter');
    await waitScene(page, 'pulso');
    // Count-in.
    await page.evaluate(() => window.__metalforge.fake.advanceToBeat(-2.5));
    await page.waitForTimeout(200);
    if (scenario === 'perfect') await shot(page, `03-cuenta-${instrument}`);
    if (scenario === 'perfect') {
      // Mid-play: play the first 3.1 beats, then look at the screen with feedback visible.
      await page.evaluate(() => window.__metalforge.fake.play({ untilBeat: 3.1 }));
      await page.waitForTimeout(100);
      await shot(page, `04-pulso-${instrument}`);
    }
    if (scenario === 'late') {
      await page.evaluate(() => window.__metalforge.fake.play({ offsetMs: 150, untilBeat: 3.3 }));
      await page.waitForTimeout(100);
      await shot(page, `04-pulso-tarde-${instrument}`);
    }
    if (scenario === 'silent') await page.evaluate(() => window.__metalforge.fake.play({ skip: Array.from({ length: 200 }, (_, i) => i) }));
    else await page.evaluate(() => window.__metalforge.fake.advance(60)); // plucks were injected by the mid-play call
    await waitScene(page, 'results');
    await page.waitForTimeout(1400);
    if (scenario !== 'silent') await shot(page, `05-resultados-${scenario}-${instrument}`);
    else await shot(page, `05-resultados-${scenario}-${instrument}`);
    const state = await page.evaluate(() => ({ results: window.__metalforge.results, judged: window.__metalforge.judged.length, scene: window.__metalforge.scene, sample: window.__metalforge.judged.slice(0, 3) }));
    out[scenario] = { ...state, errors };
    await ctx.close();
  }
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();
