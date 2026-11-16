import Phaser from 'phaser';
import { drawText, placeText } from '../art/text';
import { measureText } from '../art/font';
import { addBackground, enterScene, H, profileStore, W } from '../engine/kit';
import { hooks } from '../engine/hooks';
import { fretsZone, generate, levelLabel } from '../exercises';
import { makeFakeControl } from '../game/fakePlayer';
import { boardLayout, directionHint, playedOnBoard, rowY, slotX, type BoardLayout } from '../game/frets/board';
import { FakeInput } from '../game/input';
import { MAX_HEARTS, NinjaRun, planWave, WAVES, type WavePlan } from '../game/ninja/state';
import { saveArcadeBest } from '../game/progressBlob';
import { GAMES } from '../game/registry';
import { beginGame, showResults, trackEnergy } from '../game/scene';
import type { GameSession } from '../game/session';
import type { GameSceneData } from '../game/types';
import { INSTRUMENTS, noteName } from '../model/instrument';
import { summarize } from '../scoring/summary';
import type { ScoredTarget } from '../scoring/types';
import { paletteInt, type PaletteKey } from '../ui/palette';
import { drawBridge, ring, setTextColor, stringKey, type BridgeArt } from './fretsDraw';

const SEED_STEP = 7919;
const START_DELAY = 1.6;
const NEXT_DELAY = 0.45;
const DASH_MS = 150;
const STRIKE_MS = 260;
/** Message line under the bridge (banner, wrong-fret hint, points). */
const MSG_Y = 132;
const SUB_Y = 152;

interface Pop {
  text: string;
  x: number;
  y: number;
  color: PaletteKey;
  born: number;
}

/**
 * Ninja: the ARCADE practice game for frets. Same Exercise and layout as Luciérnagas; here an enemy stands on a
 * plank with a countdown ring, you play its fret and the ninja dashes there. Rules: src/game/ninja/state.ts.
 */
export class NinjaScene extends Phaser.Scene {
  constructor() {
    super('ninja');
  }

  create(data: GameSceneData): void {
    enterScene(this, 'ninja');
    addBackground(this);
    const store = profileStore(this);
    const def = GAMES[data.params.gameId];
    const baseSeed = data.params.seed ?? 1;
    const inst = INSTRUMENTS[data.exercise.instrument];
    const run = new NinjaRun(data.level, inst.id);

    let session: GameSession = data.session;
    let plan!: WavePlan;
    let layout!: BoardLayout;
    let bridge!: BridgeArt;
    let offs: (() => void)[] = [];
    let pending: 'next' | 'fail' | null = null;
    let enemyIdx = 0;
    let skipping = 0;
    let ended = false;
    let banner = '';
    let bannerSub = '';
    let bannerColor: PaletteKey = 'amber';
    let bannerUntil = 0;
    let wrongMark: { string: number; fret: number } | null = null;
    let wrongHint = '';
    let wrongUntil = 0;
    let pop: Pop | null = null;
    let dash: { fromX: number; fromY: number; toX: number; toY: number; at: number } | null = null;
    let struck: { x: number; y: number; at: number; color: PaletteKey } | null = null;
    let strikeAt = -1e9;
    let hurtAt = -1e9;
    let ninjaX = 0;
    let ninjaY = 0;
    let lastPos = 'idle';
    /** Final results of completed waves; if none was completed the results use every attempt instead. */
    const completed: ScoredTarget[] = [];
    const attempted: ScoredTarget[] = [];

    const seedOf = (wave: number) => baseSeed + (wave - 1) * SEED_STEP;
    const exerciseOf = (wave: number) =>
      wave === 1 ? data.exercise : generate(data.skill, { instrument: inst.id, level: data.level, seed: seedOf(wave), length: def.length });
    const now = () => session.input.now();
    const home = (e: { pos: { string: number; fret: number } }) => ({ x: slotX(layout, e.pos.fret), y: rowY(layout, e.pos.string) - 7 });

    // ---- static layout ----
    drawText(this, 8, 8, 'NINJA', { scale: 2, color: def.accent, depth: 10 });
    const scoreText = drawText(this, W / 2, 8, '0', { scale: 2, color: 'foam', align: 'center', depth: 10 });
    const comboText = drawText(this, W / 2, 26, '', { color: 'dim', align: 'center', depth: 10 });
    drawText(this, W - 8, 8, `NIVEL ${data.level}`, { color: 'foam', align: 'right', depth: 10 });
    const waveText = drawText(this, W - 8, 18, '', { color: 'dim', align: 'right', depth: 10 });
    const limitText = drawText(this, W - 8, 28, '', { color: 'dim', align: 'right', depth: 10 });
    drawText(this, W / 2, 162, levelLabel('frets', data.level), { color: 'dim', align: 'center', depth: 10 });
    const hearts = Array.from({ length: MAX_HEARTS }, (_, i) => this.add.image(8 + i * 10, 24, 'heart').setOrigin(0, 0).setDepth(10));
    const msg = drawText(this, W / 2, MSG_Y, '', { scale: 2, color: 'amber', align: 'center', depth: 10 });
    const sub = drawText(this, W / 2, SUB_Y, '', { color: 'foam', align: 'center', depth: 10 });
    drawText(this, W / 2, H - 9, 'Toca el traste del enemigo   Esc salir', { color: 'dim', align: 'center', depth: 10 });
    const popText = drawText(this, 0, 0, '', { color: 'lime', align: 'center', depth: 12 });
    const back = this.add.graphics().setDepth(3);
    const g = this.add.graphics().setDepth(9);
    const shadows = [0, 1].map(() => this.add.sprite(0, 0, 'foe').setOrigin(0.5, 1).setDepth(4).setVisible(false));
    const foe = this.add.sprite(0, 0, 'foe').setOrigin(0.5, 1).setDepth(6).setVisible(false);
    foe.play('foe');
    const shield = this.add.image(0, 0, 'shield').setDepth(7).setVisible(false);
    const ninja = this.add.sprite(0, 0, 'ninja-idle').setOrigin(0.5, 1).setDepth(8);
    ninja.play('ninja-idle');

    const showHud = () => {
      placeText(scoreText, W / 2, 8, String(run.score), { scale: 2, color: 'foam', align: 'center' });
      const m = run.multiplier;
      placeText(comboText, W / 2, 26, `RACHA ${run.combo}  ·  x${m}`, { color: m >= 4 ? 'lime' : m >= 2 ? 'cyan' : 'foam', align: 'center' });
      placeText(waveText, W - 8, 18, `OLEADA ${run.wave}/${WAVES}`, { color: 'dim', align: 'right' });
      placeText(limitText, W - 8, 28, `TIEMPO ${run.limit.toFixed(1)} S`, { color: 'dim', align: 'right' });
      hearts.forEach((h, i) => h.setTexture(i < run.hearts ? 'heart' : 'heart-empty'));
    };
    const popAt = (x: number, y: number, text: string, color: PaletteKey) => {
      pop = { text, x, y, color, born: this.time.now };
    };

    // ---- waves ----
    const buildBoard = (wave: number) => {
      bridge?.destroy();
      layout = boardLayout(fretsZone(inst.id, data.level, seedOf(wave)), W, 94);
      bridge = drawBridge(this, layout);
    };

    const spawnEnemy = (delay: number) => {
      const e = plan.enemies[enemyIdx];
      run.spawn(enemyIdx, e, now(), delay);
      foe.setVisible(true).setTint(paletteInt(stringKey(e.pos.string)));
    };

    const wire = (s: GameSession) => {
      offs.forEach((f) => f());
      offs = [
        s.on('wrongAttempt', (r) => onWrong(s, r)),
        s.on('targetResolved', (r) => onResolved(s, r)),
        s.on('finished', (_summary, results) => onFinished(s, results)),
        trackEnergy(this, s),
      ];
      hooks.fake = s.input instanceof FakeInput ? makeFakeControl(s, s.input) : null;
    };

    const startWave = (wave: number) => {
      buildBoard(wave);
      plan = planWave(exerciseOf(wave), data.level, seedOf(wave));
      enemyIdx = 0;
      skipping = 0;
      wrongMark = null;
      wrongHint = '';
      const first = home(plan.enemies[0]);
      ninjaX = first.x - layout.step;
      ninjaY = first.y;
      dash = null;
    };

    const onWrong = (s: GameSession, r: ScoredTarget) => {
      if (s !== session || ended || pending) return;
      const heard = r.heard?.[0];
      if (heard === undefined || !run.live) return;
      if (!run.wrong(now())) return;
      const e = plan.enemies[run.live.index];
      const where = playedOnBoard(layout, inst, heard, e.pos);
      wrongMark = where.pos;
      wrongHint = `Tocaste ${noteName(heard)}: ${directionHint(heard, e.midi).text}`;
      wrongUntil = this.time.now + 1800;
      showHud();
    };

    const onResolved = (s: GameSession, r: ScoredTarget) => {
      if (s !== session || ended) return;
      attempted.push(r);
      hooks.judged.push({ index: r.index, judgement: r.judgement, deltaMs: Math.round(r.delta * 1000) });
      if (skipping > 0) {
        skipping--;
        return;
      }
      if (pending || r.judgement !== 'hit') return;
      const res = run.hit(now());
      if (!res) return;
      const e = plan.enemies[plan.enemyOf[r.index]];
      const at = home(e);
      wrongMark = null;
      wrongHint = '';
      if (res.kind === 'crack') {
        popAt(at.x, at.y - 28, `ESCUDO  +${res.points}`, 'cyan');
        struck = { x: at.x, y: at.y - 8, at: this.time.now, color: 'cyan' };
      } else {
        dash = { fromX: ninjaX, fromY: ninjaY, toX: at.x, toY: at.y, at: this.time.now };
        strikeAt = this.time.now + DASH_MS;
        struck = { x: at.x, y: at.y - 8, at: strikeAt, color: res.clean ? 'lime' : 'amber' };
        popAt(at.x, at.y - 28, `+${res.points}`, res.clean ? 'lime' : 'amber');
        foe.setVisible(false);
        enemyIdx++;
        if (enemyIdx < plan.enemies.length) spawnEnemy(NEXT_DELAY);
      }
      showHud();
    };

    const onFinished = (s: GameSession, results: ScoredTarget[]) => {
      if (s !== session || ended || pending) return;
      completed.push(...results);
      const end = run.completeWave();
      showHud();
      if (end.over) finishRun();
      else pending = 'next';
    };

    const timeoutNow = () => {
      const live = run.live!;
      const e = plan.enemies[live.index];
      const at = home(e);
      const hits = live.hitsLeft;
      const failed = run.timeout();
      hurtAt = this.time.now;
      this.cameras.main.flash(120, 255, 63, 180, false);
      this.cameras.main.shake(140, 0.006);
      popAt(at.x, at.y - 28, 'TE GOLPEA', 'magenta');
      foe.setVisible(false);
      showHud();
      if (failed) {
        pending = 'fail';
        return;
      }
      enemyIdx++;
      skipping = hits;
      for (let i = 0; i < hits; i++) session.skipCurrent();
      if (enemyIdx < plan.enemies.length) spawnEnemy(NEXT_DELAY);
    };

    const finishRun = () => {
      if (ended) return;
      ended = true;
      banner = '';
      foe.setVisible(false);
      shield.setVisible(false);
      placeText(msg, W / 2, MSG_Y, 'FIN', { scale: 2, color: 'cyan', align: 'center' });
      const pool = completed.length ? completed : attempted;
      const summary = summarize(pool, Math.max(1, pool.length), false, 0);
      const open = (previousBest: number, newBest: boolean) => {
        if (!this.scene.isActive()) return;
        showResults(this, { params: data.params, mode: data.mode, level: data.level, skill: data.skill, summary, arcade: { score: run.score, bestCombo: run.bestCombo, previousBest, newBest } });
      };
      saveArcadeBest(store, inst.id, def.id, data.level, { score: run.score, bestCombo: run.bestCombo }).then(
        (b) => open(b.previousBest, b.newBest),
        () => open(0, false),
      );
    };

    const switchWave = () => {
      session.release();
      if (session.input instanceof FakeInput) session.input.clearPending();
      pop = null;
      struck = null;
      startWave(run.wave);
      session = session.spawn(plan.exercise);
      wire(session);
      session.start();
      spawnEnemy(START_DELAY);
      bannerUntil = this.time.now + 2400;
    };

    const step = () => {
      if (ended || !pending) return;
      const what = pending;
      pending = null;
      if (what === 'fail') {
        const f = run.failWave();
        if (f.over) {
          session.release();
          showHud();
          finishRun();
          return;
        }
        banner = 'Otra vez, más despacio';
        bannerSub = `MÁS TIEMPO: ${f.limit.toFixed(1)} S POR ENEMIGO`;
        bannerColor = 'amber';
      } else {
        banner = `OLEADA ${run.wave}`;
        bannerSub = `TIEMPO ${run.limit.toFixed(1)} S POR ENEMIGO`;
        bannerColor = 'cyan';
      }
      switchWave();
      showHud();
    };

    // ---- drawing ----
    const redraw = () => {
      step();
      const t = this.time.now;
      const tNow = now();
      // Time over?
      if (!ended && !pending && run.live && run.expired(tNow)) timeoutNow();

      back.clear();
      g.clear();
      bridge.nums.forEach((n) => setTextColor(n, 'foam'));
      const live = ended ? null : run.live;
      const e = live ? plan.enemies[live.index] : null;
      const ex = e ? home(e) : null;

      // Shadows of the next enemies (dim): where to look next.
      shadows.forEach((s, k) => {
        const n = ended ? undefined : plan.enemies[enemyIdx + 1 + k];
        if (!n || !live) return s.setVisible(false);
        const p = home(n);
        s.setVisible(true).setPosition(p.x, p.y).setTint(paletteInt(stringKey(n.pos.string))).setAlpha(k === 0 ? 0.3 : 0.14);
      });

      if (live && e && ex) {
        const col = stringKey(e.pos.string);
        const num = bridge.nums.get(`${e.pos.string}:${e.pos.fret}`);
        if (num) setTextColor(num, 'lime');
        const x0 = layout.left + e.pos.fret * layout.step;
        back.fillStyle(paletteInt(col), 0.28).fillRect(x0 + 1, ex.y - 7, layout.step - 1, 16);
        const bob = Math.round(Math.sin(t / 220) * 1);
        foe.setPosition(ex.x, ex.y + bob);
        // Countdown ring: full while the delay runs, then it empties; colour tells how urgent.
        const frac = Math.max(0, Math.min(1, (run.remaining(tNow) ?? 0) / live.limit));
        const rc: PaletteKey = frac > 0.5 ? 'lime' : frac > 0.25 ? 'amber' : 'magenta';
        const cy = ex.y - 15;
        g.lineStyle(3, paletteInt('abyss'), 0.9).strokeCircle(ex.x, cy, 13);
        if (frac > 0) {
          g.lineStyle(2, paletteInt(rc), 1);
          g.beginPath();
          g.arc(ex.x, cy, 13, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac, false);
          g.strokePath();
        }
        if (live.shield) shield.setVisible(true).setTexture(live.hitsLeft === 2 ? 'shield' : 'shield-cracked').setPosition(ex.x, ex.y - 15 + bob);
        else shield.setVisible(false);
      } else {
        shield.setVisible(false);
      }

      // Ninja: dash to the last enemy, strike, then idle on its plank.
      if (dash) {
        const u = Math.min(1, (t - dash.at) / DASH_MS);
        ninjaX = Math.round(dash.fromX + (dash.toX - dash.fromX) * u);
        ninjaY = Math.round(dash.fromY + (dash.toY - dash.fromY) * u);
        g.lineStyle(2, paletteInt('cyan'), 0.7).lineBetween(dash.fromX, dash.fromY - 8, ninjaX, ninjaY - 8);
        g.lineStyle(1, paletteInt('foam'), 0.9).lineBetween(dash.fromX, dash.fromY - 10, ninjaX, ninjaY - 10);
        if (u >= 1) dash = null;
      }
      const striking = !dash && t - strikeAt < STRIKE_MS && t >= strikeAt;
      const pose = dash ? 'dash' : striking ? 'strike' : 'idle';
      if (pose !== lastPos) {
        lastPos = pose;
        if (pose === 'idle') ninja.play('ninja-idle');
        else {
          ninja.anims.stop();
          ninja.setTexture(pose === 'strike' ? 'ninja-strike' : 'ninja-idle');
        }
      }
      ninja.setPosition(ninjaX, ninjaY).setAlpha(!ended && t - hurtAt < 600 && Math.floor(t / 60) % 2 === 0 ? 0.35 : 1);
      if (struck && t >= struck.at) {
        const age = t - struck.at;
        if (age < 320) {
          const r = 5 + age / 40;
          g.lineStyle(2, paletteInt(struck.color), 1 - age / 320).lineBetween(struck.x - r, struck.y + r, struck.x + r, struck.y - r);
          g.lineStyle(1, paletteInt('foam'), 1 - age / 320).lineBetween(struck.x - r, struck.y + r - 2, struck.x + r, struck.y - r - 2);
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            g.fillStyle(paletteInt(struck.color), 1 - age / 320).fillRect(Math.round(struck.x + Math.cos(a) * age / 9), Math.round(struck.y + Math.sin(a) * age / 9), 2, 2);
          }
        } else struck = null;
      }

      // Wrong fret: where it was and which way to go.
      const wrongOn = !ended && t < wrongUntil && wrongHint !== '';
      if (wrongOn && wrongMark) {
        const px = slotX(layout, wrongMark.fret);
        const py = rowY(layout, wrongMark.string);
        ring(g, px, py, 7, 'violet');
        ring(g, px, py, 8, 'violet', 0.5);
        const wn = bridge.nums.get(`${wrongMark.string}:${wrongMark.fret}`);
        if (wn) setTextColor(wn, 'violet');
      }

      // Message line: wave banner > wrong hint.
      const bannerOn = t < bannerUntil && !ended && banner !== '';
      if (bannerOn) {
        placeText(msg, W / 2, MSG_Y, banner, { scale: 2, color: bannerColor, align: 'center' });
        placeText(sub, W / 2, SUB_Y, bannerSub, { color: 'foam', align: 'center' });
      } else if (wrongOn) {
        placeText(msg, W / 2, MSG_Y, '', { scale: 2 });
        placeText(sub, W / 2, SUB_Y, wrongHint, { color: 'amber', align: 'center' });
      } else {
        if (!ended) placeText(msg, W / 2, MSG_Y, '', { scale: 2 });
        placeText(sub, W / 2, SUB_Y, '', { color: 'foam', align: 'center' });
      }

      // Floating points.
      if (pop && t - pop.born < 900) {
        const px = Math.max(measureText(pop.text) / 2 + 4, Math.min(W - measureText(pop.text) / 2 - 4, pop.x));
        placeText(popText, px, pop.y - Math.round((t - pop.born) / 80), pop.text, { color: pop.color, align: 'center' });
        popText.setAlpha(t - pop.born < 600 ? 1 : 1 - (t - pop.born - 600) / 300);
      } else popText.setAlpha(0);

      hooks.ninja = {
        wave: run.wave,
        waves: WAVES,
        attempt: run.attempt,
        restarts: run.restarts,
        hearts: run.hearts,
        score: run.score,
        combo: run.combo,
        bestCombo: run.bestCombo,
        multiplier: run.multiplier,
        limit: run.limit,
        remaining: live ? run.remaining(tNow) : null,
        enemy: live && e ? { string: e.pos.string, fret: e.pos.fret, midi: e.midi, shield: live.shield, hitsLeft: live.hitsLeft } : null,
        banner: bannerOn ? banner : '',
        over: ended,
      };
    };
    this.events.on(Phaser.Scenes.Events.UPDATE, redraw);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.UPDATE, redraw);
      offs.forEach((f) => f());
      session.dispose();
      hooks.ninja = null;
    });

    // Wave 1: the launcher's session was built for the plain exercise; the Judge needs the wave plan (shields repeat a target).
    hooks.judged = [];
    startWave(1);
    const first = data.session.spawn(plan.exercise);
    data.session.release();
    session = first;
    wire(session);
    beginGame(this, { ...data, session }, { manual: true });
    spawnEnemy(START_DELAY);
    bannerUntil = this.time.now + 2400;
    banner = 'OLEADA 1';
    bannerSub = `TIEMPO ${run.limit.toFixed(1)} S POR ENEMIGO`;
    bannerColor = 'cyan';
    showHud();
  }
}
