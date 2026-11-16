// Plays Luciérnagas and Ninja deterministically with the fake input (window.__metalforge.fake) and takes screenshots.
// Luciérnagas: perfect run, run with wrong notes (hint arrow, then corrected), skip. Ninja: perfect fast run (3 stars,
// full hearts), run with wrong frets, silent run (timeouts -> hearts -> slower restart -> results).
// Usage: node scripts/frets-fake.cjs [url] [guitar|bass4|bass5] [levelLuciernagas] [levelNinja]   (dev server running)
const { chromium } = require('playwright');

const url = process.argv[2] ?? 'http://localhost:5184/';
const instrument = process.argv[3] ?? 'guitar';
const levelL = Number(process.argv[4] ?? 3);
const levelN = Number(process.argv[5] ?? 7);
const shot = (page, name) => page.screenshot({ path: `test-results/frets-${name}-${instrument}.png` });
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const failures = [];
const check = (cond, what) => {
  if (!cond) failures.push(what);
};
const fire = (page) => ev(page, () => window.__metalforge.fireflies);
const ninja = (page) => ev(page, () => window.__metalforge.ninja);
const frames = (page, ms = 120) => page.waitForTimeout(ms);
const advance = async (page, s) => {
  await ev(page, (x) => window.__metalforge.fake.advance(x), s);
  await frames(page, 50);
};
const pluck = async (page, midi) => {
  await ev(page, (m) => window.__metalforge.fake.pluck(m), midi);
  await advance(page, 0.12);
};

async function pressUntil(page, key, id) {
  for (let i = 0; i < 12 && (await ev(page, () => window.__metalforge.selected)) !== id; i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(150);
  }
}
async function waitScene(page, name) {
  await page.waitForFunction((n) => window.__metalforge.scene === n, name, { timeout: 8000 });
  await page.waitForTimeout(250);
}

async function open(browser, mode, level) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
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
  await ev(page, () => (window.__metalforge.useFakeInput = true));
  await waitScene(page, 'hub');
  await pressUntil(page, 'ArrowRight', 'fireflies');
  await page.keyboard.press('Enter');
  await waitScene(page, 'modechoice');
  await pressUntil(page, 'ArrowRight', mode);
  await page.keyboard.press('Enter');
  await waitScene(page, 'levelselect');
  await pressUntil(page, 'ArrowRight', String(level));
  await page.keyboard.press('Enter');
  await waitScene(page, mode === 'learn' ? 'fireflies' : 'ninja');
  await advance(page, 0.5);
  return { ctx, page, errors };
}

const results = (page) => ev(page, () => window.__metalforge.results);

(async () => {
  const browser = await chromium.launch();
  const out = { instrument, levelL, levelN };

  // ---------- Luciérnagas: perfect ----------
  {
    const { ctx, page, errors } = await open(browser, 'learn', levelL);
    await frames(page, 400);
    await shot(page, 'l1-espera');
    const f0 = await fire(page);
    check(f0.index === 0 && f0.caught === 0 && f0.hint === '', 'fireflies: first target not waiting');
    for (let i = 0; i < f0.total; i++) {
      const f = await fire(page);
      check(f.index === i, `fireflies perfect: at ${f.index}, expected ${i}`);
      if (i === 2) {
        await ev(page, () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', code: 'KeyH', keyCode: 72 })));
        await page.keyboard.press('h');
        await frames(page, 200);
        await shot(page, 'l1b-mostrar');
      }
      await pluck(page, f.midi);
    }
    await page.waitForFunction(() => window.__metalforge.scene === 'results', null, { timeout: 8000 });
    await page.waitForTimeout(1500);
    await shot(page, 'l5-resultados');
    const r = await results(page);
    out.firefliesPerfect = { results: r, errors };
    check(r?.stars === 3, `fireflies perfect: stars ${r?.stars}`);
    check(r?.hits === f0.total, `fireflies perfect: hits ${r?.hits}/${f0.total}`);
    check(errors.length === 0, `fireflies perfect: console errors ${errors}`);
    await ctx.close();
  }

  // ---------- Luciérnagas: wrong notes, hint, corrected, skip ----------
  {
    const { ctx, page, errors } = await open(browser, 'learn', levelL);
    const log = [];
    // Target 0: a wrong note BELOW (needs to go up), look at the hint, then correct.
    let f = await fire(page);
    await pluck(page, f.midi - 2);
    await frames(page, 300);
    let g = await fire(page);
    log.push({ wrongBelow: g.hint, wrongFret: g.wrongFret });
    check(g.hint === 'más agudo →', `fireflies wrong: hint "${g.hint}" for a lower note`);
    await shot(page, 'l2-error-abajo');
    await pluck(page, f.midi);
    g = await fire(page);
    check(g.index === 1 && g.hint === '' && g.caught === 1, `fireflies wrong: not corrected (${JSON.stringify(g)})`);
    // Target 1: a wrong note ABOVE (needs to go down).
    f = g;
    await pluck(page, f.midi + 3);
    await frames(page, 300);
    g = await fire(page);
    log.push({ wrongAbove: g.hint, wrongFret: g.wrongFret });
    check(g.hint === '← más grave', `fireflies wrong: hint "${g.hint}" for a higher note`);
    await shot(page, 'l3-error-arriba');
    // Skip with S.
    await page.keyboard.press('s');
    await frames(page, 200);
    g = await fire(page);
    check(g.index === 2 && g.skipped === 1 && g.hint === '', `fireflies skip: ${JSON.stringify(g)}`);
    // Far off the board.
    await pluck(page, g.midi + 30);
    await frames(page, 300);
    g = await fire(page);
    log.push({ offBoard: g.hint, wrongFret: g.wrongFret });
    check(g.wrongFret === null && g.hint === '← más grave', `fireflies off-board: ${JSON.stringify(g)}`);
    await shot(page, 'l4-fuera');
    // Finish playing right.
    for (let i = 0; i < 40; i++) {
      const h = await fire(page);
      if (!h || h.over) break;
      await pluck(page, h.midi);
    }
    await page.waitForFunction(() => window.__metalforge.scene === 'results', null, { timeout: 8000 });
    await page.waitForTimeout(1500);
    const r = await results(page);
    out.firefliesWrong = { log, results: r, errors };
    check(r?.stars < 3, `fireflies wrong: stars ${r?.stars}`);
    check(errors.length === 0, `fireflies wrong: console errors ${errors}`);
    await ctx.close();
  }

  // ---------- Ninja: perfect fast ----------
  {
    const { ctx, page, errors } = await open(browser, 'practice', levelN);
    await frames(page, 300);
    let shotMid = false;
    let shotShield = false;
    let kills = 0;
    let s = await ninja(page);
    const limit0 = s.limit;
    for (let guard = 0; guard < 200; guard++) {
      s = await ninja(page);
      if (!s || s.over) break;
      if (!s.enemy) {
        await advance(page, 0.3);
        continue;
      }
      if (!shotMid && kills === 4) {
        await advance(page, 2.6); // the ring is part-way through
        await frames(page, 200);
        await shot(page, 'n1-ola');
        shotMid = true;
      }
      if (!shotShield && s.enemy.shield) {
        await advance(page, 1.2);
        await frames(page, 150);
        await shot(page, 'n2-escudo');
        shotShield = true;
      }
      await advance(page, 0.3);
      await ev(page, (m) => window.__metalforge.fake.pluck(m), s.enemy.midi);
      await advance(page, 0.12);
      if (s.enemy.shield && !(await ninja(page))?.over) {
        // second hit of a shield, once the first cracked it
        const t = await ninja(page);
        if (t.enemy && t.enemy.hitsLeft === 1 && t.enemy.fret === s.enemy.fret && t.enemy.string === s.enemy.string) {
          await advance(page, 0.5);
          await ev(page, (m) => window.__metalforge.fake.pluck(m), s.enemy.midi);
          await advance(page, 0.12);
        }
      }
      kills++;
    }
    await page.waitForFunction(() => window.__metalforge.scene === 'results', null, { timeout: 15000 });
    await page.waitForTimeout(1500);
    await shot(page, 'n6-resultados');
    const r = await results(page);
    out.ninjaPerfect = { kills, limit0, results: r, errors, shotMid, shotShield };
    check(r?.stars === 3, `ninja perfect: stars ${r?.stars}`);
    check(r?.arcade?.score > 0 && r?.arcade?.bestCombo >= 20, `ninja perfect: arcade ${JSON.stringify(r?.arcade)}`);
    check(shotShield || levelN < 4, 'ninja perfect: no shielded enemy appeared');
    check(errors.length === 0, `ninja perfect: console errors ${errors}`);
    await ctx.close();
  }

  // ---------- Ninja: wrong frets ----------
  {
    const { ctx, page, errors } = await open(browser, 'practice', levelN);
    let s = await ninja(page);
    const log = [];
    for (let k = 0; k < 6; k++) {
      s = await ninja(page);
      await advance(page, 2); // past the start delay and the grace
      await ev(page, (m) => window.__metalforge.fake.pluck(m), s.enemy.midi);
      await advance(page, 0.12);
    }
    const before = await ninja(page);
    await advance(page, 1.2);
    await ev(page, (m) => window.__metalforge.fake.pluck(m), before.enemy.midi + 2);
    await advance(page, 0.12);
    await frames(page, 300);
    const after = await ninja(page);
    log.push({ comboBefore: before.combo, comboAfter: after.combo, heartsBefore: before.hearts, heartsAfter: after.hearts });
    await shot(page, 'n3-error');
    check(after.combo < before.combo && after.hearts === before.hearts, `ninja wrong: ${JSON.stringify(log)}`);
    out.ninjaWrong = { log, errors };
    check(errors.length === 0, `ninja wrong: console errors ${errors}`);
    await ctx.close();
  }

  // ---------- Ninja: silent ----------
  {
    const { ctx, page, errors } = await open(browser, 'practice', levelN);
    const limits = [(await ninja(page)).limit];
    let bannerSeen = false;
    let lastAttempt = 1;
    const hearts = new Set();
    for (let i = 0; i < 1500; i++) {
      const s = await ninja(page);
      if (!s || s.over) break;
      hearts.add(s.hearts);
      if (s.attempt !== lastAttempt) {
        lastAttempt = s.attempt;
        limits.push(s.limit);
        if (!bannerSeen && s.banner === 'Otra vez, más despacio') {
          await frames(page, 300);
          await shot(page, 'n5-otra-vez');
          bannerSeen = true;
          out.restart = { banner: s.banner, hearts: s.hearts, limit: s.limit, restarts: s.restarts };
        }
      }
      await ev(page, () => window.__metalforge.fake.advance(0.5));
      await page.waitForTimeout(25);
    }
    await page.waitForFunction(() => window.__metalforge.scene === 'results', null, { timeout: 15000 });
    await page.waitForTimeout(1500);
    await shot(page, 'n6-resultados-silencio');
    const r = await results(page);
    out.ninjaSilent = { limits, heartsSeen: [...hearts], results: r, errors };
    check(bannerSeen, 'ninja silent: banner "Otra vez, más despacio" never seen');
    check(r?.arcade?.score === 0, `ninja silent: score ${r?.arcade?.score}`);
    check(errors.length === 0, `ninja silent: console errors ${errors}`);
    await ctx.close();
  }

  console.log(JSON.stringify(out, null, 1));
  console.log(failures.length ? `FAIL:\n - ${failures.join('\n - ')}` : 'OK: every Luciérnagas / Ninja check passed');
  await browser.close();
  process.exit(failures.length ? 1 : 0);
})();
