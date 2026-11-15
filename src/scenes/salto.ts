import Phaser from 'phaser';
import { drawText, placeText } from '../art/text';
import { addBackground, enterScene, H, profileStore, W } from '../engine/kit';
import { hooks } from '../engine/hooks';
import { generate } from '../exercises';
import { makeFakeControl } from '../game/fakePlayer';
import { FakeInput } from '../game/input';
import { saveArcadeBest } from '../game/progressBlob';
import { GAMES } from '../game/registry';
import { MAX_HEARTS, ROUNDS, SaltoRun, type RoundPlan } from '../game/salto/state';
import { beginGame, showResults, trackEnergy } from '../game/scene';
import type { GameSession } from '../game/session';
import type { GameSceneData } from '../game/types';
import { JUDGEMENT_STYLE, panel } from '../game/ui';
import type { Exercise, Judgement } from '../model/exercise';
import { summarize } from '../scoring/summary';
import type { ScoredTarget } from '../scoring/types';
import { paletteInt, type PaletteKey } from '../ui/palette';

/** Where the runner stands: an obstacle is exactly here on its beat. */
const HIT_X = 64;
/** Pixels per beat: obstacle spacing IS the rhythm. */
const PPB = 46;
const GROUND_Y = 132;
const RIBBON_Y = 41;
const SKY_TOP = 50;
const SEED_STEP = 7919;
/** Verdict pop-up: under the ground, below the runner, where nothing else is drawn. */
const POP_X = HIT_X + 12;
const POP_Y = GROUND_Y + 28;

type ObstacleKind = 'coral' | 'urchin' | 'pit';

interface Obstacle {
  beat: number;
  kind: ObstacleKind;
  image: Phaser.GameObjects.Image;
  verdict: Judgement | null;
  /** Half-length (beats) and height (px) of the jump that clears it: shorter hops when the rhythm is dense. */
  reach: number;
  height: number;
}

interface Jump {
  center: number;
  reach: number;
  height: number;
}

/** Deterministic obstacle type for a target: pits only where there is room to land on both sides. */
function obstacleKind(index: number, gap: number): ObstacleKind {
  const n = (index * 7 + 3) % 5;
  if (gap >= 0.5 && n === 4) return 'pit';
  return n % 2 === 0 ? 'coral' : 'urchin';
}

/**
 * Salto: the ARCADE practice game for rhythm. Same timed Exercise and Judge as Pulso; here the pattern is the
 * terrain of an endless run and there are hearts, combo and score (rules in src/game/salto/state.ts).
 * Everything is placed from `session.beat()`: x = HIT_X + (target.beat - beat) * PPB.
 */
export class SaltoScene extends Phaser.Scene {
  constructor() {
    super('salto');
  }

  create(data: GameSceneData): void {
    enterScene(this, 'salto');
    addBackground(this);
    const store = profileStore(this);
    const def = GAMES[data.params.gameId];
    const baseSeed = data.params.seed ?? 1;
    const run = new SaltoRun(data.exercise.bpm ?? 60);

    let session: GameSession = data.session;
    let obstacles: Obstacle[] = [];
    let jumps: Jump[] = [];
    let offs: (() => void)[] = [];
    let pending: 'next' | 'fail' | null = null;
    let roundStartBeat = -4;
    let stumbleUntil = -Infinity;
    let blinkUntil = -Infinity;
    let shownHeight = 0;
    let shownMomentum = 1;
    let pose = '';
    let banner = '';
    let bannerSub = '';
    let bannerColor: PaletteKey = 'amber';
    let popAt = -1e9;
    let strays = 0;
    let ended = false;
    /** Final results of completed rounds; if none was completed the results use every attempt instead. */
    const completed: ScoredTarget[] = [];
    const attempted: ScoredTarget[] = [];

    // ---- static layout ----
    drawText(this, 8, 6, 'SALTO', { scale: 2, color: def.accent, depth: 10 });
    const scoreText = drawText(this, W / 2, 6, '0', { scale: 2, color: 'foam', align: 'center', depth: 10 });
    const tempoText = drawText(this, W - 8, 6, '', { color: 'foam', align: 'right', depth: 10 });
    const roundText = drawText(this, W - 8, 16, '', { color: 'dim', align: 'right', depth: 10 });
    const comboText = drawText(this, W / 2, 24, '', { color: 'dim', align: 'center', depth: 10 });
    const hearts = Array.from({ length: MAX_HEARTS }, (_, i) => this.add.image(8 + i * 10, 22, 'heart').setOrigin(0, 0).setDepth(10));
    const back = this.add.graphics().setDepth(1);
    const groundTop = this.add.tileSprite(0, GROUND_Y, W, 8, 'ground-top').setOrigin(0, 0).setDepth(2);
    const groundFill = this.add.tileSprite(0, GROUND_Y + 8, W, 16, 'ground-fill').setOrigin(0, 0).setDepth(2);
    const g = this.add.graphics().setDepth(3);
    const runner = this.add.sprite(HIT_X, GROUND_Y + 1, 'runner-run').setOrigin(0.5, 1).setDepth(6);
    const bannerText = drawText(this, W / 2, 54, '', { scale: 2, color: 'amber', align: 'center', depth: 10 });
    const bannerSubText = drawText(this, W / 2, 72, '', { color: 'foam', align: 'center', depth: 10 });
    const count = drawText(this, W / 2, 86, '', { scale: 2, color: 'lime', align: 'center', depth: 10 });
    const pop = drawText(this, POP_X, POP_Y, '', { color: 'lime', align: 'center', depth: 10 });
    const hint = drawText(this, W / 2, H - 10, '', { color: 'dim', align: 'center', depth: 10 });
    const showHint = () => placeText(hint, W / 2, H - 10, `Toca en cada obstáculo   M metrónomo: ${session.metronome.isMuted ? 'no' : 'sí'}   Esc salir`, { color: 'dim', align: 'center' });
    this.input.keyboard?.on('keydown-M', () => {
      session.metronome.setMuted(!session.metronome.isMuted);
      void store.setSettings({ metronomeOn: !session.metronome.isMuted });
      showHint();
    });

    const showHud = () => {
      placeText(scoreText, W / 2, 6, String(run.score), { scale: 2, color: 'foam', align: 'center' });
      const m = run.multiplier;
      placeText(comboText, W / 2, 24, `RACHA ${run.combo}  ·  x${m}`, { color: m >= 4 ? 'lime' : m >= 2 ? 'cyan' : 'dim', align: 'center' });
      placeText(tempoText, W - 8, 6, `NIVEL ${data.level}  ·  ${run.bpm} BPM`, { color: 'foam', align: 'right' });
      placeText(roundText, W - 8, 16, `RONDA ${run.round}/${ROUNDS}`, { color: 'dim', align: 'right' });
      hearts.forEach((h, i) => h.setTexture(i < run.hearts ? 'heart' : 'heart-empty'));
    };

    const setPose = (p: 'run' | 'jump' | 'stumble') => {
      if (p === pose) return;
      pose = p;
      if (p === 'run') runner.play('runner-run');
      else if (p === 'stumble') runner.play('runner-stumble');
      else {
        runner.anims.stop();
        runner.setTexture('runner-jump');
      }
    };

    // ---- rounds ----
    const exerciseFor = (plan: RoundPlan): Exercise => {
      // Round 1 is the launcher's exercise; a retry repeats its round's pattern, only slower.
      const base = plan.round === 1 ? data.exercise : generate(data.skill, { instrument: data.exercise.instrument, level: data.level, seed: baseSeed + (plan.round - 1) * SEED_STEP, length: def.length });
      return { ...base, bpm: plan.bpm };
    };

    const wire = (s: GameSession, first: boolean) => {
      const targets = s.exercise.targets;
      obstacles.forEach((o) => o.image.destroy());
      obstacles = targets.map((t, i) => {
        const beat = t.beat ?? 0;
        const prev = i > 0 ? beat - (targets[i - 1].beat ?? 0) : 4;
        const next = i < targets.length - 1 ? (targets[i + 1].beat ?? 0) - beat : 4;
        const gap = Math.min(prev, next);
        const kind = obstacleKind(i, gap);
        const reach = Math.max(0.11, Math.min(0.32, 0.42 * gap));
        const image = this.add
          .image(0, kind === 'pit' ? GROUND_Y : GROUND_Y + 1, `obst-${kind}`)
          .setOrigin(0.5, kind === 'pit' ? 0 : 1)
          .setDepth(4)
          .setVisible(false);
        return { beat, kind, image, verdict: null, reach, height: Math.round(10 + 12 * (reach / 0.32)) };
      });
      offs.forEach((f) => f());
      offs = [
        s.on('countIn', (b) => placeText(count, W / 2, 86, `PREPARADOS  ${b}`, { scale: 2, color: b === s.clock.countInBeats ? 'lime' : 'foam', align: 'center' })),
        s.on('go', () => placeText(count, W / 2, 86, 'YA', { scale: 2, color: 'lime', align: 'center' })),
        s.on('stray', () => strays++),
        s.on('targetResolved', (r) => onResolved(s, r)),
        s.on('finished', (_summary, results) => onFinished(s, results)),
      ];
      if (!first) offs.push(trackEnergy(this, s));
      hooks.fake = s.input instanceof FakeInput ? makeFakeControl(s, s.input) : null;
      count.setAlpha(1);
      placeText(count, W / 2, 86, '', { scale: 2, color: 'lime', align: 'center' });
      showHud();
      showHint();
    };

    const onResolved = (s: GameSession, r: ScoredTarget) => {
      if (s !== session || ended || pending === 'fail') return;
      const o = obstacles[r.index];
      const res = run.resolve(r.judgement, o.beat);
      o.verdict = r.judgement;
      attempted.push(r);
      hooks.judged.push({ index: r.index, judgement: r.judgement, deltaMs: Math.round(r.delta * 1000) });
      const style = JUDGEMENT_STYLE[r.judgement];
      const beatNow = s.beat();
      if (res.outcome === 'clean') jumps.push({ center: o.beat, reach: o.reach, height: o.height });
      else if (res.outcome === 'clumsy') jumps.push({ center: o.beat + r.delta * (s.clock.bpm / 60), reach: o.reach * 0.8, height: Math.round(o.height * 0.6) });
      else {
        if (o.kind !== 'pit') o.image.setVisible(false).setActive(false);
        if (res.outcome === 'stumble') {
          stumbleUntil = beatNow + 1;
          blinkUntil = beatNow + 2.5;
          this.cameras.main.flash(90, 255, 63, 180, false);
        }
      }
      if (jumps.length > 6) jumps.shift();
      const label = res.outcome === 'stumble' ? 'TROPIEZO' : res.outcome === 'spared' ? 'SIN GOLPE' : style.label;
      placeText(pop, POP_X, POP_Y, res.points ? `${label}  +${res.points}` : label, { color: res.outcome === 'stumble' ? 'magenta' : style.color, align: 'center' });
      popAt = this.time.now;
      showHud();
      if (res.roundFailed) pending = 'fail';
    };

    const onFinished = (s: GameSession, results: ScoredTarget[]) => {
      if (s !== session || ended || pending === 'fail') return;
      completed.push(...results);
      const end = run.completeRound();
      showHud();
      if (end.over) finishRun();
      else pending = 'next';
    };

    const finishRun = () => {
      if (ended) return;
      ended = true;
      banner = bannerSub = '';
      count.setAlpha(1);
      placeText(count, W / 2, 86, 'FIN', { scale: 2, color: 'cyan', align: 'center' });
      const pool = completed.length ? completed : attempted;
      const summary = summarize(pool, Math.max(1, pool.length), true, strays);
      const instrument = data.exercise.instrument;
      const open = (previousBest: number, newBest: boolean) => {
        if (!this.scene.isActive()) return;
        showResults(this, { params: data.params, mode: data.mode, level: data.level, skill: data.skill, summary, arcade: { score: run.score, bestCombo: run.bestCombo, previousBest, newBest } });
      };
      saveArcadeBest(store, instrument, def.id, data.level, { score: run.score, bestCombo: run.bestCombo }).then(
        (b) => open(b.previousBest, b.newBest),
        () => open(0, false),
      );
    };

    /** Replaces the session by the one for `run.plan()`; visual state (a jump in the air) moves to the new beat. */
    const switchRound = () => {
      const plan = run.plan();
      const before = session.beat();
      session.release();
      if (session.input instanceof FakeInput) session.input.clearPending();
      session = session.spawn(exerciseFor(plan), { countInBeats: plan.countInBeats });
      wire(session, false);
      session.start();
      const shift = session.beat() - before;
      jumps = jumps.map((j) => ({ ...j, center: j.center + shift }));
      stumbleUntil += shift;
      blinkUntil += shift;
      roundStartBeat = session.beat();
      popAt = -1e9;
    };

    const step = () => {
      if (ended || !pending) return;
      const what = pending;
      pending = null;
      if (what === 'fail') {
        const fail = run.failRound();
        if (fail.over) {
          session.release();
          showHud();
          finishRun();
          return;
        }
        banner = 'Otra vez, más despacio';
        bannerSub = `TEMPO ${fail.bpm} BPM  ↓`;
        bannerColor = 'amber';
      } else {
        const up = run.bpm > session.clock.bpm;
        const down = run.bpm < session.clock.bpm;
        banner = `RONDA ${run.round}`;
        bannerSub = `TEMPO ${run.bpm} BPM${up ? '  ↑' : down ? '  ↓' : ''}`;
        bannerColor = 'cyan';
      }
      switchRound();
    };

    // ---- drawing ----
    const redraw = () => {
      step();
      const beat = session.beat();
      const xOf = (b: number) => Math.round(HIT_X + (b - beat) * PPB);

      // Beat grid: faint lines behind everything, ticks on the ground, bar lines a little stronger.
      back.clear();
      g.clear();
      panel(back, 4, RIBBON_Y - 7, W - 8, 15, 'water', 'deep', 0.8);
      const first = Math.floor(beat - HIT_X / PPB) - 1;
      const last = Math.ceil(beat + (W - HIT_X) / PPB) + 1;
      for (let b = first; b <= last; b++) {
        if (b < -session.clock.countInBeats) continue;
        const x = xOf(b);
        if (x < 6 || x > W - 6) continue;
        const bar = ((b % 4) + 4) % 4 === 0;
        back.fillStyle(paletteInt('dim'), bar ? 0.45 : 0.2).fillRect(x, SKY_TOP, 1, GROUND_Y - SKY_TOP);
        back.fillStyle(paletteInt(bar ? 'dim' : 'water'), 1).fillRect(x, RIBBON_Y - (bar ? 5 : 3), 1, bar ? 11 : 7);
        g.fillStyle(paletteInt(bar ? 'foam' : 'cyan'), bar ? 0.9 : 0.6).fillRect(x, GROUND_Y + 1, 1, bar ? 5 : 3);
      }
      back.fillStyle(paletteInt('cyan'), 0.8).fillRect(HIT_X, RIBBON_Y - 6, 1, 13);
      groundTop.tilePositionX = Math.round(beat * PPB);
      groundFill.tilePositionX = Math.round(beat * PPB);

      // Obstacles (the terrain) and their rhythm marks on the ribbon, both at the same x.
      const fade = Math.max(0, Math.min(1, beat - roundStartBeat));
      const xs: number[] = [];
      for (const o of obstacles) {
        const x = xOf(o.beat);
        xs.push(x);
        if (x < -8 || x > W + 8) {
          o.image.setVisible(false);
          continue;
        }
        if (x > 6 && x < W - 6) {
          const color: PaletteKey = o.verdict ? JUDGEMENT_STYLE[o.verdict].color : 'cyan';
          back.fillStyle(paletteInt('abyss'), 1).fillRect(x - 3, RIBBON_Y - 3, 7, 7);
          back.fillStyle(paletteInt(color), o.verdict === 'miss' ? 0.5 : 1).fillRect(x - 2, RIBBON_Y - 2, 5, 5);
        }
        if (!o.image.active) continue;
        // Not judged yet and already at the runner: it waits in front of him until the verdict arrives.
        const drawX = o.verdict === null && o.kind !== 'pit' ? Math.max(x, HIT_X + 5) : x;
        o.image.setPosition(drawX, o.image.y).setVisible(true).setAlpha(fade);
        if (o.kind === 'pit') g.fillStyle(paletteInt('abyss'), fade).fillRect(drawX - 3, GROUND_Y + 8, 6, 16);
      }

      // Runner: height from the jumps (arcs centred on the obstacle's beat), pose and momentum.
      let target = 0;
      for (const j of jumps) {
        const u = (beat - j.center) / j.reach;
        if (u > -1 && u < 1) target = Math.max(target, j.height * (1 - u * u));
      }
      shownHeight = target > shownHeight ? shownHeight + (target - shownHeight) * 0.6 : target;
      shownMomentum += (run.momentum - shownMomentum) * 0.08;
      const stumbling = beat < stumbleUntil;
      setPose(stumbling ? 'stumble' : shownHeight > 1 ? 'jump' : 'run');
      runner.setPosition(HIT_X - Math.round((1 - shownMomentum) * 6), GROUND_Y + 1 - Math.round(stumbling ? 0 : shownHeight));
      runner.setAlpha(!ended && beat < blinkUntil && Math.floor(beat * 8) % 2 === 0 ? 0.35 : 1);

      // Texts: banner during the count-in, verdict pop-up for a moment.
      const inCount = beat < 0 && !ended;
      placeText(bannerText, W / 2, 54, inCount ? banner : '', { scale: 2, color: bannerColor, align: 'center' });
      placeText(bannerSubText, W / 2, 72, inCount ? bannerSub : '', { color: 'foam', align: 'center' });
      if (!ended && beat >= 1.5) count.setAlpha(0);
      const age = this.time.now - popAt;
      pop.setAlpha(age < 700 ? 1 : age < 1000 ? 1 - (age - 700) / 300 : 0);

      hooks.salto = {
        round: run.round,
        rounds: ROUNDS,
        attempt: run.attempt,
        restarts: run.restarts,
        bpm: run.bpm,
        hearts: run.hearts,
        score: run.score,
        combo: run.combo,
        bestCombo: run.bestCombo,
        multiplier: run.multiplier,
        pose,
        banner: inCount ? banner : '',
        obstacleX: xs,
        targetBeats: obstacles.map((o) => o.beat),
        over: ended,
      };
    };
    this.events.on(Phaser.Scenes.Events.UPDATE, redraw);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.UPDATE, redraw);
      offs.forEach((f) => f());
      session.dispose();
      hooks.salto = null;
    });

    hooks.judged = [];
    wire(session, true);
    setPose('run');
    beginGame(this, data, { manual: true });
    roundStartBeat = session.beat();
  }
}
