// Plays Telar and Portero deterministically with the fake input (window.__metalforge.fake) and takes screenshots.
// Telar: perfect run (untimed level 1 and timed level 7), skip arc, wrong strings (hint, then corrected).
// Portero: perfect run (untimed level 2 and timed level 8), wrong strings, silent run (goals -> slower restart -> results).
// Exits 1 if an expectation fails. Usage: node scripts/strings-fake.cjs [url] [guitar|bass4|bass5] [only: telar|portero]
const { chromium } = require('playwright');

const url = process.argv[2] ?? 'http://localhost:5185/';
const instrument = process.argv[3] ?? 'guitar';
const only = process.argv[4];
const shot = (page, name) => page.screenshot({ path: `test-results/${name}-${instrument}.png` });
const mf = (page, fn, arg) => page.evaluate(fn, arg);
const failures = [];
const check = (cond, what) => {
  if (!cond) failures.push(what);
};
const sleep = (page, ms = 60) => page.waitForTimeout(ms);

async function pressUntil(page, key, id) {
  for (let i = 0; i < 14 && (await page.evaluate(() => window.__metalforge.selected)) !== id; i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(150);
  }
}
async function waitScene(page, name, timeout = 8000) {
  await page.waitForFunction((n) => window.__metalforge.scene === n, name, { timeout });
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
  if ((await mf(page, () => window.__metalforge.scene)) === 'picker') {
    await pressUntil(page, 'ArrowRight', instrument);
    await page.keyboard.press('Enter');
  }
  await mf(page, () => (window.__metalforge.useFakeInput = true));
  await waitScene(page, 'hub');
  await pressUntil(page, 'ArrowRight', 'loom');
  await page.keyboard.press('Enter');
  await waitScene(page, 'modechoice');
  await pressUntil(page, 'ArrowRight', mode);
  await page.keyboard.press('Enter');
  await waitScene(page, 'levelselect');
  await pressUntil(page, 'ArrowRight', String(level));
  await page.keyboard.press('Enter');
  await waitScene(page, mode === 'learn' ? 'telar' : 'portero');
  return { ctx, page, errors };
}

const telar = (page) => mf(page, () => window.__metalforge.telar);
const portero = (page) => mf(page, () => window.__metalforge.portero);
const pluck = (page, midi, after = 0.05) => mf(page, ([m, a]) => window.__metalforge.fake.pluckNote(m, a), [midi, after]);
const advance = (page, s) => mf(page, (x) => window.__metalforge.fake.advance(x), s);
const finalState = (page) => mf(page, () => ({ scene: window.__metalforge.scene, results: window.__metalforge.results, judged: window.__metalforge.judged.slice() }));

/** Midi of an open string of the instrument that is not `avoid` (to play a wrong string). */
async function wrongMidi(page, strings, midis, idx) {
  const t = await telarOrPortero(page);
  const want = strings[idx];
  const other = t.strings.findIndex((s) => s !== want);
  void other;
  // Any other target of the exercise on another string.
  const j = strings.findIndex((s) => s !== want);
  return midis[j];
}
const telarOrPortero = async (page) => (await telar(page)) ?? (await portero(page));

/** Telar, untimed: plays targets in order; `wrong` maps index -> extra wrong plucks before the right one. */
async function telarUntimed(page, opts = {}) {
  const t = await telar(page);
  for (let i = t.current; i < t.strings.length; i++) {
    await advance(page, 0.4);
    await sleep(page, 50);
    if (opts.wrongAt === i) {
      const midi = await wrongMidi(page, t.strings, t.midis, i);
      await pluck(page, midi);
      await advance(page, 0.3);
      await sleep(page, 150);
      if (opts.onWrong) await opts.onWrong(i);
      await advance(page, 0.5);
    }
    if (opts.stopAt === i) return;
    await pluck(page, t.midis[i]);
    await advance(page, 0.3);
    await sleep(page, 40);
  }
}

async function telarScenarios(browser, out) {
  // ---- untimed level 1: waiting shot, perfect run ----
  {
    const { ctx, page, errors } = await open(browser, 'learn', 1);
    await advance(page, 0.5);
    await sleep(page, 300);
    await shot(page, 'telar-espera');
    const t0 = await telar(page);
    check(t0.threadY.length === { guitar: 6, bass4: 4, bass5: 5 }[instrument], `telar: threads ${t0.threadY.length}`);
    await telarUntimed(page);
    await waitScene(page, 'results');
    await sleep(page, 1400);
    await shot(page, 'telar-resultados');
    const end = await finalState(page);
    out.telarPerfect = { stars: end.results?.stars, hits: end.results?.hits, judged: end.judged.length, errors };
    check(end.results?.stars === 3 && end.judged.every((j) => j.judgement === 'hit'), `telar L1 perfect: stars ${end.results?.stars}`);
    check(errors.length === 0, `telar L1: console errors ${errors}`);
    await ctx.close();
  }
  // ---- untimed level 3: skip arc ----
  {
    const { ctx, page, errors } = await open(browser, 'learn', 3);
    const t = await telar(page);
    const k = t.skips.findIndex((s, i) => s && i >= 2);
    check(k > 0, 'telar L3: no skip in the exercise');
    await telarUntimed(page, { stopAt: k - 1 });
    await advance(page, 0.4);
    await sleep(page, 200);
    await pluck(page, t.midis[k - 1]);
    await advance(page, 0.5);
    await sleep(page, 700);
    await shot(page, 'telar-salto');
    const now = await telar(page);
    check(now.current === k && now.skips[k], `telar L3: current ${now.current}, expected skip target ${k}`);
    await ctx.close();
    out.telarSkipIndex = k;
    check(errors.length === 0, `telar L3: console errors ${errors}`);
  }
  // ---- wrong strings: hint, then corrected ----
  {
    const { ctx, page, errors } = await open(browser, 'learn', 2);
    let hint = '';
    let heard = -1;
    await telarUntimed(page, {
      wrongAt: 3,
      stopAt: 3,
      onWrong: async () => {
        const t = await telar(page);
        hint = t.hint;
        heard = t.heardString;
        await shot(page, 'telar-equivocada');
      },
    });
    check(hint.length > 0 && heard >= 0, `telar wrong: hint "${hint}" heard ${heard}`);
    const t = await telar(page);
    await pluck(page, t.midis[3]);
    await advance(page, 0.4);
    await sleep(page, 150);
    const after = await telar(page);
    check(after.hint === '' && after.current === 4, `telar wrong: after correcting hint "${after.hint}" current ${after.current}`);
    await telarUntimed(page);
    await waitScene(page, 'results');
    const end = await finalState(page);
    out.telarWrong = { hint, stars: end.results?.stars, accuracy: end.results?.accuracy, errors };
    check(end.results?.accuracy < 1, 'telar wrong: accuracy should drop');
    check(errors.length === 0, `telar wrong: console errors ${errors}`);
    await ctx.close();
  }
  // ---- skip key (untimed) ----
  {
    const { ctx, page, errors } = await open(browser, 'learn', 1);
    await advance(page, 0.5);
    await page.keyboard.press('s');
    await advance(page, 0.1);
    await sleep(page, 150);
    check((await telar(page)).current === 1, 'telar: S did not skip the target');
    check(errors.length === 0, `telar skip key: console errors ${errors}`);
    await ctx.close();
  }
  // ---- timed level 7: perfect, then level 8 mid-play screenshot ----
  {
    const { ctx, page, errors } = await open(browser, 'learn', 7);
    await mf(page, () => window.__metalforge.fake.advanceToBeat(-2));
    await sleep(page, 200);
    await shot(page, 'telar-compas-cuenta');
    await mf(page, () => window.__metalforge.fake.play({ untilBeat: 5.3 }));
    await sleep(page, 300);
    await shot(page, 'telar-compas');
    await mf(page, () => window.__metalforge.fake.play({}));
    await waitScene(page, 'results');
    const end = await finalState(page);
    out.telarTimed = { stars: end.results?.stars, hits: end.results?.hits, judged: end.judged.length, errors };
    check(end.results?.stars === 3 && end.judged.every((j) => j.judgement === 'hit'), `telar L7 perfect: stars ${end.results?.stars}`);
    check(errors.length === 0, `telar L7: console errors ${errors}`);
    await ctx.close();
  }
  // ---- timed with wrong string and late: no fail state ----
  {
    const { ctx, page, errors } = await open(browser, 'learn', 8);
    await mf(page, () => window.__metalforge.fake.play({ offsetMs: 150, untilBeat: 6 }));
    await sleep(page, 300);
    await shot(page, 'telar-compas-tarde');
    await mf(page, () => window.__metalforge.fake.play({ offsetMs: 150 }));
    await waitScene(page, 'results');
    const end = await finalState(page);
    out.telarLate = { late: end.results?.late, hits: end.results?.hits, errors };
    check(end.scene === 'results' && end.results.late > 0, 'telar L8 late: should end in results with late hits');
    check(errors.length === 0, `telar L8: console errors ${errors}`);
    await ctx.close();
  }
}

/** Portero, untimed: steps virtual time, answering the shot that waits. */
async function porteroUntimed(page, opts = {}) {
  const shots = { wrongDone: new Set(), screenshots: new Set(), saves: 0 };
  for (let guard = 0; guard < 1500; guard++) {
    const h = await portero(page);
    if (!h || h.over) break;
    if ((await mf(page, () => window.__metalforge.scene)) !== 'portero') break;
    await advance(page, 0.25);
    await sleep(page, 45);
    const p = await portero(page);
    if (!p || p.over || p.deadline < 0) continue;
    if (opts.onShot) await opts.onShot(p, shots);
    if (opts.silent) continue;
    const i = p.shot;
    const key = `${p.attempt}:${i}`;
    if (opts.wrongEvery && i % opts.wrongEvery === 1 && !shots.wrongDone.has(key)) {
      shots.wrongDone.add(key);
      const j = p.strings.findIndex((s) => s !== p.strings[i]);
      await pluck(page, p.midis[j]);
      await advance(page, 0.3);
      await sleep(page, 120);
      if (opts.onWrong && !shots.screenshots.has('wrong')) {
        shots.screenshots.add('wrong');
        await opts.onWrong();
      }
    }
    await pluck(page, p.midis[i]);
    await advance(page, 0.3);
    await sleep(page, 40);
  }
}

async function porteroScenarios(browser, out) {
  // ---- level 2 untimed: perfect (3 stars, full hearts) ----
  {
    const { ctx, page, errors } = await open(browser, 'practice', 2);
    const shots = new Set();
    let hearts = 3;
    let sawDouble = false;
    await advance(page, 1.7);
    await sleep(page, 300);
    await porteroUntimed(page, {
      onShot: async (p, done) => {
        hearts = Math.min(hearts, p.hearts);
        if (p.group.length === 2 && !sawDouble && p.group[0] === p.shot) {
          sawDouble = true;
          await sleep(page, 200);
          await shot(page, 'portero-doble');
        }
        if (!shots.has('tele') && p.group.length === 1 && p.shot >= 1) {
          shots.add('tele');
          await shot(page, 'portero-tiro');
        }
        if (!shots.has('save') && p.shot === 3 && p.score > 0) {
          shots.add('save');
          await shot(page, 'portero-parada');
        }
      },
    });
    await waitScene(page, 'results');
    await sleep(page, 1400);
    await shot(page, 'portero-resultados');
    const end = await finalState(page);
    out.porteroPerfect = { stars: end.results?.stars, arcade: end.results?.arcade, heartsMin: hearts, sawDouble, errors };
    check(end.results?.stars === 3, `portero L2 perfect: stars ${end.results?.stars}`);
    check(hearts === 3, `portero L2 perfect: hearts ${hearts}`);
    check(end.results?.arcade?.score > 0 && end.results.arcade.bestCombo === end.judged.length / 1, `portero L2 perfect: combo ${end.results?.arcade?.bestCombo} of ${end.judged.length}`);
    check(sawDouble, 'portero L2: no double shot seen');
    check(errors.length === 0, `portero L2: console errors ${errors}`);
    await ctx.close();
  }
  // ---- level 2 with wrong strings ----
  {
    const { ctx, page, errors } = await open(browser, 'practice', 2);
    await advance(page, 1.7);
    await porteroUntimed(page, {
      wrongEvery: 2,
      onWrong: async () => {
        await shot(page, 'portero-equivocada');
      },
    });
    await waitScene(page, 'results');
    const end = await finalState(page);
    out.porteroWrong = { stars: end.results?.stars, accuracy: end.results?.accuracy, arcade: end.results?.arcade, errors };
    check(end.results?.arcade?.bestCombo <= 2, `portero wrong: best combo ${end.results?.arcade?.bestCombo}`);
    check(end.results?.accuracy < 1, 'portero wrong: accuracy should drop');
    check(errors.length === 0, `portero wrong: console errors ${errors}`);
    await ctx.close();
  }
  // ---- silent: goals -> slower restart -> results ----
  {
    const { ctx, page, errors } = await open(browser, 'practice', 2);
    const paces = [(await portero(page)).pace];
    let shotDone = false;
    let restart = null;
    for (let i = 0; i < 700; i++) {
      const s = await portero(page);
      if (!s || s.over) break;
      if (s.attempt > paces.length) {
        paces.push(s.pace);
        if (!shotDone) {
          await sleep(page, 200);
          await shot(page, 'portero-reinicio');
          restart = await portero(page);
          shotDone = true;
        }
      }
      await advance(page, 0.5);
      await sleep(page, 35);
    }
    await waitScene(page, 'results');
    await sleep(page, 1400);
    await shot(page, 'portero-resultados-silencio');
    const end = await finalState(page);
    out.porteroSilent = { paces, banner: restart?.banner, hearts: restart?.hearts, score: end.results?.arcade?.score, errors };
    check(shotDone && restart.banner === 'Otra vez, más despacio', `portero silent: banner "${restart?.banner}"`);
    check(restart.hearts === 3 && paces[1] > paces[0], `portero silent: hearts ${restart?.hearts} paces ${paces}`);
    check(paces.every((p, i) => i === 0 || p > paces[i - 1]), `portero silent: restarts not slower ${paces}`);
    check(end.results?.arcade?.score === 0, 'portero silent: score should be 0');
    check(errors.length === 0, `portero silent: console errors ${errors}`);
    await ctx.close();
  }
  // ---- timed level 8: perfect, mid-play shots, then late hits ----
  {
    const { ctx, page, errors } = await open(browser, 'practice', 8);
    await mf(page, () => window.__metalforge.fake.advanceToBeat(-2));
    await sleep(page, 200);
    await mf(page, () => window.__metalforge.fake.play({ untilBeat: 3.4 }));
    await sleep(page, 250);
    await shot(page, 'portero-compas');
    const pace0 = (await portero(page)).pace;
    const bpms = [pace0];
    for (let guard = 0; guard < 12; guard++) {
      const s = await portero(page);
      if (!s || s.over) break;
      const attempt = s.attempt;
      if (guard > 0) bpms.push(s.pace);
      await mf(page, () => window.__metalforge.fake.play({}));
      await page.waitForFunction((a) => !window.__metalforge.portero || window.__metalforge.portero.over || window.__metalforge.portero.attempt !== a, attempt, { timeout: 8000 });
      await sleep(page, 120);
    }
    await waitScene(page, 'results');
    await sleep(page, 1400);
    await shot(page, 'portero-resultados-compas');
    const end = await finalState(page);
    out.porteroTimed = { bpms, stars: end.results?.stars, arcade: end.results?.arcade, errors };
    check(end.results?.stars === 3, `portero L8 perfect: stars ${end.results?.stars}`);
    check(end.results?.arcade?.bestCombo === end.judged.length, `portero L8: best combo ${end.results?.arcade?.bestCombo} of ${end.judged.length}`);
    check(errors.length === 0, `portero L8: console errors ${errors}`);
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await open(browser, 'practice', 8);
    const bpms = [];
    for (let guard = 0; guard < 12; guard++) {
      const s = await portero(page);
      if (!s || s.over) break;
      bpms.push(s.pace);
      const attempt = s.attempt;
      await mf(page, () => window.__metalforge.fake.play({ offsetMs: 150 }));
      await page.waitForFunction((a) => !window.__metalforge.portero || window.__metalforge.portero.over || window.__metalforge.portero.attempt !== a, attempt, { timeout: 8000 });
      await sleep(page, 120);
    }
    await waitScene(page, 'results');
    const end = await finalState(page);
    out.porteroLate = { bpms, stars: end.results?.stars, arcade: end.results?.arcade, errors };
    check(end.scene === 'results', 'portero L8 late: did not reach results');
    check(errors.length === 0, `portero L8 late: console errors ${errors}`);
    await ctx.close();
  }
}

(async () => {
  const browser = await chromium.launch();
  const out = { instrument };
  if (only !== 'portero') await telarScenarios(browser, out);
  if (only !== 'telar') await porteroScenarios(browser, out);
  console.log(JSON.stringify(out, null, 1));
  console.log(failures.length ? `FAIL:\n - ${failures.join('\n - ')}` : 'OK: every Telar/Portero check passed');
  await browser.close();
  process.exit(failures.length ? 1 : 0);
})();
