// Plays Escalada and Torre deterministically with the fake input (window.__metalforge.fake) and takes screenshots.
// Escalada: perfect ordered run (+ hear note / hear scale, offer, FREE round with scale and outside notes, results),
//   run with wrong notes (hint, corrected, skip), level 10 timed (perfect, then one late note).
// Torre: perfect run through both boss rooms, a run with wrong notes, a silent run (water -> hearts -> slower restart ->
//   results), level 10 timed.
// Usage: node scripts/scales-fake.cjs [url] [guitar|bass4|bass5] [levelEscalada] [levelTorre] [only: climb|tower]
//   (dev server running: npx vite --port 5186 --strictPort). Exits with code 1 if any expectation fails.
const { chromium } = require('playwright');

const url = process.argv[2] ?? 'http://localhost:5186/';
const instrument = process.argv[3] ?? 'guitar';
const levelC = Number(process.argv[4] ?? 2);
const levelT = Number(process.argv[5] ?? 2);
const only = process.argv[6] ?? 'all';
const shot = (page, name) => page.screenshot({ path: `test-results/scales-${name}-${instrument}.png` });
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const failures = [];
const check = (cond, what) => {
  if (!cond) failures.push(what);
};
const climb = (page) => ev(page, () => window.__metalforge.climb);
const tower = (page) => ev(page, () => window.__metalforge.tower);
const frames = (page, ms = 120) => page.waitForTimeout(ms);
const advance = async (page, s) => {
  await ev(page, (x) => window.__metalforge.fake.advance(x), s);
  await frames(page, 50);
};
const pluck = async (page, midi, after = 0.12) => {
  await ev(page, (m) => window.__metalforge.fake.pluck(m), midi);
  await advance(page, after);
};
const results = (page) => ev(page, () => window.__metalforge.results);

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

async function open(browser, mode, level) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url + (url.includes('?') ? '&' : '?') + 'curso=abierto');
  await page.waitForFunction(() => ['picker', 'hub'].includes(window.__metalforge?.scene));
  if ((await ev(page, () => window.__metalforge.scene)) === 'picker') {
    await pressUntil(page, 'ArrowRight', instrument);
    await page.keyboard.press('Enter');
  }
  await ev(page, () => (window.__metalforge.useFakeInput = true));
  await waitScene(page, 'hub');
  await pressUntil(page, 'ArrowRight', 'climb');
  await page.keyboard.press('Enter');
  await waitScene(page, 'modechoice');
  await pressUntil(page, 'ArrowRight', mode);
  await page.keyboard.press('Enter');
  await waitScene(page, 'levelselect');
  await pressUntil(page, 'ArrowRight', String(level));
  await page.keyboard.press('Enter');
  await waitScene(page, mode === 'learn' ? 'climb' : 'tower');
  await advance(page, 0.5);
  return { ctx, page, errors };
}

async function toResults(page, t = 8000) {
  await page.waitForFunction(() => window.__metalforge.scene === 'results', null, { timeout: t });
  await page.waitForTimeout(1500);
}

/** A scale note that is NOT in the scale: a semitone off one that is. */
const outsideOf = (scale) => {
  for (const m of scale) if (!scale.includes(m + 1)) return m + 1;
  return scale[0] - 1;
};

async function escalada(browser, out) {
  // ---------- perfect ordered run + free round ----------
  {
    const { ctx, page, errors } = await open(browser, 'learn', levelC);
    await frames(page, 400);
    const c0 = await climb(page);
    check(c0.phase === 'run' && c0.index === 0 && c0.lit === 0 && c0.hint === '', `escalada: initial state ${JSON.stringify(c0)}`);
    check(c0.roots >= 2 && c0.scaleNotes >= 8, `escalada: roots ${c0.roots} notes ${c0.scaleNotes}`);
    await shot(page, 'c1-espera');
    let heardRun = false;
    for (let i = 0; i < c0.total; i++) {
      const c = await climb(page);
      check(c.index === i, `escalada perfect: at ${c.index}, expected ${i}`);
      check(c.climberHold === i - 1, `escalada perfect: climber on hold ${c.climberHold} at target ${i}`);
      if (i === 3) {
        await page.keyboard.press('h');
        await frames(page, 200);
        const h = await climb(page);
        check(h.sub.startsWith('Suena'), `escalada: H shows the note ("${h.sub}")`);
        await page.keyboard.press('e');
        await frames(page, 200);
        const l = await climb(page);
        heardRun = l.listening;
        check(l.listening, 'escalada: E does not start the scale playback');
        await shot(page, 'c2-escucha');
        await frames(page, 1800);
      }
      if (i === Math.floor(c0.total / 2)) {
        await frames(page, 300);
        await shot(page, 'c3-mitad');
      }
      await pluck(page, c.midi);
      const d = await climb(page);
      if (i < c0.total - 1) check(d.lit >= c.lit, `escalada perfect: lit went down (${c.lit} -> ${d.lit})`);
    }
    await frames(page, 300);
    const end = await climb(page);
    check(end.phase === 'offer', `escalada: after the run phase "${end.phase}"`);
    check(end.lit === end.scaleNotes || end.lit >= end.scaleNotes - 2, `escalada: lit ${end.lit}/${end.scaleNotes} after the run`);
    check(end.msg.includes('COMPLETA'), `escalada: offer message "${end.msg}"`);
    await shot(page, 'c4-oferta');
    // ---- free round ----
    await page.keyboard.press('Enter');
    await advance(page, 0.3);
    await frames(page, 200);
    const f0 = await climb(page);
    check(f0.phase === 'free' && f0.visited === 0 && f0.plays === 0, `escalada free: start ${JSON.stringify({ p: f0.phase, v: f0.visited })}`);
    const scale = f0.scaleMidis;
    const free = [scale[0], scale[0], scale[2], scale[1]];
    for (const m of free) await pluck(page, m);
    const f1 = await climb(page);
    check(f1.visited === 3, `escalada free: visited ${f1.visited}, expected 3 different notes`);
    const stray = outsideOf(scale);
    await pluck(page, stray);
    await pluck(page, scale[3]);
    await frames(page, 250);
    const f2 = await climb(page);
    check(f2.outside.includes(stray), `escalada free: outside note ${stray} not recorded (${f2.outside})`);
    check(f2.visited === 4, `escalada free: visited ${f2.visited} after an outside note and a new one`);
    await pluck(page, stray);
    await frames(page, 250);
    await shot(page, 'c5-libre');
    for (const m of scale) await pluck(page, m);
    await frames(page, 250);
    const f3 = await climb(page);
    check(f3.visited === f3.scaleNotes, `escalada free: visited ${f3.visited}/${f3.scaleNotes}`);
    check(f3.msg.includes('COMPLETA'), `escalada free: complete message "${f3.msg}"`);
    await shot(page, 'c6-libre-completa');
    await page.keyboard.press('Enter');
    await toResults(page);
    const r = await results(page);
    await shot(page, 'c7-resultados');
    out.climbPerfect = { total: c0.total, heardRun, free: { visited: f3.visited, outside: f2.outside }, results: r, errors };
    check(r?.stars === 3, `escalada perfect: stars ${r?.stars}`);
    check(r?.hits === c0.total, `escalada perfect: hits ${r?.hits}/${c0.total}`);
    check(errors.length === 0, `escalada perfect: console errors ${errors}`);
    await ctx.close();
  }

  // ---------- wrong notes ----------
  {
    const { ctx, page, errors } = await open(browser, 'learn', levelC);
    const log = [];
    let f = await climb(page);
    await pluck(page, f.midi - 2);
    await frames(page, 300);
    let g = await climb(page);
    log.push({ wrongBelow: g.hint, wrongFret: g.wrongFret });
    check(g.hint === 'más agudo →', `escalada wrong: hint "${g.hint}" for a lower note`);
    check(g.sub.startsWith('Tocaste'), `escalada wrong: sub "${g.sub}"`);
    await shot(page, 'c8-error-abajo');
    await pluck(page, f.midi);
    g = await climb(page);
    check(g.index === 1 && g.hint === '', `escalada wrong: not corrected (${g.index} "${g.hint}")`);
    f = g;
    await pluck(page, f.midi + 3);
    await frames(page, 300);
    g = await climb(page);
    log.push({ wrongAbove: g.hint, wrongFret: g.wrongFret });
    check(g.hint === '← más grave', `escalada wrong: hint "${g.hint}" for a higher note`);
    await shot(page, 'c9-error-arriba');
    await page.keyboard.press('s');
    await frames(page, 200);
    g = await climb(page);
    check(g.index === 2 && g.hint === '', `escalada skip: ${JSON.stringify({ i: g.index, h: g.hint })}`);
    await pluck(page, g.midi + 30);
    await frames(page, 300);
    g = await climb(page);
    log.push({ offBoard: g.hint, wrongFret: g.wrongFret });
    check(g.wrongFret === null && g.hint !== '', `escalada off-board: ${JSON.stringify({ h: g.hint, f: g.wrongFret })}`);
    for (let i = 0; i < 60; i++) {
      const h = await climb(page);
      if (!h || h.phase !== 'run') break;
      await pluck(page, h.midi);
    }
    const end = await climb(page);
    check(end.phase === 'offer', `escalada wrong: phase "${end.phase}" after the run`);
    await page.keyboard.press('r');
    await toResults(page);
    const r = await results(page);
    out.climbWrong = { log, results: r, errors };
    check(r?.accuracy < 1 && r?.miss >= 1, `escalada wrong: accuracy ${r?.accuracy} miss ${r?.miss}`);
    check(errors.length === 0, `escalada wrong: console errors ${errors}`);
    await ctx.close();
  }

  // ---------- level 10, timed ----------
  for (const variant of ['perfect', 'late']) {
    const { ctx, page, errors } = await open(browser, 'learn', 10);
    const c0 = await climb(page);
    check(c0.timed && c0.total >= 10, `escalada L10: timed ${c0.timed} total ${c0.total}`);
    const beats = await ev(page, () => window.__metalforge.fake.targetBeats());
    await ev(page, () => window.__metalforge.fake.advanceToBeat(-0.5));
    await frames(page, 200);
    let verdictSeen = '';
    for (let i = 0; i < c0.total; i++) {
      const c = await climb(page);
      await ev(page, (b) => window.__metalforge.fake.advanceToBeat(b), beats[i]);
      if (variant === 'late' && i === 4) await advance(page, 0.15);
      await ev(page, (m) => window.__metalforge.fake.pluck(m), c.midi);
      await advance(page, 0.1);
      if (i === 4) {
        await frames(page, 150);
        const v = await climb(page);
        verdictSeen = v.sub;
        await shot(page, variant === 'perfect' ? 'c10-tiempo' : 'c11-tarde');
      }
    }
    await advance(page, 1.5);
    await frames(page, 300);
    const end = await climb(page);
    check(end.phase === 'offer', `escalada L10 ${variant}: phase "${end.phase}"`);
    await page.keyboard.press('r');
    await toResults(page);
    const r = await results(page);
    out[`climbTimed_${variant}`] = { verdict: verdictSeen, results: r, errors };
    if (variant === 'perfect') {
      check(r?.stars === 3 && r?.hits === c0.total, `escalada L10 perfect: ${JSON.stringify(r)}`);
      check(/A TIEMPO/.test(verdictSeen), `escalada L10 perfect: verdict "${verdictSeen}"`);
    } else {
      check(r?.late >= 1, `escalada L10 late: late ${r?.late}`);
      check(/TARDE/.test(verdictSeen), `escalada L10 late: verdict "${verdictSeen}"`);
    }
    check(errors.length === 0, `escalada L10 ${variant}: console errors ${errors}`);
    await ctx.close();
  }
}

async function torre(browser, out) {
  // ---------- perfect run through both boss rooms ----------
  {
    const { ctx, page, errors } = await open(browser, 'practice', levelT);
    await frames(page, 300);
    const t0 = await tower(page);
    check(t0.floor === 1 && t0.hearts === 3 && t0.phase === 'climb' && t0.total >= 8, `torre: initial ${JSON.stringify(t0)}`);
    const floors = [];
    const bosses = [];
    const shots = { mid: false, boss: false, bossHit: false };
    let bossTested = false;
    let bossRoomsSeen = 0;
    let lastPhase = 'climb';
    for (let guard = 0; guard < 900; guard++) {
      const s = await tower(page);
      if (!s) break;
      if (await ev(page, () => window.__metalforge.scene === 'results')) break;
      if (s.phase === 'boss' && lastPhase !== 'boss') {
        bossRoomsSeen++;
        bossTested = bossRoomsSeen > 1;
      }
      lastPhase = s.phase;
      if (s.over) {
        await frames(page, 200);
        continue;
      }
      if (s.phase === 'climb') {
        if (!s.target) {
          await frames(page, 120);
          continue;
        }
        if (!shots.mid && s.floor === 1 && s.index === Math.floor(s.total / 2)) {
          await advance(page, 0.2);
          await frames(page, 300);
          await shot(page, 't1-ascenso');
          shots.mid = true;
        }
        const before = s.platform;
        if (s.index === 0) await advance(page, 0.3); // the Judge ignores sounds from before the floor began
        await pluck(page, s.target.midi, 0.15);
        await frames(page, 60);
        const a = await tower(page);
        if (a && a.floor === s.floor && a.phase === 'climb') check(a.platform === before + 1 && a.hearts === 3, `torre perfect: platform ${before} -> ${a.platform} hearts ${a.hearts}`);
        if (a && a.index === a.total) floors.push({ floor: s.floor, score: a.score, combo: a.combo });
        continue;
      }
      // Boss room.
      if (!s.boss) {
        await frames(page, 120);
        continue;
      }
      if (s.banner) {
        if (!shots.boss && s.banner.includes('GUARDI')) {
          await frames(page, 300);
          await shot(page, 't2-jefe-aviso');
          shots.boss = true;
        }
        await frames(page, 100);
        continue;
      }
      if (!bossTested) {
        bossTested = true;
        const zone = s.zone;
        // Repeating the same note does less and less damage; a note outside the scale heals.
        const dmg = [];
        await advance(page, 0.3); // the Judge ignores sounds from before the room began
        for (let k = 0; k < 4; k++) {
          await pluck(page, zone[0], 0.3);
          await frames(page, 80);
          dmg.push((await tower(page)).boss.lastDamage);
        }
        check(dmg[0] === 10 && dmg[1] === 6 && dmg[2] === 3.6 && dmg[3] < dmg[2], `torre boss: repeat damage ${dmg}`);
        const hpBefore = (await tower(page)).boss.hp;
        await pluck(page, outsideOf(zone), 0.3);
        await frames(page, 150);
        const afterStray = await tower(page);
        check(afterStray.boss.hp === Math.round((hpBefore + 3) * 10) / 10 && afterStray.boss.strays === 1, `torre boss: heal ${hpBefore} -> ${afterStray.boss.hp}`);
        check(afterStray.hearts === 3, 'torre boss: a stray note cost a heart');
        await shot(page, 't3-jefe-fuera');
        bosses.push({ dmg, heal: afterStray.boss.hp - hpBefore });
      }
      const bz = s.zone;
      await pluck(page, bz[(s.boss.bar + guard) % bz.length], 0.2);
      await frames(page, 60);
      const m = await tower(page);
      if (!shots.bossHit && m.boss && m.boss.hp < m.boss.maxHp * 0.6) {
        shots.bossHit = true;
        await frames(page, 100);
        await shot(page, 't4-jefe');
      }
    }
    await toResults(page, 20000);
    const r = await results(page);
    await shot(page, 't8-resultados');
    out.torrePerfect = { floors, bosses, bossRoomsSeen, results: r, errors, shots };
    check(r?.arcade?.score > 0 && r?.arcade?.bestCombo >= t0.total, `torre perfect: arcade ${JSON.stringify(r?.arcade)}`);
    check(r?.stars === 3, `torre perfect: stars ${r?.stars}`);
    check(floors.length === 3, `torre perfect: floors completed ${floors.length}`);
    check(bossRoomsSeen === 2, `torre perfect: boss rooms ${bossRoomsSeen}, expected 2`);
    check(shots.boss && shots.bossHit, `torre perfect: boss shots ${JSON.stringify(shots)}`);
    check(errors.length === 0, `torre perfect: console errors ${errors}`);
    await ctx.close();
  }

  // ---------- wrong notes: combo, slip, no heart, then water ----------
  {
    const { ctx, page, errors } = await open(browser, 'practice', levelT);
    let s = await tower(page);
    for (let k = 0; k < 6; k++) {
      s = await tower(page);
      await advance(page, 0.4);
      await pluck(page, s.target.midi, 0.15);
    }
    await frames(page, 100);
    const before = await tower(page);
    await advance(page, 0.6);
    await pluck(page, before.target.midi + 2, 0.15);
    await frames(page, 250);
    const after = await tower(page);
    check(after.combo === Math.floor(before.combo / 2) && after.hearts === 3, `torre wrong: combo ${before.combo} -> ${after.combo}, hearts ${after.hearts}`);
    check(after.gap < before.gap && after.platform === before.platform, `torre wrong: gap ${before.gap} -> ${after.gap}, platform ${after.platform}`);
    await shot(page, 't5-error');
    // The right note after a wrong one is clumsy (fewer points) but climbs.
    const sc0 = after.score;
    await pluck(page, after.target.midi, 0.15);
    await frames(page, 100);
    const c = await tower(page);
    check(c.platform === before.platform + 1 && c.score - sc0 <= 50 * c.multiplier + 1, `torre wrong: clumsy jump ${JSON.stringify({ p: c.platform, d: c.score - sc0 })}`);
    // Let the water rise until it is close, for the screenshot.
    for (let i = 0; i < 80; i++) {
      const w = await tower(page);
      if (w.gap < 1.5) break;
      await advance(page, 0.4);
    }
    await frames(page, 300);
    await shot(page, 't6-agua');
    const w = await tower(page);
    out.torreWrong = { combo: [before.combo, after.combo], gap: [before.gap, after.gap, w.gap], errors };
    check(w.gap < 2 && w.hearts === 3, `torre water: gap ${w.gap} hearts ${w.hearts}`);
    check(errors.length === 0, `torre wrong: console errors ${errors}`);
    await ctx.close();
  }

  // ---------- silent: water -> hearts -> slower restart -> results ----------
  {
    const silentLevel = 9;
    const { ctx, page, errors } = await open(browser, 'practice', silentLevel);
    const first = await tower(page);
    const paces = [first.pace];
    let bannerSeen = false;
    let lastAttempt = 1;
    const hearts = new Set();
    let caughtShot = false;
    for (let i = 0; i < 2500; i++) {
      const s = await tower(page);
      if (!s || s.over) break;
      if (await ev(page, () => window.__metalforge.scene === 'results')) break;
      hearts.add(s.hearts);
      if (!caughtShot && s.hearts === 2) {
        caughtShot = true;
        await frames(page, 200);
        await shot(page, 't6b-alcanzado');
      }
      if (s.attempt !== lastAttempt) {
        lastAttempt = s.attempt;
        paces.push(s.pace);
        if (!bannerSeen && s.banner === 'Otra vez, más despacio') {
          await frames(page, 400);
          await shot(page, 't7-otra-vez');
          bannerSeen = true;
          out.restart = { banner: s.banner, hearts: s.hearts, pace: s.pace, restarts: s.restarts, floor: s.floor };
        }
      }
      await ev(page, () => window.__metalforge.fake.advance(0.5));
      await page.waitForTimeout(25);
    }
    await toResults(page, 20000);
    const r = await results(page);
    out.torreSilent = { paces, heartsSeen: [...hearts], results: r, errors };
    check(bannerSeen, 'torre silent: banner "Otra vez, más despacio" never seen');
    check(hearts.has(2) && hearts.has(1) && hearts.has(0), `torre silent: hearts seen ${[...hearts]}`);
    check(paces.length >= 2 && paces[1] < paces[0], `torre silent: restart pace ${paces}`);
    check(r?.arcade?.score === 0, `torre silent: score ${r?.arcade?.score}`);
    check(errors.length === 0, `torre silent: console errors ${errors}`);
    await ctx.close();
  }

  // ---------- level 10, timed ----------
  for (const variant of ['perfect', 'falls']) {
    const { ctx, page, errors } = await open(browser, 'practice', 10);
    const t0 = await tower(page);
    check(t0.timed && t0.total >= 10, `torre L10: timed ${t0.timed} total ${t0.total}`);
    check(instrument === 'guitar' ? t0.pace === 80 : t0.pace === 67, `torre L10: tempo ${t0.pace} for ${instrument}`);
    let heartsMin = 3;
    const log = [];
    let shotDone = false;
    let skipped = 0;
    let late = 0;
    for (let guard = 0; guard < 500; guard++) {
      const s = await tower(page);
      if (!s) break;
      if (await ev(page, () => window.__metalforge.scene === 'results')) break;
      heartsMin = Math.min(heartsMin, s.hearts);
      if (s.over) {
        await frames(page, 200);
        continue;
      }
      if (variant === 'falls' && skipped >= 1 && late >= 1 && s.index >= 8) break;
      if (s.phase === 'boss') {
        if (!s.boss || s.banner) {
          await frames(page, 150);
          continue;
        }
        await pluck(page, s.zone[(guard * 3) % s.zone.length], 0.2);
        continue;
      }
      if (!s.target) {
        await frames(page, 150);
        continue;
      }
      const beats = await ev(page, () => window.__metalforge.fake.targetBeats());
      await ev(page, (x) => window.__metalforge.fake.advanceToBeat(x), beats[s.index]);
      if (variant === 'falls' && s.floor === 1 && s.index === 3 && skipped === 0) {
        skipped++;
        await advance(page, 0.5); // nothing played: the note is missed
        log.push({ skipped: s.index, hearts: (await tower(page)).hearts });
        continue;
      }
      if (variant === 'falls' && s.floor === 1 && s.index === 5 && late === 0) {
        late++;
        await advance(page, 0.15);
      }
      await ev(page, (m) => window.__metalforge.fake.pluck(m), s.target.midi);
      await advance(page, 0.08);
      if (!shotDone && s.floor === 1 && s.index === 6) {
        await frames(page, 200);
        await shot(page, variant === 'perfect' ? 't9-tiempo' : 't9b-caida');
        shotDone = true;
      }
    }
    if (variant === 'perfect') {
      await toResults(page, 20000);
      const r = await results(page);
      out.torreTimedPerfect = { results: r, heartsMin, errors };
      check(r?.arcade?.score > 0 && heartsMin === 3, `torre L10 perfect: ${JSON.stringify({ a: r?.arcade, heartsMin })}`);
      check(r?.stars === 3, `torre L10 perfect: stars ${r?.stars}`);
    } else {
      const s = await tower(page);
      out.torreTimedFalls = { log, hearts: s?.hearts, combo: s?.combo, errors };
      check(s?.hearts === 2, `torre L10 falls: hearts ${s?.hearts} (a missed note must cost one)`);
      check(heartsMin === 2, `torre L10 falls: heartsMin ${heartsMin}`);
    }
    check(errors.length === 0, `torre L10 ${variant}: console errors ${errors}`);
    await ctx.close();
  }
}


(async () => {
  const browser = await chromium.launch();
  const out = { instrument, levelC, levelT };
  if (only === 'all' || only === 'climb') await escalada(browser, out);
  if (only === 'all' || only === 'tower') await torre(browser, out);
  console.log(JSON.stringify(out, null, 1));
  console.log(failures.length ? `FAIL:\n - ${failures.join('\n - ')}` : 'OK: every Escalada / Torre check passed');
  await browser.close();
  process.exit(failures.length ? 1 : 0);
})();
