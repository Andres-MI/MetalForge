import Phaser from 'phaser';
import { drawText, placeText } from '../art/text';
import { addBackground, enterScene, H, profileStore, W } from '../engine/kit';
import { hooks } from '../engine/hooks';
import { generate } from '../exercises';
import { makeFakeControl } from '../game/fakePlayer';
import { FakeInput } from '../game/input';
import { baseShotSeconds, baseTimedBpm } from '../game/portero/pace';
import { planShots, ringRadius, shotLimit, timedPhase, timeLeft, type ShotGroup } from '../game/portero/shots';
import { MAX_HEARTS, PorteroRun, ROUNDS, type RoundPlan } from '../game/portero/state';
import { saveArcadeBest } from '../game/progressBlob';
import { GAMES } from '../game/registry';
import { beginGame, showResults, trackEnergy } from '../game/scene';
import type { GameSession } from '../game/session';
import { fretWords, locateHeard, stringLabel, targetPositions } from '../game/strings';
import type { GameSceneData } from '../game/types';
import type { Exercise } from '../model/exercise';
import { INSTRUMENTS } from '../model/instrument';
import { summarize } from '../scoring/summary';
import type { ScoredTarget } from '../scoring/types';
import { paletteInt, type PaletteKey } from '../ui/palette';
import { arcPoints, stringKey } from './stringsView';

const SEED_STEP = 7919;
const GX0 = 88;
const GX1 = 232;
const GY0 = 44;
const CX = (GX0 + GX1) / 2;
const SHOOTER_Y = 157;
const BALL_X = CX;
const BALL_Y = 137;
/** Seconds of "RONDA n" before the first shot of an untimed round. */
const ROUND_GRACE = 1.5;
const ANIM_MS = 700;

type ShotState = 'live' | 'clean' | 'fumbled' | 'goal';

interface Shot {
  index: number;
  string: number;
  fret: number;
  midi: number;
  bx: number;
  by: number;
  /** Beat of arrival (timed). */
  beat: number;
  role: 'single' | 'first' | 'second';
  state: ShotState;
  /** Wall time (Phaser clock, cosmetic) the verdict arrived, and where the ball was then. */
  doneAt: number;
  from: { x: number; y: number };
}

/** Pixel circle outline (midpoint), crisp at 320x180. */
function ring(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, key: PaletteKey, alpha = 1): void {
  g.fillStyle(paletteInt(key), alpha);
  let x = r;
  let y = 0;
  let err = 1 - r;
  while (x >= y) {
    for (const [px, py] of [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]]) g.fillRect(Math.round(cx + px), Math.round(cy + py), 1, 1);
    y++;
    if (err < 0) err += 2 * y + 1;
    else {
      x--;
      err += 2 * (y - x) + 1;
    }
  }
}

/**
 * Portero: the ARCADE practice game for strings. A penalty shoot-out seen from the front of the goal: every string
 * is a height band of the goal (lowest-pitched at the bottom, in its string colour). The shooter aims, a marker and
 * a shrinking ring show the band and the moment; playing that string makes the keeper dive and save it.
 * Rules (hearts, combo, pace, rounds) live in src/game/portero/; here only drawing and glue.
 */
export class PorteroScene extends Phaser.Scene {
  constructor() {
    super('portero');
  }

  create(data0: GameSceneData): void {
    enterScene(this, 'portero');
    addBackground(this);
    const store = profileStore(this);
    const def = GAMES[data0.params.gameId];
    const baseSeed = data0.params.seed ?? 1;
    const instId = data0.exercise.instrument;
    const inst = INSTRUMENTS[instId];
    const n = inst.openStrings.length;
    const timed = data0.exercise.timed;
    const bandH = Math.floor(78 / n);
    const GY1 = GY0 + bandH * n;
    const bandY = (s: number) => GY1 - (s + 0.5) * bandH;
    const basePace = timed ? baseTimedBpm(data0.exercise.bpm ?? 60, instId) : baseShotSeconds(data0.level, instId);
    const run = new PorteroRun(timed, basePace);
    const level = data0.level;

    // The launcher's session runs the generator's tempo; a bass plays the timed levels slower: start over at ours.
    const exerciseFor = (plan: RoundPlan): Exercise => {
      const base = plan.round === 1 ? data0.exercise : generate(data0.skill, { instrument: instId, level, seed: baseSeed + (plan.round - 1) * SEED_STEP, length: def.length });
      return timed ? { ...base, bpm: plan.pace } : base;
    };
    let session: GameSession = data0.session;
    if (timed && data0.exercise.bpm !== run.pace) {
      session = data0.session.spawn(exerciseFor(run.plan()));
      data0.session.release();
    }
    const data: GameSceneData = { ...data0, session };

    let shots: Shot[] = [];
    let groups: ShotGroup[] = [];
    let strings: number[] = [];
    let startAt: number[] = [];
    let deadlineAt: number[] = [];
    let offs: (() => void)[] = [];
    let pending: 'next' | 'fail' | null = null;
    let roundStartClock = 0;
    let banner = '';
    let bannerSub = '';
    let bannerColor: PaletteKey = 'amber';
    let popAt = -1e9;
    let dive: { x: number; y: number; flip: boolean; at: number; wrong: boolean } | null = null;
    let strays = 0;
    let ended = false;
    let netPulse: { x: number; y: number; at: number } | null = null;
    const completed: ScoredTarget[] = [];
    const attempted: ScoredTarget[] = [];

    // ---- static layout ----
    drawText(this, 8, 6, 'PORTERO', { scale: 2, color: def.accent, depth: 10 });
    const scoreText = drawText(this, W / 2 + 22, 6, '0', { scale: 2, color: 'foam', align: 'center', depth: 10 });
    const tempoText = drawText(this, W - 8, 6, '', { color: 'foam', align: 'right', depth: 10 });
    const roundText = drawText(this, W - 8, 16, '', { color: 'dim', align: 'right', depth: 10 });
    const comboText = drawText(this, W / 2 + 22, 24, '', { color: 'dim', align: 'center', depth: 10 });
    const hearts = Array.from({ length: MAX_HEARTS }, (_, i) => this.add.image(8 + i * 10, 22, 'heart').setOrigin(0, 0).setDepth(10));
    const back = this.add.graphics().setDepth(1);
    const g = this.add.graphics().setDepth(5);
    const fx = this.add.graphics().setDepth(9);
    const keeper = this.add.sprite(CX, GY1, 'keeper-stand').setOrigin(0.5, 1).setDepth(4).setScale(2);
    const shooter = this.add.sprite(CX, SHOOTER_Y, 'shooter-aim').setOrigin(0.5, 1).setDepth(3);
    const ball = this.add.image(BALL_X, BALL_Y, 'ball').setDepth(6);
    const bannerBox = this.add.graphics().setDepth(11);
    const bannerText = drawText(this, W / 2, 62, '', { scale: 2, color: 'amber', align: 'center', depth: 12 });
    const bannerSubText = drawText(this, W / 2, 80, '', { color: 'foam', align: 'center', depth: 12 });
    const count = drawText(this, W / 2, 62, '', { scale: 2, color: 'lime', align: 'center', depth: 12 });
    const pop = drawText(this, W / 2, GY1 + 5, '', { color: 'lime', align: 'center', depth: 10 });
    const info = drawText(this, W / 2, 161, '', { color: 'foam', align: 'center', depth: 10 });
    const keys = drawText(this, W / 2, H - 8, '', { color: 'dim', align: 'center', depth: 10 });
    const labels = Array.from({ length: n }, (_, s) => drawText(this, GX0 - 7, Math.round(bandY(s)) - 3, stringLabel(instId, s), { color: stringKey(s), align: 'right', depth: 3 }));
    const badge = [drawText(this, 0, 0, '1', { color: 'foam', align: 'center', depth: 8 }), drawText(this, 0, 0, '2', { color: 'foam', align: 'center', depth: 8 })];
    badge.forEach((b) => b.setVisible(false));
    const showKeys = () => placeText(keys, W / 2, H - 8, `${timed ? `M metrónomo: ${session.metronome.isMuted ? 'no' : 'sí'}   ` : ''}Esc salir`, { color: 'dim', align: 'center' });
    this.input.keyboard?.on('keydown-M', () => {
      if (!timed) return;
      session.metronome.setMuted(!session.metronome.isMuted);
      void store.setSettings({ metronomeOn: !session.metronome.isMuted });
      showKeys();
    });

    const showHud = () => {
      placeText(scoreText, W / 2 + 22, 6, String(run.score), { scale: 2, color: 'foam', align: 'center' });
      const m = run.multiplier;
      placeText(comboText, W / 2 + 22, 24, `RACHA ${run.combo}  ·  x${m}`, { color: m >= 4 ? 'lime' : m >= 2 ? 'cyan' : 'dim', align: 'center' });
      placeText(tempoText, W - 8, 6, `NIVEL ${level}  ·  ${timed ? `${run.pace} BPM` : `${run.pace.toFixed(1)} S`}`, { color: 'foam', align: 'right' });
      placeText(roundText, W - 8, 16, `RONDA ${run.round}/${ROUNDS}`, { color: 'dim', align: 'right' });
      hearts.forEach((h, i) => h.setTexture(i < run.hearts ? 'heart' : 'heart-empty'));
    };

    // ---- rounds ----
    const wire = (s: GameSession, first: boolean) => {
      const ex = s.exercise;
      const pos = targetPositions(ex);
      strings = pos.map((p) => p.string);
      groups = planShots(strings, ex.timed ? ex.targets.map((t) => t.beat) : undefined);
      shots = ex.targets.map((t, i) => {
        const group = groups.find((gr) => gr.indices.includes(i))!;
        const role = group.indices.length === 1 ? 'single' : group.indices[0] === i ? 'first' : 'second';
        const side = i % 2 ? 1 : -1;
        const bx = Math.round(CX + side * (22 + ((i * 37) % 34)));
        return { index: i, string: pos[i].string, fret: pos[i].fret, midi: t.kind.type === 'note' ? t.kind.midi : 0, bx, by: Math.round(bandY(pos[i].string)), beat: t.beat ?? 0, role, state: 'live', doneAt: -1e9, from: { x: BALL_X, y: BALL_Y } };
      });
      startAt = [];
      deadlineAt = [];
      offs.forEach((f) => f());
      offs = [
        s.on('countIn', (b) => placeText(count, W / 2, 62, `PREPARADOS  ${b}`, { scale: 2, color: b === s.clock.countInBeats ? 'lime' : 'foam', align: 'center' })),
        s.on('go', () => placeText(count, W / 2, 62, 'YA', { scale: 2, color: 'lime', align: 'center' })),
        s.on('stray', () => strays++),
        s.on('wrongAttempt', (r) => onWrongAttempt(s, r)),
        s.on('targetResolved', (r) => onResolved(s, r)),
        s.on('finished', (_summary, results) => onFinished(s, results)),
      ];
      if (!first) offs.push(trackEnergy(this, s));
      hooks.fake = s.input instanceof FakeInput ? makeFakeControl(s, s.input) : null;
      placeText(count, W / 2, 62, '', { scale: 2, color: 'lime', align: 'center' });
      count.setAlpha(1);
      roundStartClock = s.clock.now();
      showHud();
      showKeys();
    };

    const posOnDive = (x: number, y: number, wrong: boolean) => {
      dive = { x, y, flip: x < CX, at: this.time.now, wrong };
    };

    const onWrongAttempt = (s: GameSession, r: ScoredTarget) => {
      if (s !== session || ended || pending === 'fail') return;
      run.wrongString();
      const shot = shots[r.index];
      const heard = r.heard?.length ? locateHeard(instId, level, r.heard[0]) : null;
      const hs = heard ? heard.string : (shot.string + 2) % n;
      posOnDive(shot.bx, Math.round(bandY(hs)), true);
      placeText(pop, W / 2, GY1 + 5, 'CUERDA EQUIVOCADA', { color: 'violet', align: 'center' });
      popAt = this.time.now;
      showHud();
    };

    const onResolved = (s: GameSession, r: ScoredTarget) => {
      if (s !== session || ended || pending === 'fail') return;
      const shot = shots[r.index];
      const now = s.clock.now();
      const left = timed ? 0 : timeLeft(now, startAt[r.index] ?? now, deadlineAt[r.index] ?? now);
      const res = timed ? run.resolve(r.judgement) : run.resolve(r.judgement === 'hit' ? 'hit' : 'miss', { wrongAttempts: r.wrongAttempts, timeLeft: left });
      attempted.push(r);
      hooks.judged.push({ index: r.index, judgement: r.judgement, deltaMs: Math.round(r.delta * 1000) });
      shot.state = res.outcome;
      shot.doneAt = this.time.now;
      shot.from = ballPos(shot, s.beat(), now);
      let bonus = 0;
      if (shot.role === 'second' && res.outcome === 'clean' && shots[r.index - 1].state === 'clean') bonus = run.doubleBonus();
      if (res.outcome === 'goal') {
        if (r.judgement === 'wrong' && r.heard?.length) {
          const h = locateHeard(instId, level, r.heard[0]);
          if (h) posOnDive(shot.bx, Math.round(bandY(h.string)), true);
        }
        netPulse = { x: shot.bx, y: shot.by, at: this.time.now };
        this.cameras.main.flash(90, 255, 63, 180, false);
      } else posOnDive(shot.bx, shot.by, false);
      const label = res.outcome === 'clean' ? 'PARADÓN' : res.outcome === 'fumbled' ? (r.judgement === 'early' ? 'PRONTO' : r.judgement === 'late' ? 'TARDE' : 'PARADA SUCIA') : r.judgement === 'wrong' ? 'CUERDA EQUIVOCADA' : 'GOL';
      const color: PaletteKey = res.outcome === 'clean' ? 'lime' : res.outcome === 'fumbled' ? 'amber' : 'magenta';
      const pts = res.points + bonus;
      placeText(pop, W / 2, GY1 + 5, pts ? `${label}  +${pts}${bonus ? '  DOBLE' : ''}` : label, { color, align: 'center' });
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
      placeText(count, W / 2, 62, 'FIN', { scale: 2, color: 'cyan', align: 'center' });
      const pool = completed.length ? completed : attempted;
      const summary = summarize(pool, Math.max(1, pool.length), timed, strays);
      const open = (previousBest: number, newBest: boolean) => {
        if (!this.scene.isActive()) return;
        showResults(this, { params: data.params, mode: data.mode, level, skill: data.skill, summary, arcade: { score: run.score, bestCombo: run.bestCombo, previousBest, newBest } });
      };
      saveArcadeBest(store, instId, def.id, level, { score: run.score, bestCombo: run.bestCombo }).then(
        (b) => open(b.previousBest, b.newBest),
        () => open(0, false),
      );
    };

    const switchRound = () => {
      const plan = run.plan();
      session.release();
      if (session.input instanceof FakeInput) session.input.clearPending();
      session = session.spawn(exerciseFor(plan), { countInBeats: plan.countInBeats });
      wire(session, false);
      session.start();
      roundStartClock = session.clock.now();
      dive = null;
      netPulse = null;
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
        bannerSub = timed ? `TEMPO ${fail.pace} BPM  ↓` : `${fail.pace.toFixed(1)} S POR TIRO  ↑`;
        bannerColor = 'amber';
      } else {
        banner = `RONDA ${run.round}`;
        bannerSub = timed ? `TEMPO ${run.pace} BPM` : `${run.pace.toFixed(1)} S POR TIRO`;
        bannerColor = 'cyan';
      }
      switchRound();
    };

    // ---- ball and drawing ----
    /** Where the ball is for a live shot (shooter spot while aiming, then toward its target). */
    const ballPos = (shot: Shot, beat: number, now: number): { x: number; y: number } => {
      let flight = 0;
      if (shot.state !== 'live') return shot.from;
      if (timed) flight = timedPhase(beat, shot.beat).flight;
      else if (startAt[shot.index] !== undefined) {
        const limit = deadlineAt[shot.index] - startAt[shot.index];
        const fl = Math.min(1.2, 0.35 * limit);
        flight = Math.min(1, Math.max(0, (now - (deadlineAt[shot.index] - fl)) / fl));
      }
      return { x: Math.round(BALL_X + (shot.bx - BALL_X) * flight), y: Math.round(BALL_Y + (shot.by - BALL_Y) * flight - Math.sin(flight * Math.PI) * 6) };
    };

    const liveShots = (beat: number, now: number, cur: number): Shot[] => {
      if (timed) return shots.filter((s) => s.state === 'live' && timedPhase(beat, s.beat).visible);
      const group = groups.find((gr) => gr.indices.includes(cur));
      if (!group || now < (startAt[group.indices[0]] ?? Infinity)) return [];
      return group.indices.map((i) => shots[i]).filter((s) => s.state === 'live');
    };

    const redraw = () => {
      step();
      if (ended) {
        // keep drawing the final frame
      }
      const beat = session.beat();
      const now = session.clock.now();
      const cur = Math.min(shots.length - 1, Math.max(0, session.currentIndex));
      const wall = this.time.now;

      // Untimed: activate the waiting shot and close it when its time is over.
      if (!timed && !ended && !pending && session.clock.state === 'running' && !session.finished) {
        const group = groups.find((gr) => gr.indices.includes(cur))!;
        if (startAt[cur] === undefined) {
          const t0 = Math.max(now, cur === 0 ? roundStartClock + ROUND_GRACE : -Infinity);
          startAt[cur] = t0;
          deadlineAt[cur] = t0 + shotLimit(run.pace, run.speed, shots[cur].role);
          void group;
        }
        if (now >= deadlineAt[cur]) session.skipCurrent();
      }

      back.clear();
      g.clear();
      fx.clear();
      // Pitch and goal.
      back.fillStyle(paletteInt('water'), 0.5).fillRect(0, GY1 + 1, W, H - GY1);
      back.fillStyle(paletteInt('dim'), 0.8).fillRect(0, GY1, W, 1);
      back.fillStyle(paletteInt('amber'), 1).fillRect(BALL_X - 1, BALL_Y + 6, 3, 1);
      back.fillStyle(paletteInt('abyss'), 0.55).fillRect(GX0, GY0, GX1 - GX0, GY1 - GY0);
      const live = liveShots(beat, now, cur);
      const hot = new Set(live.map((s) => s.string));
      for (let s = 0; s < n; s++) {
        const y0 = GY1 - (s + 1) * bandH;
        const key = stringKey(s);
        back.fillStyle(paletteInt(key), hot.has(s) ? 0.5 + 0.2 * Math.sin(wall / 120) : 0.2).fillRect(GX0, y0, GX1 - GX0, bandH);
        back.fillStyle(paletteInt(key), 1).fillRect(GX0, y0, 3, bandH).fillRect(GX1 - 3, y0, 3, bandH);
        back.fillStyle(paletteInt('abyss'), 0.7).fillRect(GX0, y0, GX1 - GX0, 1);
        labels[s].setAlpha(hot.has(s) ? 1 : 0.7);
      }
      for (let x = GX0 + 6; x < GX1 - 3; x += 8) back.fillStyle(paletteInt('foam'), 0.08).fillRect(x, GY0, 1, GY1 - GY0);
      back.fillStyle(paletteInt('foam'), 1).fillRect(GX0 - 2, GY0 - 2, GX1 - GX0 + 4, 2).fillRect(GX0 - 2, GY0 - 2, 2, GY1 - GY0 + 2).fillRect(GX1, GY0 - 2, 2, GY1 - GY0 + 2);

      // Markers: ring toward the arrival of each live shot.
      live.forEach((s, k) => {
        let left: number;
        if (timed) left = timedPhase(beat, s.beat).ring;
        else left = startAt[s.index] === undefined ? 1 : timeLeft(now, startAt[s.index], deadlineAt[s.index]);
        const r = ringRadius(left);
        const key = stringKey(s.string);
        const urgent = left < 0.25 && Math.floor(wall / 90) % 2 === 0;
        ring(g, s.bx, s.by, r, urgent ? 'foam' : key, 1);
        if (r > 6) ring(g, s.bx, s.by, r - 1, key, 0.5);
        ring(g, s.bx, s.by, 3, 'foam', 1);
        g.fillStyle(paletteInt('foam'), 1).fillRect(s.bx, s.by, 1, 1);
        if (live.length > 1 || s.role !== 'single') {
          const b = badge[s.role === 'second' ? 1 : 0];
          b.setVisible(true);
          placeText(b, s.bx, s.by - 14, s.role === 'second' ? '2' : '1', { color: 'foam', align: 'center' });
        }
        void k;
      });
      badge.forEach((b, i) => {
        if (!live.some((s) => (i === 1) === (s.role === 'second') && (live.length > 1 || s.role !== 'single'))) b.setVisible(false);
      });
      // A double shot shows its skip: an arc between the two markers.
      const g0 = live.length ? groups.find((gr) => gr.indices.includes([...live].sort((x, y) => x.index - y.index)[0].index)) : undefined;
      const pair = g0 && g0.indices.length === 2 ? g0.indices.map((i) => shots[i]).filter((x) => x.state === 'live' && live.includes(x)) : [];
      if (pair.length === 2) for (const p of arcPoints(pair[0].bx, pair[0].by, pair[1].bx, pair[1].by, 8)) g.fillStyle(paletteInt('foam'), 0.9).fillRect(p.x, p.y, 2, 2);

      // Ball: the live shot nearest to arrival, or the one of the last verdict.
      let shown: { x: number; y: number } | null = null;
      let ballAlpha = 1;
      const nearest = [...live].sort((a, b) => (timed ? a.beat - b.beat : a.index - b.index))[0];
      const recent = shots.filter((s) => s.state !== 'live' && wall - s.doneAt < 1000).sort((a, b) => b.doneAt - a.doneAt)[0];
      if (recent) {
        const age = wall - recent.doneAt;
        const t = Math.min(1, age / 180);
        const x = recent.from.x + (recent.bx - recent.from.x) * t;
        const y = recent.from.y + (recent.by - recent.from.y) * t;
        if (recent.state === 'clean') {
          shown = { x, y };
          if (age > 180) {
            ring(fx, recent.bx, recent.by, 4 + Math.floor((age - 180) / 40), 'lime', Math.max(0, 1 - (age - 180) / 400));
            ballAlpha = Math.max(0, 1 - (age - 180) / 350);
          }
        } else if (recent.state === 'fumbled') {
          const u = Math.max(0, (age - 180) / 450);
          shown = { x: x + Math.sign(recent.bx - CX || 1) * 26 * u, y: y - 20 * u + 30 * u * u };
          ballAlpha = Math.max(0, 1 - Math.max(0, u - 0.6) / 0.4);
        } else {
          shown = { x, y };
          ballAlpha = age < 800 ? 1 : Math.max(0, 1 - (age - 800) / 200);
        }
      } else if (nearest && (timed ? timedPhase(beat, nearest.beat).flight > 0 || timedPhase(beat, nearest.beat).visible : true)) {
        shown = ballPos(nearest, beat, now);
      }
      ball.setVisible(!!shown).setAlpha(ballAlpha);
      if (shown) ball.setPosition(Math.round(shown.x), Math.round(shown.y));
      // Net bulge on a goal.
      if (netPulse && wall - netPulse.at < 600) {
        const a = 1 - (wall - netPulse.at) / 600;
        const rr = 5 + Math.floor((wall - netPulse.at) / 40);
        ring(fx, netPulse.x, netPulse.y, rr, 'magenta', a);
        ring(fx, netPulse.x, netPulse.y, rr - 3, 'foam', a * 0.7);
      }

      // Shooter pose.
      const kicking = nearest && (timed ? (() => { const f = timedPhase(beat, nearest.beat).flight; return f > 0 && f < 0.4; })() : (() => { const p = ballPos(nearest, beat, now); return p.y < BALL_Y - 1 && p.y > BALL_Y - 12; })());
      shooter.setTexture(kicking ? 'shooter-kick' : 'shooter-aim');
      // Keeper: stands in the middle; dives (toward the ball, or the wrong band) for a moment.
      if (dive && wall - dive.at < ANIM_MS) {
        const u = Math.min(1, (wall - dive.at) / 160);
        keeper.setTexture('keeper-dive').setFlipX(dive.flip).setOrigin(0.5, 0.5);
        keeper.setPosition(Math.round(CX + (dive.x - CX) * u), Math.round(GY1 - 16 + (dive.y - (GY1 - 16)) * u));
        keeper.setTint(dive.wrong ? paletteInt('violet') : 0xffffff);
      } else {
        keeper.setTexture('keeper-stand').setFlipX(false).setOrigin(0.5, 1).setPosition(CX, GY1).clearTint();
      }

      // Texts: banner during the count-in/grace, verdict pop-up for a moment, what to play.
      const inCount = !ended && (timed ? beat < 0 : now < roundStartClock + ROUND_GRACE);
      bannerBox.clear();
      if (inCount && banner) bannerBox.fillStyle(paletteInt('abyss'), 0.85).fillRect(6, 56, W - 12, 36).lineStyle(1, paletteInt(bannerColor), 1).strokeRect(6.5, 56.5, W - 13, 35);
      placeText(bannerText, W / 2, 62, inCount ? banner : '', { scale: 2, color: bannerColor, align: 'center' });
      placeText(bannerSubText, W / 2, 80, inCount ? bannerSub : '', { color: 'foam', align: 'center' });
      if (!timed) count.setAlpha(0);
      else if (!ended && beat >= 1.5) count.setAlpha(0);
      const age = wall - popAt;
      pop.setAlpha(age < 800 ? 1 : age < 1100 ? 1 - (age - 800) / 300 : 0);
      if (!ended && live.length) {
        const first = live.sort((a, b) => a.index - b.index).slice(0, 2);
        const parts = first.map((s) => `${stringLabel(instId, s.string)} ${fretWords(s.fret)}`);
        placeText(info, W / 2, 161, `Toca: ${parts.join('  luego  ')}`, { color: stringKey(first[0].string), align: 'center' });
      } else placeText(info, W / 2, 161, '', { color: 'dim', align: 'center' });

      hooks.portero = {
        round: run.round,
        rounds: ROUNDS,
        attempt: run.attempt,
        restarts: run.restarts,
        pace: run.pace,
        timed,
        hearts: run.hearts,
        score: run.score,
        combo: run.combo,
        bestCombo: run.bestCombo,
        multiplier: run.multiplier,
        banner: inCount ? banner : '',
        strings,
        midis: shots.map((s) => s.midi),
        shot: cur,
        deadline: deadlineAt[cur] ?? -1,
        group: (groups.find((gr) => gr.indices.includes(cur))?.indices ?? []).slice(),
        bands: n,
        over: ended,
      };
    };
    this.events.on(Phaser.Scenes.Events.UPDATE, redraw);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.UPDATE, redraw);
      offs.forEach((f) => f());
      session.dispose();
      hooks.portero = null;
    });

    hooks.judged = [];
    wire(session, true);
    banner = 'RONDA 1';
    bannerSub = timed ? `TEMPO ${run.pace} BPM` : `${run.pace.toFixed(1)} S POR TIRO`;
    bannerColor = 'cyan';
    beginGame(this, data, { manual: true });
    roundStartClock = session.clock.now();
  }
}
