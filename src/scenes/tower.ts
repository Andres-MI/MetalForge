import Phaser from 'phaser';
import { drawText, placeText } from '../art/text';
import { measureText } from '../art/font';
import { addBackground, enterScene, H, profileStore, W } from '../engine/kit';
import { hooks } from '../engine/hooks';
import { generate, levelLabel, scalesZone } from '../exercises';
import { makeFakeControl } from '../game/fakePlayer';
import { directionHint } from '../game/frets/board';
import { hearNote } from '../game/hearNote';
import { FakeInput } from '../game/input';
import { saveArcadeBest } from '../game/progressBlob';
import { GAMES } from '../game/registry';
import { beginGame, showResults, trackEnergy } from '../game/scene';
import { backingPlan, playBuffer, renderBacking } from '../game/scales/backing';
import { improvisation } from '../game/scales/board';
import { isRoot, scaleInfo, targetMidis, type ScaleInfo } from '../game/scales/info';
import type { GameSession } from '../game/session';
import { stringNumber } from '../game/strings';
import { BOSS_BARS, BossFight, bossHealth } from '../game/tower/boss';
import { baseTimedBpm, baseWaterSpeed } from '../game/tower/pace';
import { FLOORS, MAX_GAP, MAX_HEARTS, TowerRun, type CatchResult } from '../game/tower/state';
import type { GameSceneData } from '../game/types';
import { panel } from '../game/ui';
import type { Exercise } from '../model/exercise';
import { INSTRUMENTS, noteName, type FretPos } from '../model/instrument';
import { summarize } from '../scoring/summary';
import type { ScoredTarget } from '../scoring/types';
import { paletteInt, type PaletteKey } from '../ui/palette';
import { cross, diamond, pip, ring, setTextColor, stringKey } from './scalesDraw';

const SEED_STEP = 7919;
const BOSS_BPM = 80;
const BANNER_MS = 2200;
/** The tower panel (left) and the side column (right). */
const PANEL = { x: 48, y: 34, w: 104, h: 116 };
const SIDE = { x: 160, w: 152 };
const HERO_FEET = 118;
const DY = 24;
const WATER_PX = 13;
const TOWER_X = 100;
const SLAB_W = 34;
const JUMP_MS = 200;

interface Pop {
  /** A new pop with the same tag replaces the old one (the last points are what counts). */
  tag?: string;
  text: string;
  x: number;
  y: number;
  color: PaletteKey;
  born: number;
}

interface Shot {
  from: { x: number; y: number };
  to: { x: number; y: number };
  born: number;
  color: PaletteKey;
}

interface Mini {
  lo: number;
  hi: number;
  colW: number;
  x0: number;
  y0: number;
  gap: number;
  strings: number[];
  nums: Map<number, Phaser.GameObjects.BitmapText>;
  g: Phaser.GameObjects.Graphics;
  xOf(fret: number): number;
  yOf(string: number): number;
  destroy(): void;
}

/**
 * Torre: the ARCADE practice game for scales. A tower of platforms: every right note of the scale, in order, makes the
 * hero jump to the next platform (the platform carries the fret number and the colour of the string; a mini fretboard
 * at the side shows the same target). Water rises from below (the arcade's own time pressure over the untimed Judge).
 * After floors 1 and 2 comes a guardian room: improvise on the scale over a backing vamp; every scale note hurts the
 * guardian, repeating one note hurts less and less, notes outside the scale heal it. Rules: src/game/tower/.
 * Level 10 is timed: the jumps happen on the beat (clean / clumsy / fall, like Salto).
 */
export class TowerScene extends Phaser.Scene {
  constructor() {
    super('tower');
  }

  create(data0: GameSceneData): void {
    enterScene(this, 'tower');
    addBackground(this);
    const store = profileStore(this);
    const def = GAMES[data0.params.gameId];
    const baseSeed = data0.params.seed ?? 1;
    const instId = data0.exercise.instrument;
    const inst = INSTRUMENTS[instId];
    const level = data0.level;
    const timed = data0.exercise.timed;
    const basePace = timed ? baseTimedBpm(data0.exercise.bpm ?? 80, instId) : baseWaterSpeed(level, instId);
    const run = new TowerRun(timed, basePace);

    const seedOf = (floor: number) => baseSeed + (floor - 1) * SEED_STEP;
    const exerciseOf = (floor: number): Exercise => {
      const base = floor === 1 ? data0.exercise : generate(data0.skill, { instrument: instId, level, seed: seedOf(floor), length: def.length });
      return timed ? { ...base, bpm: Math.round(run.pace) } : base;
    };

    let session: GameSession = data0.session;
    let phase: 'climb' | 'boss' = 'climb';
    let offs: (() => void)[] = [];
    let pending: 'next' | 'fail' | 'boss' | 'bossEnd' | null = null;
    let ended = false;
    let ex: Exercise = data0.exercise;
    let info: ScaleInfo = scaleInfo(ex);
    let midis: number[] = [];
    let zone: { pos: FretPos; midi: number }[] = [];
    let mini!: Mini;
    let boss: BossFight | null = null;
    let backing: { stop(): void } | null = null;
    let bossFloor = 1;
    let bossesDefeated = 0;
    let floorsDone = 0;
    let lastBoss: { damage: number; repeat: number } = { damage: 0, repeat: 0 };
    let banner = '';
    let bannerSub = '';
    let bannerColor: PaletteKey = 'cyan';
    let bannerUntil = 0;
    let skipping = 0;
    let pendingAt = 0;
    let bossPops = 0;
    let guardHealAt = -1e9;
    const resolved = new Set<number>();
    let heroPlat = 0;
    let heroFrom = 0;
    let camPlat = 0;
    let jumpAt = -1e9;
    let fallAt = -1e9;
    let hurtAt = -1e9;
    let guardHurtAt = -1e9;
    let guardDownAt = -1e9;
    let wrong: { midi: number; name: string; hint: string; pos: FretPos | null; at: number } | null = null;
    let lastPose = '';
    const queue = (kind: NonNullable<typeof pending>, delay = 0) => {
      pending = kind;
      pendingAt = this.time.now + delay;
    };
    const pops: Pop[] = [];
    const shots: Shot[] = [];
    const strayMarks: { pos: FretPos; at: number }[] = [];
    const litBoss = new Set<number>();
    const completed: ScoredTarget[] = [];
    const attempted: ScoredTarget[] = [];

    const now = () => session.input.now();
    const total = () => midis.length;
    const targetAt = (i: number) => {
      const k = ex.targets[Math.min(i, ex.targets.length - 1)].kind;
      if (k.type !== 'note' || !k.pos) throw new Error('Torre needs note targets with a position');
      return { pos: k.pos, midi: k.midi };
    };

    // ---- static layout ----
    drawText(this, 8, 6, 'TORRE', { scale: 2, color: def.accent, depth: 10 });
    const scoreText = drawText(this, W / 2, 8, '0', { scale: 2, color: 'foam', align: 'center', depth: 10 });
    const comboText = drawText(this, W / 2, 26, '', { color: 'dim', align: 'center', depth: 10 });
    drawText(this, W - 8, 8, timed ? `NIVEL ${level}  ·  ${Math.round(basePace)} BPM` : `NIVEL ${level}`, { color: 'foam', align: 'right', depth: 10 });
    const floorText = drawText(this, W - 8, 18, '', { color: 'dim', align: 'right', depth: 10 });
    const hearts = Array.from({ length: MAX_HEARTS }, (_, i) => this.add.image(8 + i * 10, 24, 'heart').setOrigin(0, 0).setDepth(10));
    const noteText = drawText(this, SIDE.x + SIDE.w / 2, 114, '', { scale: 2, color: 'foam', align: 'center', depth: 10 });
    const noteSub = drawText(this, SIDE.x + SIDE.w / 2, 132, '', { color: 'foam', align: 'center', depth: 10 });
    const hintText = drawText(this, SIDE.x + SIDE.w / 2, 144, '', { color: 'amber', align: 'center', depth: 10 });
    const sub = drawText(this, W / 2, 161, '', { color: 'dim', align: 'center', depth: 10 });
    const keys = drawText(this, W / 2, H - 9, '', { color: 'dim', align: 'center', depth: 10 });
    const bannerBack = this.add.graphics().setDepth(19);
    const bannerText = drawText(this, W / 2, 74, '', { scale: 2, color: 'cyan', align: 'center', depth: 20 });
    const bannerSubText = drawText(this, W / 2, 94, '', { color: 'foam', align: 'center', depth: 20 });
    const popShadows = [0, 1, 2, 3].map(() => drawText(this, 0, 0, '', { color: 'abyss', align: 'center', depth: 11 }));
    const popTexts = [0, 1, 2, 3].map(() => drawText(this, 0, 0, '', { color: 'lime', align: 'center', depth: 12 }));
    const platTexts = Array.from({ length: 8 }, () => drawText(this, 0, 0, '', { color: 'abyss', align: 'center', depth: 8 }));
    const bossLabel = drawText(this, PANEL.x + PANEL.w / 2, PANEL.y + 4, 'GUARDIÁN', { color: 'magenta', align: 'center', depth: 10 });
    const barLabel = drawText(this, PANEL.x + PANEL.w / 2, PANEL.y + PANEL.h + 4, '', { color: 'dim', align: 'center', depth: 10 });
    const back = this.add.graphics().setDepth(1);
    const g = this.add.graphics().setDepth(6);
    const fx = this.add.graphics().setDepth(11);
    const hero = this.add.sprite(0, 0, 'hero-idle').setOrigin(0.5, 1).setDepth(9);
    hero.play('hero-idle');
    const guardian = this.add.sprite(PANEL.x + PANEL.w / 2, PANEL.y + 74, 'guardian').setOrigin(0.5, 0.5).setDepth(8).setScale(3).setVisible(false);
    guardian.play('guardian');

    const buildMini = (zn: { pos: FretPos; midi: number }[]): Mini => {
      const frets = zn.map((n) => n.pos.fret);
      const lo = Math.min(...frets);
      const hi = Math.max(...frets);
      const cols = hi - lo + 1;
      const colW = Math.min(24, Math.floor((SIDE.w - 4) / cols));
      const w = cols * colW;
      const strs = [...new Set(zn.map((n) => n.pos.string))].sort((a, b) => b - a);
      const gap = strs.length >= 6 ? 9 : strs.length === 5 ? 11 : 13;
      const x0 = SIDE.x + Math.round((SIDE.w - w) / 2);
      const y0 = PANEL.y + 6;
      const gm = this.add.graphics().setDepth(2);
      const h = (strs.length - 1) * gap + 10;
      panel(gm, x0 - 3, y0 - 3, w + 6, h + 6, 'water', 'deep', 0.9);
      const xOf = (f: number) => x0 + (f - lo) * colW + Math.floor(colW / 2);
      const yOf = (s: number) => y0 + 5 + strs.indexOf(s) * gap;
      for (let c = 1; c < cols; c++) gm.fillStyle(paletteInt(lo === 0 && c === 1 ? 'foam' : 'dim'), lo === 0 && c === 1 ? 1 : 0.7).fillRect(x0 + c * colW, y0 - 2, lo === 0 && c === 1 ? 2 : 1, h + 4);
      for (const s of strs) gm.fillStyle(paletteInt(stringKey(s)), 0.9).fillRect(x0, yOf(s), w, 1);
      const nums = new Map<number, Phaser.GameObjects.BitmapText>();
      for (let f = lo; f <= hi; f++) nums.set(f, drawText(this, xOf(f), y0 + h + 6, String(f), { color: 'foam', align: 'center', depth: 5 }));
      return {
        lo, hi, colW, x0, y0, gap, strings: strs, nums, g: gm, xOf, yOf,
        destroy() {
          gm.destroy();
          nums.forEach((t) => t.destroy());
        },
      };
    };

    const showHud = () => {
      placeText(scoreText, W / 2, 8, String(run.score), { scale: 2, color: 'foam', align: 'center' });
      const m = run.multiplier;
      placeText(comboText, W / 2, 26, `RACHA ${run.combo}  ·  x${m}`, { color: m >= 4 ? 'lime' : m >= 2 ? 'cyan' : 'foam', align: 'center' });
      placeText(floorText, W - 8, 18, phase === 'boss' ? 'SALA DEL GUARDIÁN' : `PISO ${run.floor}/${FLOORS}`, { color: phase === 'boss' ? 'magenta' : 'dim', align: 'right' });
      hearts.forEach((h, i) => h.setTexture(i < run.hearts ? 'heart' : 'heart-empty'));
    };
    const pop = (text: string, x: number, y: number, color: PaletteKey, tag?: string) => {
      if (tag) {
        const k = pops.findIndex((p) => p.tag === tag);
        if (k >= 0) pops.splice(k, 1);
      }
      pops.push({ tag, text, x, y, color, born: this.time.now });
      if (pops.length > popTexts.length) pops.shift();
    };
    const heroXY = (plat: number) => ({ x: TOWER_X + (plat % 2 ? 16 : -16) * (plat === 0 ? 0 : 1), y: HERO_FEET + (camPlat - plat) * DY });

    // ---- sessions ----
    const wire = (s: GameSession) => {
      offs.forEach((f) => f());
      offs = [
        s.on('wrongAttempt', (r) => onWrong(s, r)),
        s.on('targetResolved', (r) => onResolved(s, r)),
        s.on('finished', (_sum, results) => onFinished(s, results)),
        trackEnergy(this, s),
      ];
      hooks.fake = s.input instanceof FakeInput ? makeFakeControl(s, s.input) : null;
    };

    const bannerOn = (text: string, subText: string, color: PaletteKey) => {
      banner = text;
      bannerSub = subText;
      bannerColor = color;
      bannerUntil = this.time.now + BANNER_MS;
    };

    const startFloor = (floor: number, spawnNew: boolean) => {
      phase = 'climb';
      if (spawnNew) {
        session.release();
        if (session.input instanceof FakeInput) session.input.clearPending();
      }
      ex = exerciseOf(floor);
      info = scaleInfo(ex);
      midis = targetMidis(ex);
      zone = scalesZone(instId, level, seedOf(floor));
      mini?.destroy();
      mini = buildMini(zone);
      const settings = store.profile.settings;
      if (spawnNew) session = session.spawn(ex, { metronome: { on: settings.metronomeOn ?? true, volume: settings.metronomeVolume ?? 0.6 } });
      resolved.clear();
      run.startFloor(midis, now());
      if (!timed) session.metronome.setMuted(true);
      heroPlat = 0;
      heroFrom = 0;
      camPlat = 0;
      skipping = 0;
      wrong = null;
      boss = null;
      guardian.setVisible(false);
      pops.length = 0;
      shots.length = 0;
      wire(session);
      if (spawnNew) session.start();
      placeText(keys, W / 2, H - 9, timed ? 'H oír nota   M metrónomo   Esc salir' : 'H oír la nota   Esc salir', { color: 'dim', align: 'center' });
      showHud();
    };

    const startBoss = () => {
      phase = 'boss';
      bossFloor = run.floor - 1;
      session.release();
      if (session.input instanceof FakeInput) session.input.clearPending();
      const free = improvisation(generate(data0.skill, { instrument: instId, level, seed: seedOf(bossFloor), free: true, length: 96 }), BOSS_BPM);
      const settings = store.profile.settings;
      session = session.spawn(free, { metronome: { on: settings.metronomeOn ?? true, volume: 0.3 }, mastery: undefined });
      boss = new BossFight(bossHealth(level, bossFloor), BOSS_BARS);
      litBoss.clear();
      wrong = null;
      lastBoss = { damage: 0, repeat: 0 };
      guardian.setVisible(true).clearTint();
      guardian.play('guardian');
      pops.length = 0;
      shots.length = 0;
      wire(session);
      session.start();
      const ctx = session.input.context;
      if (ctx) {
        try {
          backing = playBuffer(ctx, renderBacking(backingPlan(info.rootPc, BOSS_BPM, BOSS_BARS), ctx.sampleRate), session.clock.beat0Time, 0.5);
        } catch {
          backing = null;
        }
      }
      placeText(keys, W / 2, H - 9, 'Improvisa con las notas de la escala   Esc salir', { color: 'dim', align: 'center' });
      bannerOn('SALA DEL GUARDIÁN', 'Improvisa: mueve por toda la escala', 'magenta');
      showHud();
    };

    const finishRun = () => {
      if (ended) return;
      ended = true;
      session.release();
      backing?.stop();
      const pool = completed.length ? completed : attempted;
      const summary = summarize(pool, Math.max(1, pool.length), timed, 0);
      const open = (previousBest: number, newBest: boolean) => {
        if (!this.scene.isActive()) return;
        showResults(this, { params: data0.params, mode: data0.mode, level, skill: data0.skill, summary, arcade: { score: run.score, bestCombo: run.bestCombo, previousBest, newBest } });
      };
      saveArcadeBest(store, instId, def.id, level, { score: run.score, bestCombo: run.bestCombo }).then(
        (b) => open(b.previousBest, b.newBest),
        () => open(0, false),
      );
    };

    const step = () => {
      if (ended || !pending || this.time.now < pendingAt) return;
      const what = pending;
      pending = null;
      if (what === 'fail') {
        session.release();
        const f = run.failFloor();
        showHud();
        if (f.over) return finishRun();
        startFloor(run.floor, true);
        bannerOn('Otra vez, más despacio', timed ? `TEMPO ${Math.round(f.pace)} BPM` : `AGUA MÁS LENTA: ${f.pace.toFixed(2)} PLAT/S`, 'amber');
      } else if (what === 'boss') startBoss();
      else if (what === 'bossEnd') {
        const b = boss!;
        session.release();
        backing?.stop();
        backing = null;
        const bonus = b.bonus(bossFloor);
        if (bonus) run.addBossPoints(bonus);
        if (b.defeated) {
          bossesDefeated++;
          guardDownAt = this.time.now;
        }
        showHud();
        bannerOn(b.defeated ? '¡GUARDIÁN DERROTADO!' : 'El guardián resiste', b.defeated ? `BONIFICACIÓN +${bonus}` : 'Sigues subiendo', b.defeated ? 'lime' : 'amber');
        queue('next', BANNER_MS);
      } else {
        startFloor(run.floor, true);
        bannerOn(`PISO ${run.floor}`, timed ? `TEMPO ${Math.round(run.pace)} BPM` : `AGUA ${run.pace.toFixed(2)} PLAT/S`, 'cyan');
      }
    };

    // ---- events ----
    const onWrong = (s: GameSession, r: ScoredTarget) => {
      if (s !== session || ended || pending) return;
      const heard = r.heard?.[0];
      if (heard === undefined) return;
      if (phase === 'boss') {
        const healed = boss!.stray();
        lastBoss = { damage: 0, repeat: 0 };
        const where = playedPos(heard);
        if (where) strayMarks.push({ pos: where, at: this.time.now });
        if (strayMarks.length > 6) strayMarks.shift();
        pop(`+${healed} ${noteName(heard)}`, PANEL.x + 34, PANEL.y + 78, 'magenta');
        wrong = { midi: heard, name: noteName(heard), hint: 'Fuera de la escala', pos: null, at: this.time.now };
        guardHealAt = this.time.now;
        return;
      }
      if (!run.wrong(now())) return;
      const t = targetAt(r.index);
      wrong = { midi: heard, name: noteName(heard), hint: directionHint(heard, t.midi).text, pos: playedPos(heard), at: this.time.now };
      this.cameras.main.shake(90, 0.003);
      const h = heroXY(heroPlat);
      pop(run.combo > 0 ? 'RACHA ÷2' : 'FALLO', h.x, HERO_FEET - 22, 'amber', 'pts');
      showHud();
    };
    const playedPos = (midi: number): FretPos | null => {
      const best = zone.find((n) => n.midi === midi);
      if (best) return best.pos;
      for (const s of mini.strings) {
        const fret = midi - inst.openStrings[s];
        if (fret >= mini.lo && fret <= mini.hi) return { string: s, fret };
      }
      return null;
    };

    const onResolved = (s: GameSession, r: ScoredTarget) => {
      if (s !== session || ended || pending) return;
      if (phase === 'boss') {
        const midi = r.heard?.[0];
        if (midi === undefined || !boss) return;
        const h = boss.hit(midi);
        lastBoss = { damage: h.damage, repeat: h.repeat };
        run.addBossPoints(h.points);
        litBoss.add(midi);
        guardHurtAt = this.time.now;
        const zn = zone.find((n) => n.midi === midi);
        shots.push({ from: { x: PANEL.x + 40, y: PANEL.y + PANEL.h - 36 }, to: { x: PANEL.x + PANEL.w / 2, y: PANEL.y + 70 }, born: this.time.now, color: zn ? stringKey(zn.pos.string) : 'foam' });
        pop(h.repeat > 1 ? `-${h.damage} x${h.repeat}` : `-${h.damage}`, PANEL.x + PANEL.w / 2 + ((bossPops++ % 3) - 1) * 26, PANEL.y + 56, h.repeat > 2 ? 'amber' : 'lime', 'dmg');
        wrong = null;
        showHud();
        if (h.defeated) queue('bossEnd');
        return;
      }
      attempted.push(r);
      hooks.judged.push({ index: r.index, judgement: r.judgement, deltaMs: Math.round(r.delta * 1000) });
      const t = this.time.now;
      if (timed) {
        resolved.add(r.index);
        const res = run.resolveTimed(r.judgement, r.index, ex.targets[r.index].beat ?? 0);
        const hp = heroXY(heroPlat);
        if (res.outcome === 'clean' || res.outcome === 'clumsy') {
          heroFrom = heroPlat;
          heroPlat = r.index + 1;
          jumpAt = t;
          pop(`${res.outcome === 'clean' ? '' : 'TORPE '}+${res.points}`, heroXY(heroPlat).x, HERO_FEET - 22, res.outcome === 'clean' ? 'lime' : 'amber', 'pts');
        } else {
          fallAt = t;
          hurtAt = res.heartLost ? t : hurtAt;
          if (res.heartLost) {
            this.cameras.main.flash(120, 255, 63, 180, false);
            this.cameras.main.shake(140, 0.006);
          }
          pop(res.outcome === 'spared' ? 'SALVADO' : 'CAÍDA', hp.x, hp.y - 30, 'magenta');
          if (r.judgement === 'wrong' && r.heard?.length) wrong = { midi: r.heard[0], name: noteName(r.heard[0]), hint: directionHint(r.heard[0], targetAt(r.index).midi).text, pos: playedPos(r.heard[0]), at: t };
        }
        if (res.phaseBonus) pop(`${phaseWord(r.index)} LIMPIO +${res.phaseBonus}`, TOWER_X, PANEL.y + 22, 'cyan');
        showHud();
        if (res.roundFailed) queue('fail', 700);
        return;
      }
      if (skipping > 0) {
        skipping--;
        liftTo(r.index + 1);
        if (r.index + 1 < total()) run.next(r.index + 1, now());
        return;
      }
      if (r.judgement !== 'hit') return;
      const j = run.jump(now());
      if (!j) return;
      liftTo(r.index + 1);
      wrong = null;
      pop(`${j.kind === 'clean' ? '' : 'TORPE '}+${j.points}`, heroXY(heroPlat).x, HERO_FEET - 22, j.kind === 'clean' ? 'lime' : 'amber', 'pts');
      if (j.phaseBonus) pop(`${phaseWord(r.index)} LIMPIO +${j.phaseBonus}`, TOWER_X, PANEL.y + 22, 'cyan');
      if (r.index + 1 < total()) run.next(r.index + 1, now());
      showHud();
    };

    const phaseWord = (index: number) => {
      const p = run.phaseOf(index);
      return p === 1 ? 'DESCENSO' : 'ASCENSO';
    };

    const liftTo = (plat: number) => {
      heroFrom = heroPlat;
      heroPlat = plat;
      jumpAt = this.time.now;
    };

    const onFinished = (s: GameSession, results: ScoredTarget[]) => {
      if (s !== session || ended || pending) return;
      if (phase === 'boss') {
        queue('bossEnd');
        return;
      }
      completed.push(...results);
      const end = run.completeFloor();
      floorsDone++;
      showHud();
      if (end.over) finishRun();
      else queue('boss', 1300);
      if (end.heartGained) pop('+1 CORAZÓN', TOWER_X, PANEL.y + 34, 'lime');
      if (end.flawless) pop(`PISO PERFECTO +${end.bonus}`, TOWER_X, PANEL.y + 46, 'cyan');
    };

    const onCatch = (c: CatchResult) => {
      const t = this.time.now;
      hurtAt = t;
      this.cameras.main.flash(120, 255, 63, 180, false);
      this.cameras.main.shake(140, 0.006);
      const h = heroXY(heroPlat);
      pop('¡EL AGUA!', h.x, h.y - 30, 'magenta');
      showHud();
      if (c.roundFailed) {
        queue('fail', 700);
        return;
      }
      skipping++;
      session.skipCurrent();
    };

    // ---- input ----
    const kb = this.input.keyboard;
    kb?.on('keydown-H', () => {
      if (phase !== 'climb' || ended) return;
      const i = Math.min(total() - 1, timed ? timedCursor() : heroPlat);
      hearNote(targetAt(i).midi, session.input.context);
    });
    kb?.on('keydown-M', () => {
      if (!timed) return;
      session.metronome.setMuted(!session.metronome.isMuted);
      void store.setSettings({ metronomeOn: !session.metronome.isMuted });
    });

    // ---- drawing ----
    const slab = (x: number, y: number, key: PaletteKey, alpha: number, edge: PaletteKey | null) => {
      g.fillStyle(paletteInt('abyss'), alpha).fillRect(x - SLAB_W / 2 - 1, y, SLAB_W + 2, 11);
      g.fillStyle(paletteInt(key), alpha).fillRect(x - SLAB_W / 2, y + 1, SLAB_W, 8);
      g.fillStyle(paletteInt('abyss'), 0.35 * alpha).fillRect(x - SLAB_W / 2, y + 8, SLAB_W, 2);
      if (edge) g.lineStyle(1, paletteInt(edge), 1).strokeRect(x - SLAB_W / 2 - 1.5, y - 0.5, SLAB_W + 3, 12);
    };

    const drawMini = (t: number, cur: { pos: FretPos; midi: number } | null) => {
      const l = mini;
      mini.nums.forEach((n) => setTextColor(n, 'foam'));
      for (const n of zone) {
        const x = l.xOf(n.pos.fret);
        const y = l.yOf(n.pos.string);
        const root = isRoot(info, n.midi);
        const key = stringKey(n.pos.string);
        const lit = phase === 'boss' && litBoss.has(n.midi);
        pip(fx, x, y, key, lit ? 1 : root ? 0.6 : 0.4, root || lit);
        if (lit) fx.fillStyle(paletteInt('foam'), 0.95).fillRect(x - 1, y - 1, 3, 3);
        if (root) diamond(fx, x, y, 5, 'foam', lit ? 1 : 0.7);
      }
      if (cur) {
        const x = l.xOf(cur.pos.fret);
        const y = l.yOf(cur.pos.string);
        const pulse = 0.5 + 0.5 * Math.sin(t / 240);
        fx.fillStyle(paletteInt(stringKey(cur.pos.string)), 0.2 + 0.15 * pulse).fillRect(x - l.colW / 2 + 1, y - Math.floor(l.gap / 2), l.colW - 1, l.gap);
        ring(fx, x, y, 6, 'lime');
        ring(fx, x, y, 7 + Math.round(pulse), 'foam', 0.6);
        setTextColor(l.nums.get(cur.pos.fret)!, 'lime');
      }
      if (wrong && phase === 'climb' && t - wrong.at < 1800 && wrong.pos && wrong.pos.fret >= l.lo && wrong.pos.fret <= l.hi && l.strings.includes(wrong.pos.string)) {
        const x = l.xOf(wrong.pos.fret);
        const y = l.yOf(wrong.pos.string);
        ring(fx, x, y, 6, 'violet');
        ring(fx, x, y, 7, 'violet', 0.5);
        setTextColor(l.nums.get(wrong.pos.fret)!, 'violet');
      }
      for (const m of strayMarks) if (t - m.at < 1200 && m.pos.fret >= l.lo && m.pos.fret <= l.hi) cross(fx, l.xOf(m.pos.fret), l.yOf(m.pos.string), 'violet', 1 - (t - m.at) / 1200);
    };

    const redraw = () => {
      step();
      const t = this.time.now;
      const tNow = now();
      if (!ended && !pending && phase === 'climb' && !timed) {
        const c = run.tick(tNow);
        if (c) onCatch(c);
      }
      let beat = 0;
      if (phase === 'boss' && boss && !ended && !pending) {
        beat = session.beat();
        if (boss.timeUp(beat)) queue('bossEnd');
      }
      const ci = timed ? timedCursor() : heroPlat;
      const live = !ended && phase === 'climb' && ci < total();
      const cur = live ? targetAt(ci) : null;

      g.clear();
      back.clear();
      fx.clear();
      bannerBack.clear();
      platTexts.forEach((p) => p.setVisible(false));
      bossLabel.setVisible(phase === 'boss');
      panel(back, PANEL.x, PANEL.y, PANEL.w, PANEL.h, phase === 'boss' ? 'magenta' : 'water', 'deep', 0.85);

      if (phase === 'climb') {
        // Tower walls: brick rows slide with the camera.
        camPlat += (heroPlat - camPlat) * 0.2;
        if (Math.abs(heroPlat - camPlat) < 0.01) camPlat = heroPlat;
        const off = Math.round(camPlat * DY) % 12;
        for (let y = PANEL.y + 2 - off; y < PANEL.y + PANEL.h; y += 12) {
          if (y < PANEL.y + 1) continue;
          back.fillStyle(paletteInt('water'), 0.55).fillRect(PANEL.x + 1, y, PANEL.w - 2, 1);
          const k = Math.round(y / 12) % 2 ? 0 : 6;
          for (let x = PANEL.x + 1 + k; x < PANEL.x + PANEL.w - 1; x += 12) back.fillStyle(paletteInt('water'), 0.45).fillRect(x, y, 1, 12);
        }
        // Platforms: ground, one per target (carrying the fret number in the colour of its string).
        let nt = 0;
        for (let k = 0; k <= total(); k++) {
          const y = HERO_FEET + (camPlat - k) * DY;
          if (y < PANEL.y + 8 || y > PANEL.y + PANEL.h - 6) continue;
          const x = k === 0 ? TOWER_X : TOWER_X + (k % 2 ? 16 : -16);
          const edgeFade = Math.min(1, (y - PANEL.y - 4) / 14, (PANEL.y + PANEL.h - y) / 8);
          if (k === 0) {
            g.fillStyle(paletteInt('abyss'), 1).fillRect(PANEL.x + 4, y, PANEL.w - 8, 10);
            g.fillStyle(paletteInt('dim'), 0.9 * edgeFade).fillRect(PANEL.x + 5, y + 1, PANEL.w - 10, 3);
            continue;
          }
          const tp = targetAt(k - 1);
          const reached = k <= heroPlat;
          const isTarget = live && k === ci + 1;
          const dist = k - heroPlat;
          const alpha = (reached ? 0.55 : dist <= 3 ? 1 : 0.5) * edgeFade;
          const pulse = 0.5 + 0.5 * Math.sin(t / 240);
          slab(x, y, stringKey(tp.pos.string), alpha, isTarget ? (pulse > 0.5 ? 'lime' : 'foam') : null);
          const label = platTexts[nt++ % platTexts.length];
          label.setVisible(edgeFade > 0.35);
          placeText(label, x, y + 2, String(tp.pos.fret), { color: 'abyss', align: 'center' });
          if (k === total()) {
            // The top: a small flag.
            g.fillStyle(paletteInt('foam'), alpha).fillRect(x + SLAB_W / 2 - 4, y - 14, 1, 14);
            g.fillStyle(paletteInt('magenta'), alpha).fillRect(x + SLAB_W / 2 - 3, y - 14, 6, 4);
          }
        }
        // Hero: platform to platform with a small arc; falls and hurt flicker.
        const to = heroXY(heroPlat);
        const from = heroXY(heroFrom);
        const u = Math.min(1, (t - jumpAt) / JUMP_MS);
        const hx = Math.round(from.x + (to.x - from.x) * u);
        const arc = u < 1 ? Math.sin(Math.PI * u) * 12 : 0;
        const hyBase = to.y + (from.y - to.y) * (1 - u);
        const falling = t - fallAt < 600;
        const pose = falling ? 'fall' : u < 1 ? 'jump' : 'idle';
        if (pose !== lastPose) {
          lastPose = pose;
          if (pose === 'idle') hero.play('hero-idle');
          else {
            hero.anims.stop();
            hero.setTexture(pose === 'jump' ? 'hero-jump' : 'hero-fall');
          }
        }
        hero.setVisible(true).setScale(1).setPosition(hx, Math.round(hyBase - arc));
        hero.setAlpha(t - hurtAt < 900 && Math.floor(t / 70) % 2 === 0 ? 0.35 : 1);
        // Water (or darkness) rising from below, clipped to the tower.
        const gapNow = timed ? 0.2 + 1.35 * run.hearts : run.gap;
        const surface = Math.round(to.y + (from.y - to.y) * (1 - u) + gapNow * WATER_PX);
        const bottom = PANEL.y + PANEL.h - 1;
        if (surface < bottom) {
          const danger = gapNow < 1;
          const top = Math.max(PANEL.y + 1, surface);
          g.fillStyle(paletteInt('blue'), danger ? 0.45 : 0.32).fillRect(PANEL.x + 1, top, PANEL.w - 2, bottom - top);
          g.fillStyle(paletteInt('abyss'), 0.4).fillRect(PANEL.x + 1, Math.min(bottom - 1, top + 14), PANEL.w - 2, Math.max(0, bottom - top - 14));
          for (let x = PANEL.x + 1; x < PANEL.x + PANEL.w - 1; x += 2) {
            const wy = surface + Math.round(Math.sin((x + t / 70) / 5) * 1.5);
            if (wy < PANEL.y + 1 || wy > bottom - 1) continue;
            g.fillStyle(paletteInt(danger && Math.floor(t / 120) % 2 ? 'magenta' : 'cyan'), 0.9).fillRect(x, wy, 2, 1);
          }
          for (let b = 0; b < 5; b++) {
            const bx = PANEL.x + 8 + ((b * 23 + Math.floor(t / 900) * 7) % (PANEL.w - 16));
            const by = bottom - ((t / 40 + b * 31) % Math.max(8, bottom - top));
            if (by > top && by < bottom) g.fillStyle(paletteInt('foam'), 0.5).fillRect(bx, Math.round(by), 2, 2);
          }
        }
        // Water gauge under the tower.
        if (!timed) {
          const gw = Math.round(((PANEL.w - 2) * Math.max(0, Math.min(MAX_GAP, run.gap))) / MAX_GAP);
          g.fillStyle(paletteInt('deep'), 1).fillRect(PANEL.x, PANEL.y + PANEL.h + 3, PANEL.w, 4);
          g.fillStyle(paletteInt(run.gap > 2 ? 'cyan' : run.gap > 1 ? 'amber' : 'magenta'), 1).fillRect(PANEL.x + 1, PANEL.y + PANEL.h + 4, gw, 2);
        }
        barLabel.setVisible(false);
      } else {
        // Guardian room.
        hero.setVisible(true).setScale(2).setOrigin(0.5, 1).setPosition(PANEL.x + 30, PANEL.y + PANEL.h - 6);
        hero.setAlpha(1);
        if (lastPose !== 'idle') {
          lastPose = 'idle';
          hero.play('hero-idle');
        }
        const b = boss!;
        const hurt = t - guardHurtAt < 200;
        const down = b.defeated;
        guardian.setVisible(!down || t - guardDownAt < 500).setPosition(PANEL.x + PANEL.w / 2 + 8 + (hurt ? Math.round(Math.sin(t / 25) * 2) : 0), PANEL.y + 74);
        if (hurt) {
          guardian.anims.stop();
          guardian.setTexture('guardian-hurt');
        } else if (!guardian.anims.isPlaying) guardian.play('guardian');
        if (down) guardian.setAlpha(Math.max(0, 1 - (t - guardDownAt) / 500));
        else guardian.setAlpha(t - guardHealAt < 250 ? 0.6 + 0.4 * Math.abs(Math.sin(t / 40)) : 1);
        // Health bar.
        const bw = PANEL.w - 16;
        const frac = Math.max(0, b.hp / b.maxHp);
        g.fillStyle(paletteInt('abyss'), 1).fillRect(PANEL.x + 8, PANEL.y + 16, bw, 8);
        g.fillStyle(paletteInt(frac > 0.5 ? 'lime' : frac > 0.25 ? 'amber' : 'magenta'), 1).fillRect(PANEL.x + 9, PANEL.y + 17, Math.round((bw - 2) * frac), 6);
        g.lineStyle(1, paletteInt('foam'), 0.8).strokeRect(PANEL.x + 8.5, PANEL.y + 16.5, bw - 1, 7);
        // Bars of the backing: the current one is lit.
        const bar = b.barAt(beat);
        const sw = Math.floor((PANEL.w - 2) / b.bars);
        for (let i = 0; i < b.bars; i++) {
          const filled = i + 1 < bar || (i + 1 === bar && beat >= i * 4);
          const pulseB = i + 1 === bar ? 0.5 + 0.5 * (1 - (beat - Math.floor(beat))) : 0;
          g.fillStyle(paletteInt(i + 1 === bar ? 'cyan' : filled ? 'dim' : 'water'), i + 1 === bar ? 0.5 + 0.5 * pulseB : 1).fillRect(PANEL.x + 1 + i * sw, PANEL.y + PANEL.h + 3, sw - 1, 4);
        }
        barLabel.setVisible(true);
        placeText(barLabel, PANEL.x + PANEL.w / 2, PANEL.y + PANEL.h + 9, `COMPÁS ${bar} / ${b.bars}`, { color: 'dim', align: 'center' });
        // Notes thrown at the guardian.
        for (let i = shots.length - 1; i >= 0; i--) {
          const s = shots[i];
          const u = (t - s.born) / 260;
          if (u >= 1) {
            shots.splice(i, 1);
            continue;
          }
          const x = s.from.x + (s.to.x - s.from.x) * u;
          const y = s.from.y + (s.to.y - s.from.y) * u - Math.sin(Math.PI * u) * 10;
          fx.fillStyle(paletteInt(s.color), 1).fillRect(Math.round(x) - 1, Math.round(y) - 1, 4, 4);
          fx.fillStyle(paletteInt('foam'), 1).fillRect(Math.round(x), Math.round(y), 2, 2);
        }
      }

      drawMini(t, phase === 'climb' ? cur : null);

      // Side column: the target (or the boss' numbers).
      noteText.setAlpha(1);
      if (phase === 'climb' && cur) {
        const col = stringKey(cur.pos.string);
        placeText(noteText, SIDE.x + SIDE.w / 2, 114, noteName(cur.midi), { scale: 2, color: col, align: 'center' });
        placeText(noteSub, SIDE.x + SIDE.w / 2, 132, `cuerda ${stringNumber(instId, cur.pos.string)}  ·  traste ${cur.pos.fret}`, { color: 'foam', align: 'center' });
      } else if (phase === 'boss' && boss) {
        placeText(noteText, SIDE.x + SIDE.w / 2, 114, lastBoss.damage ? `-${lastBoss.damage}` : 'IMPROVISA', { scale: 2, color: lastBoss.repeat > 2 ? 'amber' : 'lime', align: 'center' });
        placeText(noteSub, SIDE.x + SIDE.w / 2, 132, `VIDA ${Math.ceil(boss.hp)}/${boss.maxHp}  NOTAS ${boss.used.size}/${zone.length}`, { color: 'foam', align: 'center' });
      } else {
        placeText(noteText, SIDE.x + SIDE.w / 2, 114, '', { scale: 2 });
        placeText(noteSub, SIDE.x + SIDE.w / 2, 132, '', {});
      }
      let hint = '';
      let hintColor: PaletteKey = 'amber';
      if (phase === 'climb' && wrong && (timed ? t - wrong.at < 1800 : t - wrong.at < 2500)) {
        hint = `${wrong.name}: ${wrong.hint}`;
      } else if (phase === 'boss' && boss) {
        if (wrong && t - wrong.at < 1500) {
          hint = `${wrong.name}: fuera de la escala`;
          hintColor = 'magenta';
        } else if (lastBoss.repeat > 1) hint = `Repites x${lastBoss.repeat}: mueve la mano`;
        else hint = 'Notas distintas, más daño';
        if (!(wrong && t - wrong.at < 1500) && lastBoss.repeat <= 1) hintColor = 'dim';
      } else if (phase === 'climb' && !timed && run.gap < 1.2 && !ended) {
        hint = '¡Sube, el agua te alcanza!';
        hintColor = 'magenta';
      }
      placeText(hintText, SIDE.x + SIDE.w / 2, 144, hint, { color: hintColor, align: 'center' });
      placeText(sub, W / 2, 161, phase === 'climb' ? levelLabel('scales', level) : '', { color: 'dim', align: 'center' });

      // Floating points.
      popTexts.forEach((pt, i) => {
        const p = pops[i];
        const sh = popShadows[i];
        if (!p || t - p.born > 1000) {
          pt.setAlpha(0);
          sh.setAlpha(0);
          return;
        }
        const px = Math.max(measureText(p.text) / 2 + 4, Math.min(W - measureText(p.text) / 2 - 4, p.x));
        const py = p.y - Math.round((t - p.born) / 90);
        const a = t - p.born < 700 ? 1 : 1 - (t - p.born - 700) / 300;
        placeText(pt, px, py, p.text, { color: p.color, align: 'center' });
        placeText(sh, px + 1, py + 1, p.text, { color: 'abyss', align: 'center' });
        pt.setAlpha(a);
        sh.setAlpha(a);
      });

      // Banner over everything.
      const bOn = !ended && banner !== '' && t < bannerUntil;
      if (bOn) {
        const bw = Math.min(W - 8, Math.max(180, Math.max(measureText(banner) * 2, measureText(bannerSub)) + 28));
        const bx = Math.round((W - bw) / 2);
        bannerBack.fillStyle(paletteInt('abyss'), 0.85).fillRect(bx, 62, bw, 48);
        bannerBack.lineStyle(1, paletteInt(bannerColor), 1).strokeRect(bx + 0.5, 62.5, bw - 1, 47);
      }
      placeText(bannerText, W / 2, 70, bOn ? banner : '', { scale: 2, color: bannerColor, align: 'center' });
      placeText(bannerSubText, W / 2, 94, bOn ? bannerSub : '', { color: 'foam', align: 'center' });

      hooks.tower = {
        phase,
        timed,
        floor: run.floor,
        floors: FLOORS,
        attempt: run.attempt,
        restarts: run.restarts,
        hearts: run.hearts,
        score: run.score,
        combo: run.combo,
        bestCombo: run.bestCombo,
        multiplier: run.multiplier,
        pace: run.pace,
        gap: run.gap,
        platform: heroPlat,
        index: ci,
        total: total(),
        target: cur ? { string: cur.pos.string, fret: cur.pos.fret, midi: cur.midi } : null,
        invulnerable: timed ? false : run.isInvulnerable(tNow),
        banner: bOn ? banner : '',
        boss: boss ? { hp: boss.hp, maxHp: boss.maxHp, bar: boss.barAt(beat), bars: boss.bars, lastDamage: lastBoss.damage, repeat: lastBoss.repeat, defeated: boss.defeated, strays: boss.strays } : null,
        zone: zone.map((n) => n.midi),
        floorsDone,
        bossesDefeated,
        over: ended,
      };
    };

    const timedCursor = () => {
      const i = ex.targets.findIndex((_, k) => !resolved.has(k));
      return i < 0 ? total() : i;
    };

    this.events.on(Phaser.Scenes.Events.UPDATE, redraw);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.UPDATE, redraw);
      offs.forEach((f) => f());
      backing?.stop();
      session.dispose();
      mini?.destroy();
      hooks.tower = null;
    });

    // Floor 1. The launcher's session runs the generator's tempo; a bass plays the timed level slower: start over at ours.
    hooks.judged = [];
    ex = exerciseOf(1);
    if (timed && data0.exercise.bpm !== Math.round(run.pace)) {
      session = data0.session.spawn(ex);
      data0.session.release();
    }
    startFloor(1, false);
    beginGame(this, { ...data0, session }, { manual: true });
    bannerOn('PISO 1', timed ? `TEMPO ${Math.round(run.pace)} BPM` : `AGUA ${run.pace.toFixed(2)} PLAT/S`, 'cyan');
  }
}
