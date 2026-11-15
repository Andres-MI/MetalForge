// Plays Salto deterministically with the fake input (window.__metalforge.fake) and takes screenshots.
// Scenarios: perfect run, 150 ms late run, one skipped note (stumble) and a silent run (hearts run out ->
// slower restart -> results). Checks obstacle positions against the beat and exits 1 if an expectation fails.
// Usage: node scripts/salto-fake.cjs [url] [guitar|bass4|bass5] [level]   (dev server running)
const { chromium } = require('playwright');

const url = process.argv[2] ?? 'http://localhost:5183/';
const instrument = process.argv[3] ?? 'guitar';
const level = Number(process.argv[4] ?? 4);
const HIT_X = 64;
const PPB = 46;
const shot = (page, name) => page.screenshot({ path: `test-results/salto-${name}-${instrument}.png` });
const mf = (page, fn, arg) => page.evaluate(fn, arg);
const salto = (page) => page.evaluate(() => window.__metalforge.salto);
const failures = [];
const check = (cond, what) => {
  if (!cond) failures.push(what);
};

async function pressUntil(page, key, id) {
  for (let i = 0; i < 12 && (await page.evaluate(() => window.__metalforge.selected)) !== id; i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(150);
  }
}
async function waitScene(page, name) {
  await page.waitForFunction((n) => window.__metalforge.scene === n, name, { timeout: 8000 });
  await page.waitForTimeout(250);
}
const frames = (page) => page.waitForTimeout(120);

/** Obstacles must sit exactly where the session's beat says. Returns the largest error in canvas pixels. */
async function alignment(page) {
  return mf(page, ({ HIT_X, PPB }) => {
    const m = window.__metalforge;
    const beat = m.fake.beat();
    return Math.max(...m.salto.targetBeats.map((tb, i) => Math.abs(m.salto.obstacleX[i] - Math.round(HIT_X + (tb - beat) * PPB))));
  }, { HIT_X, PPB });
}

async function openSalto(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => ['picker', 'hub'].includes(window.__metalforge?.scene));
  if ((await mf(page, () => window.__metalforge.scene)) === 'picker') {
    await pressUntil(page, 'ArrowRight', instrument);
    await page.keyboard.press('Enter');
  }
  await mf(page, () => (window.__metalforge.useFakeInput = true));
  await waitScene(page, 'hub');
  await pressUntil(page, 'ArrowRight', 'pulse');
  await page.keyboard.press('Enter');
  await waitScene(page, 'modechoice');
  await pressUntil(page, 'ArrowRight', 'practice');
  await page.keyboard.press('Enter');
  await waitScene(page, 'levelselect');
  await pressUntil(page, 'ArrowRight', String(level));
  await page.keyboard.press('Enter');
  await waitScene(page, 'salto');
  return { ctx, page, errors };
}

/** Plays every remaining round with `opts` until the results scene. Returns the tempo of each session. */
async function playToEnd(page, opts) {
  const bpms = [];
  for (let guard = 0; guard < 12; guard++) {
    const s = await salto(page);
    if (!s || s.over) break;
    bpms.push(s.bpm);
    const attempt = s.attempt;
    await mf(page, (o) => window.__metalforge.fake.play(o), opts);
    await page.waitForFunction((a) => !window.__metalforge.salto || window.__metalforge.salto.over || window.__metalforge.salto.attempt !== a, attempt, { timeout: 8000 });
    await frames(page);
  }
  await waitScene(page, 'results');
  await page.waitForTimeout(1400);
  return bpms;
}

const finalState = (page) => mf(page, () => ({ scene: window.__metalforge.scene, results: window.__metalforge.results, judged: window.__metalforge.judged.length }));

(async () => {
  const browser = await chromium.launch();
  const out = { instrument, level };

  // ---- perfect ----
  {
    const { ctx, page, errors } = await openSalto(browser);
    await mf(page, () => window.__metalforge.fake.advanceToBeat(-2.5));
    await frames(page);
    await shot(page, '01-cuenta');
    const alignCount = await alignment(page);
    // Stop right on a target a few beats in: the runner is at the top of the jump over that obstacle.
    const beats = await mf(page, () => window.__metalforge.fake.targetBeats());
    const at = beats.find((b) => b >= 3) ?? beats[beats.length - 1];
    await mf(page, (b) => window.__metalforge.fake.play({ untilBeat: b + 0.03 }), at);
    await page.waitForTimeout(250);
    await shot(page, '02-salto');
    const mid = await salto(page);
    const alignMid = await alignment(page);
    check(mid.pose === 'jump', `perfect: pose at beat ${at} is ${mid.pose}, expected jump`);
    check(alignCount === 0 && alignMid === 0, `obstacles off the beat by ${alignCount}/${alignMid} px`);
    await mf(page, () => window.__metalforge.fake.advance(60)); // the rest of round 1 was already injected
    await page.waitForFunction(() => window.__metalforge.salto.attempt === 2, null, { timeout: 8000 });
    await frames(page);
    await mf(page, () => window.__metalforge.fake.advanceToBeat(-2.5));
    await frames(page);
    await shot(page, '03-ronda2');
    const round2 = await salto(page);
    const bpms = [mid.bpm, ...(await playToEnd(page, {}))];
    await shot(page, '06-resultados-perfecta');
    const end = await finalState(page);
    out.perfect = { bpms, alignPx: [alignCount, alignMid], midPose: mid.pose, round2Banner: round2.banner, ...end, errors };
    check(end.results?.stars === 3, `perfect: stars ${end.results?.stars}`);
    check(end.results?.arcade?.bestCombo === end.judged, `perfect: best combo ${end.results?.arcade?.bestCombo} of ${end.judged}`);
    check(bpms[1] > bpms[0] && bpms[2] > bpms[1], `perfect: tempo did not rise ${bpms}`);
    check(errors.length === 0, `perfect: console errors ${errors}`);
    out.perfect.heartsAtEnd = (await salto(page))?.hearts ?? 'scene closed';
    await ctx.close();
  }

  // ---- 150 ms late ----
  {
    const { ctx, page, errors } = await openSalto(browser);
    const bpms = await playToEnd(page, { offsetMs: 150 });
    await shot(page, '06-resultados-tarde');
    const end = await finalState(page);
    out.late = { bpms, ...end, errors };
    // Up to level 4 the notes are far enough apart for every late pluck to be judged 'late'; in dense levels the
    // Judge pairs a 150 ms late pluck with the next sixteenth, so only the outcome is checked there.
    if (level <= 4) check(end.results?.late === end.judged, `late: ${end.results?.late} late of ${end.judged}`);
    check(end.scene === 'results', `late: ended in ${end.scene}`);
    check(end.results?.arcade?.score < out.perfect.results.arcade.score, 'late: score not lower than perfect');
    check(errors.length === 0, `late: console errors ${errors}`);
    await ctx.close();
  }

  // ---- one skipped note: stumble ----
  {
    const { ctx, page, errors } = await openSalto(browser);
    const beats = await mf(page, () => window.__metalforge.fake.targetBeats());
    const k = beats.findIndex((b) => b >= 2);
    const bpm = (await salto(page)).bpm;
    // The miss is declared when the outer window and the grace have passed (0.45 s guitar, 0.56 s bass).
    const beatsLate = (0.62 * bpm) / 60;
    await mf(page, ({ k, until }) => window.__metalforge.fake.play({ skip: [k], untilBeat: until }), { k, until: beats[k] + beatsLate });
    await page.waitForTimeout(250);
    await shot(page, '04-tropiezo');
    const s = await salto(page);
    out.stumble = { skipped: k, pose: s.pose, hearts: s.hearts, combo: s.combo, errors };
    check(s.pose === 'stumble' && s.hearts === 2, `stumble: pose ${s.pose}, hearts ${s.hearts}`);
    await ctx.close();
  }

  // ---- silent: hearts run out, slower restart, results ----
  {
    const { ctx, page, errors } = await openSalto(browser);
    const bpms = [(await salto(page)).bpm];
    let shotDone = false;
    for (let i = 0; i < 400; i++) {
      const s = await salto(page);
      if (!s || s.over) break;
      if (s.attempt > bpms.length) {
        bpms.push(s.bpm);
        if (!shotDone) {
          await mf(page, () => window.__metalforge.fake.advanceToBeat(-2.5));
          await frames(page);
          await shot(page, '05-otra-vez');
          const again = await salto(page);
          out.restart = { banner: again.banner, bpm: again.bpm, hearts: again.hearts, restarts: again.restarts };
          check(again.banner === 'Otra vez, más despacio', `silent: banner "${again.banner}"`);
          check(again.hearts === 3 && again.bpm < bpms[0], `silent: restart hearts ${again.hearts} bpm ${again.bpm}`);
          shotDone = true;
        }
      }
      await mf(page, () => window.__metalforge.fake.advance(0.25));
      await page.waitForTimeout(40);
    }
    await waitScene(page, 'results');
    await page.waitForTimeout(1400);
    await shot(page, '06-resultados-silencio');
    const end = await finalState(page);
    out.silent = { bpms, ...end, errors };
    check(shotDone, 'silent: no restart happened');
    check(bpms.every((b, i) => i === 0 || b < bpms[i - 1]), `silent: restarts not slower ${bpms}`);
    check(end.scene === 'results' && end.results?.arcade?.score === 0, 'silent: did not end in results with 0 points');
    check(errors.length === 0, `silent: console errors ${errors}`);
    await ctx.close();
  }

  console.log(JSON.stringify(out, null, 1));
  console.log(failures.length ? `FAIL:\n - ${failures.join('\n - ')}` : 'OK: every Salto check passed');
  await browser.close();
  process.exit(failures.length ? 1 : 0);
})();
