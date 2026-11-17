// Plays the whole course with the fake input (window.__metalforge.fake) on a FRESH profile and takes screenshots.
// Scenarios: fresh (picker -> placement intro -> from zero -> hub with only the first modules lit -> Salto well played
// -> results show the unlock -> hub lights Trastes), course (course screen), review (daily review end to end),
// boss (Ritmo boss end to end), turbo (survival until loss, record saved), settings (manual unlock, reset),
// placement (a well played placement test unlocks several modules).
// Exit code 1 when an expectation fails or the console shows an error.
// Usage: node scripts/course-fake.cjs [url] [guitar|bass4|bass5] [scenario ...]   (dev server running, e.g. port 5188)
const L = require('./course-lib.cjs');

const url = process.argv[2] ?? 'http://localhost:5188/';
const instrument = process.argv[3] ?? 'guitar';
const only = process.argv.slice(4);
const { check, failures } = L.makeChecker();
const shot = (page, name) => page.screenshot({ path: `test-results/curso-${name}-${instrument}.png` });
const ev = L.ev;
const out = { instrument };

const DAY = 86_400_000;
const blob = (page) => ev(page, () => window.__metalforge.progress.get());
const setBlob = (page, b) => ev(page, (x) => window.__metalforge.progress.set(x), b);
const hooks = (page, k) => ev(page, (key) => window.__metalforge[key], k);

/** Salto level through the real menus: hub -> Pulso/Salto -> Practicar -> level. */
async function openGameFromHub(page, cabinet, mode, level) {
  await L.waitHubReady(page);
  await L.pressUntil(page, 'ArrowRight', cabinet);
  await page.keyboard.press('Enter');
  await L.waitScene(page, 'modechoice');
  await L.pressUntil(page, 'ArrowRight', mode);
  await page.keyboard.press('Enter');
  await L.waitScene(page, 'levelselect');
  await L.pressUntil(page, 'ArrowRight', String(level));
  await page.keyboard.press('Enter');
}

/** Fresh profile: instrument picked, placement offered and skipped, ready in the hub. */
async function freshHub(browser, { fake = true } = {}) {
  const t = await L.newPage(browser, url);
  if (fake) await ev(t.page, () => (window.__metalforge.useFakeInput = true));
  await L.pickInstrument(t.page, instrument);
  return t;
}

async function skipPlacement(page) {
  await L.waitScene(page, 'placement');
  const first = await hooks(page, 'placement');
  check(first.stage === 'intro', `placement: stage ${first.stage}, expected intro`);
  check((await ev(page, () => window.__metalforge.selected)) === 'zero', 'placement: the default button is not "Empezar desde cero"');
  await page.keyboard.press('Enter');
  await L.waitHubReady(page);
}

// ------------------------------------------------------------------------------------------------------------
async function scenarioFresh(browser) {
  const { ctx, page, errors } = await freshHub(browser);
  await L.waitScene(page, 'placement');
  await shot(page, '01-sondeo-intro');
  await skipPlacement(page);
  let course = await hooks(page, 'course');
  out.hubFresh = { lit: course.lit, unlocked: course.unlocked, next: course.next };
  check(JSON.stringify(course.unlocked) === JSON.stringify(['prep', 'rhythm']), `fresh: unlocked ${course.unlocked}`);
  check(course.lit.includes('pulse') && course.lit.includes('tuner'), `fresh: lit ${course.lit}`);
  check(!course.lit.includes('fireflies') && !course.lit.includes('loom') && !course.lit.includes('forge') && !course.lit.includes('climb'), `fresh: later cabinets lit ${course.lit}`);
  check(course.next === 'prep:tuner', `fresh: next ${course.next}`);
  await shot(page, '02-salon-nuevo');

  // A locked cabinet shakes and says why.
  await L.pressUntil(page, 'ArrowRight', 'fireflies');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  check((await L.scene(page)) === 'hub', 'locked cabinet opened a scene');
  await shot(page, '03-salon-apagada');

  // Salto level 3, perfect: two stars or more at the practice level open Trastes.
  await openGameFromHub(page, 'pulse', 'practice', instrument === 'guitar' ? 3 : 4);
  await L.waitScene(page, 'salto');
  const end = await L.autoplay(page, 'perfect');
  check(end === 'results', `fresh: salto ended in ${end}`);
  await page.waitForFunction(() => window.__metalforge.results && window.__metalforge.results.unlocked, null, { timeout: 8000 });
  await page.waitForTimeout(1800);
  const res = await hooks(page, 'results');
  out.salto = { stars: res.stars, unlocked: res.unlocked, next: res.next };
  check(res.stars >= 2, `fresh: salto stars ${res.stars}`);
  check(res.unlocked.includes('frets'), `fresh: results did not report Trastes (${res.unlocked})`);
  check(res.next && res.next.startsWith('rhythm:'), `fresh: next step ${res.next}`);
  await shot(page, '04-resultados-desbloqueo');
  await page.keyboard.press('Escape');
  await L.waitHubReady(page);
  course = await hooks(page, 'course');
  out.hubAfter = { lit: course.lit, unlocked: course.unlocked };
  check(course.lit.includes('fireflies') && !course.lit.includes('loom'), `fresh: after salto lit ${course.lit}`);
  await L.pressUntil(page, 'ArrowRight', 'fireflies');
  await page.waitForTimeout(300);
  await shot(page, '05-salon-trastes-encendido');
  out.errors = errors;
  check(errors.length === 0, `fresh: console errors ${errors}`);
  await ctx.close();
}

// ---- helpers for the other scenarios ------------------------------------------------------------------------------
const PRACTICE_LEVEL = instrument === 'guitar' ? 3 : 4;

/** A progress blob of a player who cleared Ritmo and Trastes, with aged mastery so that a review has work to do. */
function seedBlob(now) {
  const lvl = (stars) => ({ stars, plays: 2, at: now });
  const levels = { [`salto:${PRACTICE_LEVEL}`]: lvl(3), 'pulso:1': lvl(3), 'pulso:2': lvl(2), 'pulso:3': lvl(2), 'fireflies:1': lvl(3), 'fireflies:2': lvl(2), 'fireflies:3': lvl(2), 'ninja:3': lvl(2) };
  const item = (strength, stability, daysAgo, hits = 3, misses = 1) => ({ strength, stability, lastSeen: now - daysAgo * DAY, seen: hits + misses, hits, misses });
  const items = {
    'rhythm:quarters': item(0.5, 0.6, 20),
    'rhythm:eighths': item(0.4, 0.6, 14),
    'rhythm:syncopation': item(0.3, 0.5, 9),
    [`frets:${instrument}:s0:f0`]: item(0.95, 12, 3),
    [`frets:${instrument}:s0:f1`]: item(0.9, 12, 4),
    [`frets:${instrument}:s0:f2`]: item(0.9, 12, 5),
    [`frets:${instrument}:s0:f3`]: item(0.9, 12, 6),
  };
  return { mastery: { version: 1, items }, levels, arcadeBest: { [`salto:${PRACTICE_LEVEL}`]: { score: 900, bestCombo: 30 } }, course: { manual: [], steps: {}, tuner: true, migrated: true, placement: { at: now, skipped: true, skills: {} } } };
}

/** Picked instrument, placement skipped, then the seeded progress; back in the hub. */
async function seededHub(browser, blobOverride) {
  const t = await freshHub(browser);
  await skipPlacement(t.page);
  const now = await ev(t.page, () => Date.now());
  await setBlob(t.page, blobOverride ?? seedBlob(now));
  await t.page.keyboard.press('u');
  await L.waitScene(t.page, 'course');
  await t.page.keyboard.press('Escape');
  await L.waitHubReady(t.page);
  return t;
}

async function openCourse(page) {
  await L.waitHubReady(page);
  await page.keyboard.press('u');
  await L.waitScene(page, 'course');
  await page.waitForFunction(() => window.__metalforge.selected, null, { timeout: 5000 });
}

// ------------------------------------------------------------------------------------------------------------
async function scenarioCourse(browser) {
  const { ctx, page, errors } = await seededHub(browser);
  const c0 = await hooks(page, 'course');
  out.hubSeeded = { lit: c0.lit, due: c0.due, unlocked: c0.unlocked, next: c0.next };
  check(c0.due.includes('pulse'), `course: rhythm cabinet is not due (${c0.due})`);
  check(c0.due.length >= 1 && !c0.due.includes('loom'), `course: due ${c0.due}`);
  check(c0.lit.includes('loom'), `course: Cuerdas not lit after Ninja ${c0.lit}`);
  check(!c0.lit.includes('forge'), `course: Acordes lit too early ${c0.lit}`);
  await L.pressUntil(page, 'ArrowRight', 'pulse');
  await page.waitForTimeout(300);
  await shot(page, '06-salon-parpadeo');
  await L.pressUntil(page, 'ArrowRight', 'fireflies');
  await page.waitForTimeout(300);
  await shot(page, '06b-salon-trastes');
  await openCourse(page);
  const c = await hooks(page, 'course');
  out.course = { next: c.next, modules: c.modules.map((m) => `${m.id}:${m.unlocked ? 'abierto' : 'cerrado'}${m.complete ? '+' : ''}`) };
  check(c.next === 'rhythm:review', `course: next ${c.next}`);
  check(c.modules.find((m) => m.id === 'rhythm').steps.find((x) => x.id === 'learn').done, 'course: rhythm learn not done');
  await shot(page, '07-curso');
  // A locked step shakes and does not start anything.
  await L.pressUntil(page, 'ArrowDown', 'chords:review');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  check((await L.scene(page)) === 'course', 'course: a locked step opened something');
  await L.pressUntil(page, 'ArrowDown', 'scales:review');
  await page.waitForTimeout(200);
  await shot(page, '07b-curso-bloqueado');
  await page.keyboard.press('Escape');
  await L.waitHubReady(page);
  out.errors = errors;
  check(errors.length === 0, `course: console errors ${errors}`);
  await ctx.close();
}

async function scenarioReview(browser) {
  const { ctx, page, errors } = await seededHub(browser);
  const before = await blob(page);
  await page.keyboard.press('r');
  await L.waitScene(page, 'flow');
  const intro = await hooks(page, 'flow');
  out.review = { kind: intro.kind, phases: intro.phases, stage: intro.stage };
  check(intro.kind === 'review' && intro.id === 'daily' && intro.stage === 'intro', `review: intro ${JSON.stringify(intro)}`);
  check(intro.phases >= 2 && intro.phases <= 5, `review: ${intro.phases} rounds`);
  await shot(page, '08-repaso-intro');
  const rounds = [];
  for (let i = 0; i < intro.phases; i++) {
    await page.keyboard.press('Enter');
    const g = await L.waitAny(page, L.GAME_SCENES, 15000);
    rounds.push(g);
    const end = await L.autoplay(page, 'perfect');
    check(end === 'flow', `review: round ${i + 1} ended in ${end}`);
    await page.waitForTimeout(500);
    const h = await hooks(page, 'flow');
    check(h.stage === (i === intro.phases - 1 ? 'final' : 'between'), `review: stage ${h.stage} after round ${i + 1}`);
    check(h.outcomes.length === i + 1, `review: ${h.outcomes.length} outcomes after round ${i + 1}`);
    if (i === 0) await shot(page, '09-repaso-ronda');
  }
  await page.waitForTimeout(800);
  const fin = await hooks(page, 'flow');
  out.review.rounds = rounds;
  out.review.summary = fin.lines.filter((l) => /elementos|Fuerza|Siguiente/.test(l));
  check(fin.over && fin.stage === 'final', 'review: not over');
  check(fin.lines.some((l) => /han mejorado/.test(l)), `review: no summary line ${fin.lines}`);
  await shot(page, '10-repaso-resumen');
  const after = await blob(page);
  check(after.course.review && after.course.review.count === 1, `review: review not recorded ${JSON.stringify(after.course?.review)}`);
  const moved = Object.keys(before.mastery.items).filter((id) => after.mastery.items[id].lastSeen > before.mastery.items[id].lastSeen);
  out.review.itemsMoved = moved.length;
  check(moved.some((id) => id.startsWith('rhythm:')) && moved.some((id) => id.startsWith('frets:')), `review: reviewed items by skill ${moved}`);
  out.errors = errors;
  check(errors.length === 0, `review: console errors ${errors}`);
  await ctx.close();
}

async function scenarioBoss(browser) {
  const { ctx, page, errors } = await seededHub(browser);
  await openCourse(page);
  check(await L.pressUntil(page, 'ArrowRight', 'rhythm:boss'), 'boss: cannot select the boss step');
  await page.keyboard.press('Enter');
  await L.waitScene(page, 'flow');
  const intro = await hooks(page, 'flow');
  check(intro.kind === 'boss' && intro.stage === 'intro' && intro.phases === 3, `boss: intro ${JSON.stringify(intro)}`);
  await shot(page, '11-jefe-tarjeta');
  const seen = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Enter');
    seen.push(await L.waitAny(page, L.GAME_SCENES, 15000));
    const end = await L.autoplay(page, 'perfect');
    check(end === 'flow', `boss: phase ${i + 1} ended in ${end}`);
    await page.waitForTimeout(500);
    if (i === 0) await shot(page, '12-jefe-fase');
  }
  const fin = await hooks(page, 'flow');
  out.boss = { phases: seen, passed: fin.passed, outcomes: fin.outcomes, completed: fin.completed };
  check(JSON.stringify(seen) === JSON.stringify(['salto', 'pulso', 'salto']), `boss: phases ${seen}`);
  check(fin.stage === 'final' && fin.passed === true, `boss: not passed ${JSON.stringify(fin)}`);
  check(fin.completed.includes('rhythm'), `boss: module not completed ${fin.completed}`);
  await page.waitForTimeout(600);
  await shot(page, '13-jefe-resultado');
  const b = await blob(page);
  check(b.course.steps['rhythm:boss'] && b.course.steps['rhythm:boss'].stars >= 2, 'boss: step not stored');
  out.errors = errors;
  check(errors.length === 0, `boss: console errors ${errors}`);
  await ctx.close();
}

async function scenarioTurbo(browser) {
  const { ctx, page, errors } = await freshHub(browser);
  await skipPlacement(page);
  await L.pressUntil(page, 'ArrowRight', 'turbo');
  await page.waitForTimeout(250);
  await page.keyboard.press('Enter');
  await L.waitScene(page, 'turbo');
  await page.waitForTimeout(400);
  check((await ev(page, () => window.__metalforge.selected)) === 'salto', 'turbo: first open arcade is not Salto');
  await shot(page, '14-turbo-seleccion');
  await page.keyboard.press('Enter');
  await L.waitScene(page, 'flow');
  const intro = await hooks(page, 'flow');
  check(intro.kind === 'turbo' && intro.stage === 'intro', 'turbo: no intro');
  await shot(page, '15-turbo-tarjeta');
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('Enter');
    await L.waitScene(page, 'salto', 15000);
    const end = await L.autoplay(page, 'perfect');
    check(end === 'flow', `turbo: round ${i + 1} ended in ${end}`);
    await page.waitForTimeout(500);
    const h = await hooks(page, 'flow');
    check(h.stage === 'between' && !h.over, `turbo: after round ${i + 1}: ${h.stage} over=${h.over}`);
    if (i === 1) await shot(page, '16-turbo-entre-rondas');
  }
  // Round 3: nothing is played, Turbo ends.
  await page.keyboard.press('Enter');
  await L.waitScene(page, 'salto', 15000);
  const end = await L.autoplay(page, 'silent', 180000);
  check(end === 'flow', `turbo: silent round ended in ${end}`);
  await page.waitForTimeout(1200);
  const fin = await hooks(page, 'flow');
  out.turbo = { stage: fin.stage, rank: fin.rank, record: fin.record, outcomes: fin.outcomes.map((o) => `${o.gameId}:${o.level}:${o.stars}`) };
  check(fin.stage === 'final' && fin.over, 'turbo: not over');
  check(fin.record && fin.record.rounds === 2 && fin.record.score > 0, `turbo: record ${JSON.stringify(fin.record)}`);
  check(fin.rank === 0, `turbo: rank ${fin.rank}`);
  check(fin.outcomes.map((o) => o.level).join() === '1,2,3', `turbo: levels ${fin.outcomes.map((o) => o.level)}`);
  await shot(page, '17-turbo-record');
  const b = await blob(page);
  check(b.turbo && b.turbo.salto && b.turbo.salto[0].rounds === 2, `turbo: table not saved ${JSON.stringify(b.turbo)}`);
  // The selection screen shows the record.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await L.waitScene(page, 'turbo');
  await page.waitForTimeout(400);
  await shot(page, '18-turbo-tabla');
  out.errors = errors;
  check(errors.length === 0, `turbo: console errors ${errors}`);
  await ctx.close();
}

async function scenarioSettings(browser) {
  const { ctx, page, errors } = await seededHub(browser);
  await page.keyboard.press('s');
  await L.waitScene(page, 'settings');
  await page.waitForTimeout(500);
  await shot(page, '19-ajustes');
  check(await L.pressUntil(page, 'ArrowDown', 'unlock'), 'settings: no unlock row');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  check((await ev(page, () => window.__metalforge.selected)) === 'rhythm', 'settings: unlock list did not open');
  await shot(page, '20-ajustes-desbloqueo');
  check(await L.pressUntil(page, 'ArrowDown', 'chords'), 'settings: no chords row');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  let b = await blob(page);
  check(b.course.manual.includes('chords'), `settings: chords not stored ${JSON.stringify(b.course.manual)}`);
  await shot(page, '21-ajustes-desbloqueo-hecho');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await L.waitHubReady(page);
  const c = await hooks(page, 'course');
  check(c.lit.includes('forge') && !c.lit.includes('climb'), `settings: manual unlock lit ${c.lit}`);
  // Reset with confirmation: cancel first, then confirm.
  await page.keyboard.press('s');
  await L.waitScene(page, 'settings');
  await page.waitForTimeout(400);
  await L.pressUntil(page, 'ArrowDown', 'reset');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  check((await ev(page, () => window.__metalforge.selected)) === 'cancel', 'settings: the confirmation does not default to cancel');
  await shot(page, '22-ajustes-borrar');
  await page.keyboard.press('Enter'); // cancel
  await page.waitForTimeout(500);
  b = await blob(page);
  check(b && b.levels && Object.keys(b.levels).length > 0, 'settings: cancel deleted the progress');
  await L.pressUntil(page, 'ArrowDown', 'reset');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await page.keyboard.press('ArrowDown');
  check((await ev(page, () => window.__metalforge.selected)) === 'confirm', 'settings: no confirm row');
  await page.keyboard.press('Enter');
  await L.waitScene(page, 'placement');
  b = await blob(page);
  out.reset = { blob: b ?? null };
  check(!b || (!b.levels && !(b.mastery && Object.keys(b.mastery.items).length)), `settings: progress left after reset ${JSON.stringify(b)}`);
  out.errors = errors;
  check(errors.length === 0, `settings: console errors ${errors}`);
  await ctx.close();
}

/** Plays the probe on screen: untimed ones note by note from `hooks.placement.target`, the rhythm one with `play`. */
async function playProbe(page) {
  const p = await hooks(page, 'placement');
  const n = p.done.length;
  if (p.probe.timed) {
    await ev(page, () => window.__metalforge.fake.advanceToBeat(-2.5));
    await ev(page, () => window.__metalforge.fake.play({}));
    await ev(page, () => window.__metalforge.fake.advance(30));
  } else {
    for (let guard = 0; guard < 120; guard++) {
      const q = await hooks(page, 'placement');
      if (!q || q.stage !== 'round' || q.done.length !== n) break;
      if (q.target && q.target.chord) {
        const judged = await ev(page, () => window.__metalforge.judged.length);
        await ev(page, () => window.__metalforge.fake.strum());
        // The verdict of a strum arrives about 0.25 s later: wait for it before the next one.
        for (let k = 0; k < 20 && (await ev(page, () => window.__metalforge.judged.length)) === judged; k++) await L.advance(page, 0.15);
      } else if (q.target && q.target.midis.length) {
        await L.pluck(page, q.target.midis[0]);
      } else await L.advance(page, 0.2);
    }
  }
  await page.waitForTimeout(1600);
}

async function scenarioPlacement(browser) {
  const { ctx, page, errors } = await freshHub(browser);
  await L.waitScene(page, 'placement');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  check((await ev(page, () => window.__metalforge.selected)) === 'test', 'placement: no test button');
  await shot(page, '23-sondeo-elegir');
  await page.keyboard.press('Enter');
  const done = [];
  let shots = 0;
  for (let guard = 0; guard < 30; guard++) {
    await page.waitForTimeout(500);
    const sc = await L.scene(page);
    if (sc !== 'placement') break;
    const p = await hooks(page, 'placement');
    if (p.stage === 'summary') break;
    if (p.stage === 'round' && p.probe) {
      if (shots < 3 && (p.probe.timed || shots === 0 || p.probe.skill === 'chords')) {
        await page.waitForTimeout(400);
        await shot(page, `24-sondeo-${p.probe.skill}`);
        shots++;
      }
      await playProbe(page);
      done.push(`${p.probe.skill}:${p.probe.level}`);
    }
  }
  await page.waitForFunction(() => window.__metalforge.placement && window.__metalforge.placement.stage === 'summary', null, { timeout: 10000 });
  await page.waitForTimeout(700);
  const sum = await hooks(page, 'placement');
  out.placement = { probes: done, unlocked: sum.unlocked, results: sum.done.map((d) => `${d.skill}:${d.level}:${d.stars}`) };
  check(done.length === 10, `placement: ${done.length} probes, expected 10 when everything goes well`);
  check(sum.unlocked.length >= 3, `placement: unlocked ${sum.unlocked}`);
  await shot(page, '25-sondeo-resumen');
  await page.keyboard.press('Enter'); // Ir al curso
  await L.waitScene(page, 'course');
  await page.waitForTimeout(500);
  const c = await hooks(page, 'course');
  check(c.unlocked.length >= 5, `placement: course unlocked ${c.unlocked}`);
  await shot(page, '26-curso-tras-sondeo');
  out.errors = errors;
  check(errors.length === 0, `placement: console errors ${errors}`);
  await ctx.close();
}

const SCENARIOS = { fresh: scenarioFresh, course: scenarioCourse, review: scenarioReview, boss: scenarioBoss, turbo: scenarioTurbo, settings: scenarioSettings, placement: scenarioPlacement };

(async () => {
  const browser = await L.launchBrowser();
  const names = only.length ? only : Object.keys(SCENARIOS);
  for (const n of names) {
    try {
      await SCENARIOS[n](browser);
    } catch (e) {
      failures.push(`${n}: ${e.message}`);
    }
  }
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
  if (failures.length) {
    console.log('FALLOS:\n- ' + failures.join('\n- '));
    process.exit(1);
  }
  console.log('OK');
})();
