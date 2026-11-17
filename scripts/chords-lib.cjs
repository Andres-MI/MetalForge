// Helpers shared by the browser scripts of Forja and Hechicero (chords-fake.cjs, chords-audio.cjs).
const ev = (page, fn, arg) => page.evaluate(fn, arg);

async function pressUntil(page, key, id) {
  for (let i = 0; i < 14 && (await ev(page, () => window.__metalforge.selected)) !== id; i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(150);
  }
}

async function waitScene(page, name, t = 8000) {
  await page.waitForFunction((n) => window.__metalforge.scene === n, name, { timeout: t });
  await page.waitForTimeout(250);
}

/** Opens the page, picks the instrument and walks hall -> forge cabinet -> mode -> level. `fake` = virtual-time input. */
async function openGame(browser, { url, instrument, mode, level, fake = true, launchArgs }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  if (launchArgs?.fixedRandom !== undefined) await ctx.addInitScript((v) => (Math.random = () => v), launchArgs.fixedRandom);
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
  if (fake) await ev(page, () => (window.__metalforge.useFakeInput = true));
  await waitScene(page, 'hub');
  await pressUntil(page, 'ArrowRight', 'forge');
  await page.keyboard.press('Enter');
  await waitScene(page, 'modechoice');
  await pressUntil(page, 'ArrowRight', mode);
  await page.keyboard.press('Enter');
  await waitScene(page, 'levelselect');
  await pressUntil(page, 'ArrowRight', String(level));
  await page.keyboard.press('Enter');
  await waitScene(page, mode === 'learn' ? 'forge' : 'wizard');
  return { ctx, page, errors };
}

module.exports = { ev, pressUntil, waitScene, openGame };
