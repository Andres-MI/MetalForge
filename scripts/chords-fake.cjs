// Plays Forja and Hechicero deterministically with the fake input (window.__metalforge.fake) and takes screenshots.
// Forja: a muted string (the message names the string), a wrong chord with a foreign note (the message names it), the right
// chord (hammer), a perfect round, skip; level 5: the "one-minute changes" round with virtual time (and the best per pair); level 10:
// the timed progression. Hechicero: perfect run through the boss, wrong chords (fizzle), silent run (hearts -> slower restart ->
// results), level 10 on the beat. On bass the chords are notes in order (fake.pluckNote). Exits with code 1 if anything fails.
// Usage: node scripts/chords-fake.cjs [url] [guitar|bass4|bass5] [forge|wizard|all]   (dev server running)
const { chromium } = require('playwright');
const { ev, openGame, waitScene } = require('./chords-lib.cjs');

const url = process.argv[2] ?? 'http://localhost:5187/';
const instrument = process.argv[3] ?? 'guitar';
const only = process.argv[4] ?? 'all';
const isBass = instrument !== 'guitar';
const failures = [];
const check = (cond, what) => {
  if (!cond) {
    failures.push(what);
    console.log('  FALLO:', what);
  }
};
const log = (...a) => console.log(...a);
const forgeHook = (page) => ev(page, () => window.__metalforge.forge);
const wizHook = (page) => ev(page, () => window.__metalforge.wizard);
const frames = (page, ms = 120) => page.waitForTimeout(ms);
const advance = async (page, s) => {
  await ev(page, (x) => window.__metalforge.fake.advance(x), s);
  await frames(page, 40);
};
const advanceToBeat = async (page, b) => {
  await ev(page, (x) => window.__metalforge.fake.advanceToBeat(x), b);
  await frames(page, 40);
};
const shot = (page, name) => page.screenshot({ path: `test-results/chords-${name}-${instrument}.png` });
const results = (page) => ev(page, () => window.__metalforge.results);
const scene = (page) => ev(page, () => window.__metalforge.scene);

/** Plays the chord (guitar: one strum; bass: its notes in order) that the game waits for. `fault` = options for the first note / strum. */
async function playChord(page, midis, fault) {
  if (!isBass) {
    await ev(page, (o) => window.__metalforge.fake.strum(o), fault ?? {});
    await advance(page, 0.45);
  } else {
    const steps = (await forgeHook(page))?.steps ?? 3;
    for (let k = 0; k < steps; k++) {
      const m = (await forgeHook(page)).awaited.next;
      await ev(page, (n) => window.__metalforge.fake.pluckNote(n), m);
      await advance(page, 0.35);
    }
  }
}

async function until(page, pred, what, { tries = 60, ms = 100 } = {}) {
  for (let i = 0; i < tries; i++) {
    if (await pred()) return true;
    await frames(page, ms);
  }
  check(false, `timeout: ${what}`);
  return false;
}

// ---------------------------------------------------------------- Forja
async function forgeLevel1(browser) {
  log(`\n== Forja nivel 1 (${instrument}) ==`);
  const { ctx, page, errors } = await openGame(browser, { url, instrument, mode: 'learn', level: 1 });
  await advance(page, 1.2);
  await frames(page, 500);
  await shot(page, 'forja-espera');
  let f = await forgeHook(page);
  check(f.phase === 'round' && f.group === 0 && f.verdict === 'none', 'forja: estado inicial');
  check(f.groups === 8, `forja: 8 acordes, hay ${f.groups}`);
  const first = f;

  if (!isBass) {
    // --- a muted string: the message must name it
    const stringIdx = 3; // the G string of the shape (a note of every chord of level 1 that has it)
    const shapeMidi = f.midis[Math.min(3, f.midis.length - 1)];
    await playChord(page, f.midis, { mutedStrings: [stringIdx] });
    await frames(page, 300);
    f = await forgeHook(page);
    log('  cuerda muda:', f.headline, '|', f.msg1, '|', f.msg2);
    check(f.verdict === 'wrong', 'forja: cuerda muda no se acepta');
    check(f.missing.length === 1, `forja: falta una nota (${f.missing})`);
    check(f.missingStrings.length === 1 && f.missingStrings[0] === 6 - stringIdx, `forja: dice la cuerda ${6 - stringIdx}, dijo ${f.missingStrings}`);
    check(/^Falta el \S+: revisa la cuerda \d$/.test(f.msg1) && f.msg1.endsWith(String(6 - stringIdx)), `forja: mensaje de cuerda (${f.msg1})`);
    check(f.missingIdx.includes(stringIdx), 'forja: la cuerda que falta se ilumina');
    check(f.presentIdx.length === f.midis.length - 1, `forja: las demás cuerdas suenan (${f.presentIdx.length})`);
    await shot(page, 'forja-falta-cuerda');
    void shapeMidi;

    // --- a foreign note (the other third)
    const cand = await ev(page, () => window.__metalforge.fake.candidates());
    const foreign = cand.contradicting.includes(56) && first.name === 'Em' ? 56 : cand.contradicting[0];
    await playChord(page, f.midis, { foreign: [foreign] });
    await frames(page, 300);
    f = await forgeHook(page);
    log('  nota extraña:', f.headline, '|', f.msg1, '|', f.msg2);
    check(f.verdict === 'wrong' && f.foreign.length >= 1, 'forja: nota extraña detectada');
    check(/^Suena/.test(f.msg2), `forja: mensaje de nota extraña (${f.msg2})`);
    if (first.name === 'Em' && foreign === 56) check(f.msg2 === 'Suena un Sol#: ¿es Mi mayor en vez de Mi menor?', `forja: Mi menor vs Mi mayor (${f.msg2})`);
    await shot(page, 'forja-nota-extrana');
  } else {
    // --- a wrong note, then the notes in order
    await ev(page, (n) => window.__metalforge.fake.pluckNote(n), f.midis[0] + 1);
    await advance(page, 0.35);
    await frames(page, 300);
    f = await forgeHook(page);
    log('  nota equivocada:', f.headline, '|', f.msg1, '|', f.msg2);
    check(f.verdict === 'wrong' && /^Tocaste/.test(f.msg1), `forja bajo: mensaje de nota equivocada (${f.msg1})`);
    await shot(page, 'forja-nota-equivocada');
    await ev(page, (n) => window.__metalforge.fake.pluckNote(n), f.midis[0]);
    await advance(page, 0.35);
    await frames(page, 300);
    f = await forgeHook(page);
    check(f.step === 1, `forja bajo: va por la nota 2 (${f.step})`);
    await shot(page, 'forja-bajo-paso');
    for (const m of f.midis.slice(1)) {
      await ev(page, (n) => window.__metalforge.fake.pluckNote(n), m);
      await advance(page, 0.35);
    }
  }

  // --- the right chord
  if (!isBass) await playChord(page, f.midis);
  await frames(page, 250);
  f = await forgeHook(page);
  check(f.verdict === 'ok' && f.strikes === 1, `forja: acorde bueno = martillazo (${f.verdict}, ${f.strikes})`);
  if (!isBass) check(f.clean && f.heat > 0.3, 'forja: limpio calienta el lingote');
  await shot(page, 'forja-martillazo');
  await until(page, async () => (await forgeHook(page)).group === 1, 'siguiente acorde tras el martillazo', { tries: 30 });

  // --- skip one, perfect the rest
  await page.keyboard.press('s');
  await frames(page, 700);
  f = await forgeHook(page);
  check(f.group === 2, `forja: saltar pasa al siguiente (${f.group})`);
  for (let i = 2; i < first.groups; i++) {
    f = await forgeHook(page);
    await playChord(page, f.midis);
    await frames(page, 1000);
  }
  await until(page, async () => (await scene(page)) === 'results', 'resultados de Forja', { tries: 80 });
  const r = await results(page);
  log('  resultados:', JSON.stringify(r));
  const per = isBass ? first.steps : 1;
  check(r && r.hits === (first.groups - 1) * per && r.miss === per, `forja: ${first.groups - 1} acordes tocados y 1 saltado (${r && r.hits}/${r && r.miss})`);
  check(errors.length === 0, `forja nivel 1: errores de consola ${errors.join(' | ')}`);
  await ctx.close();
}


/** Plays the learn round of a change level until Forja offers the one-minute round. */
async function playRoundToOffer(page) {
  let f = await forgeHook(page);
  const n = f.groups;
  for (let i = 0; i < n; i++) {
    f = await forgeHook(page);
    await playChord(page, f.midis);
    await frames(page, 1000);
  }
  return until(page, async () => (await forgeHook(page)).phase === 'offer', 'oferta del minuto de cambios', { tries: 60 });
}

async function forgeMinute(browser, level) {
  log(`\n== Forja nivel ${level}: un minuto de cambios (${instrument}) ==`);
  const { ctx, page, errors } = await openGame(browser, { url, instrument, mode: 'learn', level });
  await advance(page, 1.0);
  await playRoundToOffer(page);
  let f = await forgeHook(page);
  check(f.minute === null && f.phase === 'offer', 'minuto: oferta sin minuto en marcha');
  await shot(page, `forja-oferta-${level}`);
  await page.keyboard.press('r'); // R = results; test Enter path instead below in a second page? No: Enter starts the minute
  await frames(page, 100);
  await ctx.close();

  // Enter path in a fresh page.
  const g = await openGame(browser, { url, instrument, mode: 'learn', level });
  await advance(g.page, 1.0);
  await playRoundToOffer(g.page);
  await g.page.keyboard.press('Enter');
  await until(g.page, async () => (await forgeHook(g.page)).phase === 'minute', 'fase del minuto');
  f = await forgeHook(g.page);
  check(f.minute && !f.minute.started && f.minute.remaining === 60, 'minuto: espera el primer acorde (60 s sin empezar)');
  await advance(g.page, 0.5);
  const runMinute = async (secondsPerChange, label, shotAt) => {
    let first = true;
    let taken = false;
    let wrongDone = false;
    for (let guard = 0; guard < 80; guard++) {
      f = await forgeHook(g.page);
      if (f.minute.over || f.minute.remaining <= 0) break;
      if (f.minute.started && !wrongDone && f.minute.changes >= 4) {
        wrongDone = true;
        // a wrong strum in the middle of the minute counts nothing
        const before = f.minute.changes;
        if (!isBass) await playChord(g.page, f.midis, { mutedStrings: [3] });
        else {
          await ev(g.page, (n) => window.__metalforge.fake.pluckNote(n), f.midis[0] + 1);
          await advance(g.page, 0.35);
        }
        const mid = await forgeHook(g.page);
        check(mid.minute.changes === before, 'minuto: un acorde malo no cuenta como cambio');
        check(mid.verdict === 'wrong', 'minuto: el veredicto de un acorde malo también se muestra');
        await advance(g.page, 0.5);
        continue;
      }
      await playChord(g.page, f.midis);
      await advance(g.page, Math.max(0, secondsPerChange - (isBass ? 0.35 * f.midis.length : 0.45)));
      if (first) {
        first = false;
        const a = await forgeHook(g.page);
        check(a.minute.started && a.minute.changes === 0, `minuto: el primer acorde empieza el minuto y no es un cambio (${JSON.stringify(a.minute)})`);
      }
      if (!taken && f.minute.started && f.minute.remaining < shotAt) {
        taken = true;
        await frames(g.page, 200);
        await shot(g.page, `forja-minuto-${label}`);
      }
    }
    await until(g.page, async () => (await forgeHook(g.page)).minute?.over, 'fin del minuto', { tries: 80 });
    return forgeHook(g.page);
  };
  f = await runMinute(2, 'a', 40);
  log('  minuto 1:', JSON.stringify(f.minute));
  const firstClean = f.minute.clean;
  check(f.minute.changes >= 25 && f.minute.changes <= 31, `minuto: ~30 cambios a 2 s cada uno (${f.minute.changes})`);
  check(f.minute.clean === f.minute.changes - (isBass ? 1 : 0), 'minuto: todos limpios con acordes perfectos (en bajo, el de la nota equivocada no)');
  check(f.minute.best === firstClean, `minuto: el mejor es el de esta ronda (${f.minute.best})`);
  await shot(g.page, `forja-minuto-fin`);
  await until(g.page, async () => (await scene(g.page)) === 'results', 'resultados tras el minuto', { tries: 80 });
  let r = await results(g.page);
  check(r && r.hits === f.groups || r.hits > 0, 'minuto: resultados de la ronda');

  // Again (Enter = Repetir): the best of the pair is remembered; a slower minute does not beat it.
  await g.page.keyboard.press('Enter');
  await waitScene(g.page, 'forge');
  await advance(g.page, 1.0);
  await playRoundToOffer(g.page);
  await g.page.keyboard.press('Enter');
  await until(g.page, async () => (await forgeHook(g.page)).phase === 'minute', 'fase del minuto (2)');
  await advance(g.page, 0.5);
  await frames(g.page, 400);
  f = await forgeHook(g.page);
  check(f.minute.best === firstClean, `minuto: recuerda el mejor de la pareja (${f.minute.best} vs ${firstClean})`);
  f = await runMinute(4, 'b', 0);
  log('  minuto 2:', JSON.stringify(f.minute));
  check(f.minute.clean < firstClean, 'minuto: a 4 s por cambio salen menos');
  check(f.minute.best === firstClean, 'minuto: el mejor no baja');
  check(g.errors.length === 0, `forja minuto: errores de consola ${g.errors.join(' | ')}`);
  void errors;
  await g.ctx.close();
}

async function forgeTimed(browser, level) {
  log(`\n== Forja nivel ${level}: progresión a tempo (${instrument}) ==`);
  const { ctx, page, errors } = await openGame(browser, { url, instrument, mode: 'learn', level });
  await advance(page, 0.2);
  let f = await forgeHook(page);
  check(f.timed, 'progresión: nivel con reloj');
  const beats = await ev(page, () => window.__metalforge.fake.targetBeats());
  await advanceToBeat(page, -2.5);
  await shot(page, 'forja-cuenta');
  const steps = f.steps;
  const labels = [];
  for (let i = 0; i < beats.length; i++) {
    await advanceToBeat(page, beats[i]);
    f = await forgeHook(page);
    const k = i % steps;
    const late = !isBass && i === 2; // one chord 150 ms late
    if (late) await advance(page, 0.15);
    if (!isBass) {
      const fault = i === beats.length - 1 ? { foreign: [(await ev(page, () => window.__metalforge.fake.candidates())).contradicting[0]] } : {};
      await ev(page, (o) => window.__metalforge.fake.strum(o), fault);
    } else await ev(page, (n) => window.__metalforge.fake.pluckNote(n), f.midis[k]);
    await advance(page, isBass ? 0.2 : 0.45);
    await frames(page, 150);
    f = await forgeHook(page);
    labels.push(f.timing);
    if (i === 1 || (isBass && i === 5)) await shot(page, 'forja-progresion');
  }
  log('  juicios:', labels.join(', '));
  if (!isBass) {
    check(labels[0] === 'A TIEMPO' && labels[1] === 'A TIEMPO', 'progresión: en su tiempo');
    check(labels[2] === 'TARDE', `progresión: 150 ms tarde (${labels[2]})`);
    check(labels[3] === 'NOTA DISTINTA', `progresión: nota extraña en el último (${labels[3]})`);
    await shot(page, 'forja-progresion-fallo');
  } else check(labels.every((l) => l === 'A TIEMPO'), 'progresión: todas las notas a tiempo');
  await until(page, async () => (await scene(page)) === 'results', 'resultados de la progresión', { tries: 80 });
  const r = await results(page);
  log('  resultados:', JSON.stringify(r));
  check(r && r.hits >= (isBass ? beats.length : 2), 'progresión: aciertos');
  check(errors.length === 0, `progresión: errores de consola ${errors.join(' | ')}`);
  await ctx.close();
}

// ---------------------------------------------------------------- Hechicero
const NEAREST_WRONG = { Em: 'E', E: 'Em', Am: 'A', A: 'Am', D: 'A', G: 'C', C: 'G', F: 'C', E5: 'G5', G5: 'A5', A5: 'C5', C5: 'D5', D5: 'E5' };

/** Waits (virtual time) until the live enemy's countdown is running. */
async function foeReady(page, margin = 0.5) {
  for (let i = 0; i < 120; i++) {
    const w = await wizHook(page);
    if (w.foe && w.remaining !== null && w.remaining < w.limit - margin && !w.banner) return w;
    if (w.over) return w;
    await advance(page, 0.25);
  }
  check(false, 'hechicero: no aparece ningún enemigo');
  return wizHook(page);
}

/** Casts the live enemy's spell: guitar = one strum, bass = its notes in order. */
async function cast(page, w, fault) {
  if (!isBass) {
    await ev(page, (o) => window.__metalforge.fake.strum(o), fault ?? {});
    await advance(page, 0.45);
  } else {
    for (const m of w.foe.midis) {
      await ev(page, (n) => window.__metalforge.fake.pluckNote(n), m);
      await advance(page, 0.3);
    }
  }
}

async function wizardPerfect(browser, level) {
  log(`\n== Hechicero nivel ${level}: partida perfecta con jefe (${instrument}) ==`);
  const { ctx, page, errors } = await openGame(browser, { url, instrument, mode: 'practice', level });
  await advance(page, 0.4);
  await frames(page, 300);
  let w = await wizHook(page);
  check(w.hearts === 3 && w.stage === 'foes' && w.wave === 1, `hechicero: arranque (${JSON.stringify(w)})`);
  await frames(page, 300);
  await shot(page, 'hechicero-oleada');
  const seen = { boss: false, banners: new Set(), maxPlates: 0, minPlates: 99, casts: 0, crits: 0, chain: 0, charge: false, mid: false, lastScore: 0, bossShot: false };
  for (let guard = 0; guard < 800; guard++) {
    if ((await scene(page)) === 'results') break;
    w = await wizHook(page);
    if (!w || w.over) {
      await frames(page, 250);
      continue;
    }
    if (w.banner) seen.banners.add(w.banner);
    if (w.stage === 'boss') {
      seen.boss = true;
      seen.maxPlates = Math.max(seen.maxPlates, w.platesTotal);
      seen.minPlates = Math.min(seen.minPlates, w.plates);
    }
    if (!w.foe || w.remaining === null || w.remaining > w.limit) {
      await advance(page, 0.25);
      continue;
    }
    if (seen.casts === 2 && !seen.mid && w.wave === 1) {
      seen.mid = true;
      await advance(page, 3);
      await frames(page, 250);
      await shot(page, 'hechicero-oleada-media');
      w = await wizHook(page);
    }
    if (w.stage === 'boss' && !seen.bossShot) {
      seen.bossShot = true;
      await frames(page, 250);
      await shot(page, 'hechicero-jefe');
    }
    if (!isBass && seen.casts === 0) {
      await ev(page, () => window.__metalforge.fake.strum({}));
      await advance(page, 0.1);
      const c = await wizHook(page);
      seen.charge = c.casting && c.foe !== null;
      await frames(page, 200);
      await shot(page, 'hechicero-lanzando');
      await advance(page, 0.45);
    } else await cast(page, w);
    await frames(page, 150);
    w = await wizHook(page);
    seen.casts++;
    if (w.last === 'critical') seen.crits++;
    seen.chain = Math.max(seen.chain, w.chain);
    if (seen.casts === 1) {
      check(w.last === 'critical' && w.lastPoints >= 150, `hechicero: primer hechizo limpio = crítico (${w.last} +${w.lastPoints})`);
      await shot(page, 'hechicero-critico');
    }
    if (w.score < seen.lastScore) check(false, 'hechicero: la puntuación no baja');
    seen.lastScore = w.score;
    await advance(page, 0.5);
  }
  await until(page, async () => (await scene(page)) === 'results', 'resultados de Hechicero', { tries: 80 });
  const r = await results(page);
  log('  casts', seen.casts, 'críticos', seen.crits, 'cadena máx', seen.chain, 'banners', [...seen.banners].join(' | '), 'jefe placas', seen.maxPlates, '->', seen.minPlates);
  log('  resultados:', JSON.stringify(r));
  check(seen.charge || isBass, 'hechicero: carga de lanzamiento mientras llega el veredicto');
  check(seen.boss && seen.maxPlates >= 4 && seen.maxPlates <= 6, `hechicero: jefe con 4-6 placas (${seen.maxPlates})`);
  check(seen.minPlates <= 1, `hechicero: el escudo se rompe placa a placa (${seen.minPlates})`);
  check(seen.banners.has('OLEADA 2') && seen.banners.has('OLEADA 3') && seen.banners.has('¡JEFE!'), `hechicero: carteles de oleada y jefe (${[...seen.banners]})`);
  check(seen.crits === seen.casts, `hechicero: todos críticos (${seen.crits}/${seen.casts})`);
  check(seen.chain >= 3, `hechicero: cadena de cambios (${seen.chain})`);
  check(r && r.arcade && r.arcade.score > 1500 && r.arcade.bestCombo >= 19, `hechicero: puntos y racha en resultados (${r && JSON.stringify(r.arcade)})`);
  check(r && r.stars === 3, `hechicero: 3 estrellas (${r && r.stars})`);
  await shot(page, 'hechicero-resultados');
  check(errors.length === 0, `hechicero perfecto: errores de consola ${errors.join(' | ')}`);
  await ctx.close();
}

async function wizardWrong(browser, level) {
  log(`\n== Hechicero nivel ${level}: acordes equivocados (${instrument}) ==`);
  const { ctx, page, errors } = await openGame(browser, { url, instrument, mode: 'practice', level });
  await advance(page, 0.4);
  let w = await foeReady(page);
  const name1 = w.foe.name;
  if (!isBass) await cast(page, w, { name: NEAREST_WRONG[name1] });
  else {
    await ev(page, (n) => window.__metalforge.fake.pluckNote(n), w.foe.midis[0] + 1);
    await advance(page, 0.35);
  }
  await frames(page, 250);
  w = await wizHook(page);
  check(w.last === 'fizzle' && w.hearts === 3 && w.combo === 0, `hechicero: acorde equivocado = hechizo fallido sin perder corazón (${w.last}, ${w.hearts})`);
  check(w.foe && w.foe.name === name1, 'hechicero: el enemigo sigue esperando');
  await shot(page, 'hechicero-fallo');
  await cast(page, w);
  await frames(page, 200);
  w = await wizHook(page);
  check(w.last === 'normal', `hechicero: tras fallar, golpe normal (${w.last})`);
  const normalPoints = w.lastPoints;
  w = await foeReady(page);
  if (!isBass) {
    await cast(page, w, { level: 0.52 });
    await frames(page, 200);
    w = await wizHook(page);
    check(w.last === 'normal' && w.combo === 0, `hechicero: acorde flojo = golpe normal sin subir la racha (${w.last}, racha ${w.combo})`);
  }
  w = await foeReady(page);
  await cast(page, w);
  await frames(page, 200);
  w = await wizHook(page);
  check(w.last === 'critical' && w.lastPoints > normalPoints, `hechicero: limpio = crítico y más puntos (${w.lastPoints} > ${normalPoints})`);
  w = await foeReady(page);
  await cast(page, w);
  await frames(page, 200);
  w = await wizHook(page);
  check(w.chain >= 1, `hechicero: cambio rápido = cadena (${w.chain})`);
  check(errors.length === 0, `hechicero fallos: errores de consola ${errors.join(' | ')}`);
  await ctx.close();
}

async function wizardSilent(browser, level) {
  log(`\n== Hechicero nivel ${level}: en silencio (${instrument}) ==`);
  const { ctx, page, errors } = await openGame(browser, { url, instrument, mode: 'practice', level });
  await advance(page, 0.4);
  const seen = { restarts: 0, banners: new Set(), limits: [], hearts: new Set() };
  let w = await wizHook(page);
  seen.limits.push(w.limit);
  let shotRestart = false;
  let shotHeart = false;
  for (let guard = 0; guard < 900; guard++) {
    if ((await scene(page)) === 'results') break;
    w = await wizHook(page);
    if (!w) break;
    if (w.banner) seen.banners.add(w.banner);
    seen.hearts.add(w.hearts);
    if (w.restarts > seen.restarts) {
      seen.restarts = w.restarts;
      seen.limits.push(w.limit);
    }
    if (w.banner === 'Otra vez, más despacio' && !shotRestart) {
      shotRestart = true;
      await frames(page, 300);
      await shot(page, 'hechicero-reinicio');
    }
    if (w.hearts === 1 && !shotHeart) {
      shotHeart = true;
      await frames(page, 200);
      await shot(page, 'hechicero-corazones');
    }
    await advance(page, 1);
  }
  await until(page, async () => (await scene(page)) === 'results', 'resultados tras perder', { tries: 120 });
  const r = await results(page);
  log('  reinicios', seen.restarts, 'límites', seen.limits.join(' -> '), 'carteles', [...seen.banners].join(' | '));
  log('  resultados:', JSON.stringify(r));
  check(seen.restarts === 3, `hechicero: 3 reinicios antes de acabar (${seen.restarts})`);
  check(seen.banners.has('Otra vez, más despacio'), 'hechicero: cartel «Otra vez, más despacio»');
  check(seen.limits.every((l, i) => i === 0 || l >= seen.limits[i - 1]) && seen.limits[1] > seen.limits[0], `hechicero: cada reinicio da más tiempo, hasta el doble de la base (${seen.limits})`);
  check(seen.hearts.has(0) || seen.hearts.has(1), 'hechicero: se pierden corazones');
  check(r && r.arcade && r.arcade.score === 0, 'hechicero: en silencio no hay puntos');
  check(errors.length === 0, `hechicero silencio: errores de consola ${errors.join(' | ')}`);
  await ctx.close();
}

async function wizardTimed(browser, level) {
  log(`\n== Hechicero nivel ${level}: a tempo (${instrument}) ==`);
  const { ctx, page, errors } = await openGame(browser, { url, instrument, mode: 'practice', level });
  await advance(page, 0.3);
  let w = await wizHook(page);
  check(w.timed && w.bpm === 60, `hechicero a tempo: nivel con reloj (${w.bpm} bpm)`);
  let att = -1;
  let idx = 0;
  const outcome = [];
  let shotDone = false;
  for (let guard = 0; guard < 500; guard++) {
    if ((await scene(page)) === 'results') break;
    w = await wizHook(page);
    if (!w) break;
    if (w.over) {
      await frames(page, 250);
      continue;
    }
    if (w.attempt !== att) {
      att = w.attempt;
      idx = 0;
      await advance(page, 0.2);
    }
    const beats = await ev(page, () => window.__metalforge.fake.targetBeats());
    if (idx >= beats.length) {
      await advance(page, 0.5);
      continue;
    }
    const groupSize = isBass ? (w.foe?.steps ?? 3) : 1;
    const gi = Math.floor(idx / groupSize);
    const k = idx % groupSize;
    await advanceToBeat(page, beats[idx]);
    w = await wizHook(page);
    if (!w.foe) {
      idx++;
      continue;
    }
    const script = w.wave === 1 && w.stage === 'foes' && w.attempt === 1 ? (['ok', 'late', 'wrong', 'miss'][gi] ?? 'ok') : 'ok';
    if (!isBass) {
      if (script === 'miss') await advance(page, 0.9);
      else {
        if (script === 'late') await advance(page, 0.15);
        const fault = script === 'wrong' ? { name: NEAREST_WRONG[w.foe.name] } : {};
        await ev(page, (o) => window.__metalforge.fake.strum(o), fault);
        await advance(page, 0.45);
      }
    } else if (script === 'miss') await advance(page, 0.5);
    else {
      const note = script === 'wrong' ? w.foe.midis[k] + 1 : w.foe.midis[k];
      if (script === 'late') await advance(page, 0.15);
      await ev(page, (n) => window.__metalforge.fake.pluckNote(n), note);
      await advance(page, 0.25);
    }
    if (script === 'miss' && k === groupSize - 1) await advance(page, 0.8);
    await frames(page, 120);
    w = await wizHook(page);
    if (k === groupSize - 1) outcome.push(`${script}:${w.last}`);
    if (!shotDone && idx === groupSize * 2 - 1) {
      shotDone = true;
      await shot(page, 'hechicero-tempo');
    }
    idx++;
  }
  await until(page, async () => (await scene(page)) === 'results', 'resultados a tempo', { tries: 120 });
  const r = await results(page);
  const o = outcome.slice(0, 4);
  log('  hechizos de la onda 1:', o.join(', '));
  log('  resultados:', JSON.stringify(r));
  check(o[0] === 'ok:critical', `hechicero a tempo: en el pulso = crítico (${o[0]})`);
  check(o[1] === 'late:normal', `hechicero a tempo: 150 ms tarde = golpe normal (${o[1]})`);
  check(o[2] === 'wrong:fizzle', `hechicero a tempo: acorde equivocado = fallo (${o[2]})`);
  check(o[3] === 'miss:arrived', `hechicero a tempo: sin tocar = el enemigo llega (${o[3]})`);
  check(r && r.arcade && r.arcade.score > 800, `hechicero a tempo: puntos (${r && r.arcade && r.arcade.score})`);
  check(errors.length === 0, `hechicero a tempo: errores de consola ${errors.join(' | ')}`);
  await ctx.close();
}

// ---------------------------------------------------------------- run
(async () => {
  const browser = await chromium.launch();
  if (only === 'all' || only === 'forge') {
    await forgeLevel1(browser);
    await forgeMinute(browser, 6); // first level where every chord is a change (levels 1-5 repeat each chord)
    await forgeTimed(browser, 10);
  }
  if (only === 'all' || only === 'wizard') {
    await wizardPerfect(browser, 6); // a changes level: the chain of changes needs changes
    await wizardWrong(browser, 6); // needs a changes level for the chain check
    await wizardSilent(browser, 1);
    await wizardTimed(browser, 10);
  }
  await browser.close();
  log(failures.length ? `\nFALLOS (${failures.length}):\n - ${failures.join('\n - ')}` : '\nTodo bien');
  process.exit(failures.length ? 1 : 0);
})();
