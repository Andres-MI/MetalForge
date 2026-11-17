// Shared helpers of the course browser scripts (scripts/course-fake.cjs): open a fresh profile, move around the
// menus with the keyboard and play any game with the fake input (window.__metalforge.fake).
const { chromium } = require('playwright');

const ev = (page, fn, arg) => page.evaluate(fn, arg);
const scene = (page) => ev(page, () => window.__metalforge.scene);
const sleep = (page, ms) => page.waitForTimeout(ms);

async function waitScene(page, name, timeout = 15000) {
  await page.waitForFunction((n) => window.__metalforge.scene === n, name, { timeout });
  await page.waitForTimeout(300);
}
async function waitAny(page, names, timeout = 30000) {
  await page.waitForFunction((n) => n.includes(window.__metalforge.scene), names, { timeout });
  await page.waitForTimeout(300);
  return scene(page);
}
async function waitHubReady(page) {
  await waitScene(page, 'hub');
  await page.waitForFunction(() => window.__metalforge.course && window.__metalforge.course.lit && window.__metalforge.selected, null, { timeout: 8000 });
  await page.waitForTimeout(250);
}
async function pressUntil(page, key, id, max = 14) {
  for (let i = 0; i < max && (await ev(page, () => window.__metalforge.selected)) !== id; i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(140);
  }
  return (await ev(page, () => window.__metalforge.selected)) === id;
}

/** New browser context with error collection. `open` = the development flag that opens every module. */
async function newPage(browser, url, { open = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(open ? url + (url.includes('?') ? '&' : '?') + 'curso=abierto' : url);
  await page.waitForFunction(() => ['picker', 'hub'].includes(window.__metalforge?.scene), null, { timeout: 15000 });
  return { ctx, page, errors };
}

async function pickInstrument(page, instrument) {
  if ((await scene(page)) !== 'picker') return;
  await pressUntil(page, 'ArrowRight', instrument);
  await page.keyboard.press('Enter');
}

const pluck = async (page, midi) => {
  await ev(page, (m) => window.__metalforge.fake.pluck(m), midi);
  await ev(page, () => window.__metalforge.fake.advance(0.12));
  await page.waitForTimeout(40);
};
const advance = async (page, s) => {
  await ev(page, (x) => window.__metalforge.fake.advance(x), s);
  await page.waitForTimeout(40);
};
const hooksOf = (page, key) => ev(page, (k) => window.__metalforge[k], key);

const GAME_SCENES = ['pulso', 'salto', 'fireflies', 'ninja', 'telar', 'portero', 'forge', 'wizard', 'climb', 'tower'];

/**
 * Plays the game on screen with the fake input until the scene leaves the game ('results', 'flow', ...).
 * quality: 'perfect' (every note on time) or 'silent' (nothing is played).
 */
async function autoplay(page, quality = 'perfect', maxMs = 120000) {
  const t0 = Date.now();
  for (;;) {
    const sc = await scene(page);
    if (!GAME_SCENES.includes(sc)) return sc;
    if (Date.now() - t0 > maxMs) throw new Error(`autoplay: still in ${sc} after ${maxMs} ms`);
    if (sc === 'pulso') {
      await ev(page, () => window.__metalforge.fake.advanceToBeat(-2.5));
      if (quality === 'perfect') await ev(page, () => window.__metalforge.fake.play({}));
      else await ev(page, () => window.__metalforge.fake.play({ skip: Array.from({ length: 300 }, (_, i) => i) }));
      await ev(page, () => window.__metalforge.fake.advance(60));
      await page.waitForTimeout(1500);
    } else if (sc === 'salto') {
      const s = await hooksOf(page, 'salto');
      if (!s || s.over) {
        await page.waitForTimeout(400);
        continue;
      }
      const attempt = s.attempt;
      const opts = quality === 'perfect' ? {} : { skip: Array.from({ length: 300 }, (_, i) => i) };
      await ev(page, (o) => window.__metalforge.fake.play(o), opts);
      await page
        .waitForFunction((a) => !window.__metalforge.salto || window.__metalforge.salto.over || window.__metalforge.salto.attempt !== a, attempt, { timeout: 10000 })
        .catch(() => undefined);
      await page.waitForTimeout(150);
    } else if (sc === 'fireflies') {
      const f = await hooksOf(page, 'fireflies');
      if (!f || f.over) {
        await page.waitForTimeout(400);
        continue;
      }
      if (quality === 'perfect') await pluck(page, f.midi);
      else await advance(page, 2);
      if (quality !== 'perfect') {
        await page.keyboard.press('s');
        await page.waitForTimeout(80);
      }
    } else if (sc === 'ninja') {
      const s = await hooksOf(page, 'ninja');
      if (!s || s.over) {
        await page.waitForTimeout(400);
        continue;
      }
      if (!s.enemy || quality !== 'perfect') {
        await advance(page, quality === 'perfect' ? 0.3 : 1);
        continue;
      }
      await advance(page, 0.3);
      await pluck(page, s.enemy.midi);
      const after = await hooksOf(page, 'ninja');
      if (after && !after.over && after.enemy && after.enemy.hitsLeft > 0 && after.enemy.fret === s.enemy.fret) await advance(page, 0.5);
    } else {
      throw new Error(`autoplay: no player for ${sc}`);
    }
  }
}

/** Presses Enter/R until the results scene of a game that waits for a key (Forja, Escalada) is reached. */
async function launchBrowser() {
  return chromium.launch();
}

function makeChecker() {
  const failures = [];
  return {
    failures,
    check(cond, what) {
      if (!cond) failures.push(what);
      return !!cond;
    },
  };
}

module.exports = { ev, scene, sleep, waitScene, waitAny, waitHubReady, pressUntil, newPage, pickInstrument, pluck, advance, hooksOf, autoplay, launchBrowser, makeChecker, GAME_SCENES };
