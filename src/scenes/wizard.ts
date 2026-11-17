import Phaser from 'phaser';
import { wrapText, measureText } from '../art/font';
import { drawText, placeText } from '../art/text';
import { addBackground, enterScene, H, profileStore, W } from '../engine/kit';
import { hooks } from '../engine/hooks';
import { generate, levelLabel } from '../exercises';
import { makeFakeControl } from '../game/fakePlayer';
import { chordFeedback } from '../game/chords/feedback';
import { bassRoles, BASS_ROLE_ES, chordLabel, chordToneNames, groupChords, stringNumber, type ChordGroup } from '../game/chords/names';
import { RUNE_SIZE, runeColor, runeGlyph } from '../game/chords/rune';
import { FakeInput } from '../game/input';
import { saveArcadeBest } from '../game/progressBlob';
import { GAMES } from '../game/registry';
import { beginGame, showResults, trackEnergy } from '../game/scene';
import type { GameSession } from '../game/session';
import type { GameSceneData } from '../game/types';
import { panel } from '../game/ui';
import { bossLength, MAX_HEARTS, WaveFail, WAVES, WizardRun, type CastResult } from '../game/wizard/state';
import type { Exercise } from '../model/exercise';
import { INSTRUMENTS, noteName } from '../model/instrument';
import { summarize } from '../scoring/summary';
import type { ScoredTarget } from '../scoring/types';
import { paletteInt, type PaletteKey } from '../ui/palette';
import { drawChordBox, drawMiniChord, drawRune, type ChordBoxArt } from './chordsDraw';
import { stringKey } from './fretsDraw';

const SEED_STEP = 7919;
const BOSS_SEED = 4242;
const START_DELAY = 1.8;
const NEXT_DELAY = 0.5;
const GROUND_Y = 100;
const WIZ_X = 38;
const ARRIVE_X = 78;
const SPAWN_X = 290;
/** Pixels per beat of the timed level (an enemy arrives on the beat of its last note). */
const PX_BEAT = 40;
const PANEL_Y = 108;
const POOL = 3;

interface Fx {
  kind: 'bolt' | 'burst' | 'puff' | 'smash';
  x: number;
  y: number;
  born: number;
  color: PaletteKey;
  big: boolean;
}

/**
 * Hechicero: the ARCADE practice game for chords. Every enemy carries the RUNE of the chord that defeats it, with its name and a
 * small chord box; strum that chord to cast the spell. Same Exercise as Forja; here every enemy walks towards the wizard on a time
 * limit. Rules: src/game/wizard/state.ts. Level 10 is timed: the enemies arrive on the beat.
 */
export class WizardScene extends Phaser.Scene {
  constructor() {
    super('wizard');
  }

  create(data: GameSceneData): void {
    enterScene(this, 'wizard');
    addBackground(this);
    const store = profileStore(this);
    const def = GAMES[data.params.gameId];
    const baseSeed = data.params.seed ?? 1;
    const inst = INSTRUMENTS[data.exercise.instrument];
    const isBass = inst.id !== 'guitar';
    const timed = data.exercise.timed;
    const run = new WizardRun(data.level, inst.id, timed ? data.exercise.bpm ?? 60 : undefined);

    let session: GameSession = data.session;
    let ex: Exercise = data.exercise;
    let groups: ChordGroup[] = groupChords(ex);
    let offs: (() => void)[] = [];
    let pending: 'next' | 'fail' | 'boss' | null = null;
    let foeIdx = 0;
    let skipping = 0;
    let ended = false;
    let banner = '';
    let bannerSub = '';
    let bannerColor: PaletteKey = 'amber';
    let bannerUntil = 0;
    let last = 'none';
    let lastPoints = 0;
    let msgLines: { text: string; color: PaletteKey }[] = [];
    let msgUntil = 0;
    let pop: { text: string; x: number; y: number; color: PaletteKey; born: number } | null = null;
    let castStart = -1e9;
    let castWasHeard = false;
    let hurtAt = -1e9;
    let castPose = -1e9;
    let panelFoe = -1;
    let panelStage = '';
    let box: ChordBoxArt | null = null;
    let bossHit = -1e9;
    let platesBroken = 0;
    const fx: Fx[] = [];
    const completed: ScoredTarget[] = [];
    const attempted: ScoredTarget[] = [];
    /** Timed level: groups already decided, and per-group bass outcome. */
    const decided = new Set<number>();
    let bassMiss = 0;
    let bassWrong = 0;
    let bassAllHit = true;

    const seedOf = (wave: number) => baseSeed + (wave - 1) * SEED_STEP;
    const now = () => session.input.now();
    const arriveBeat = (gi: number) => ex.targets[groups[gi].first + groups[gi].count - 1].beat ?? 0;
    const groupMidis = (gr: ChordGroup): number[] => {
      const k = ex.targets[gr.first].kind;
      if (k.type === 'chord') return k.midis;
      return ex.targets.slice(gr.first, gr.first + gr.count).map((t) => (t.kind.type === 'note' ? t.kind.midi : 0));
    };
    const targetMidi = (i: number) => {
      const k = ex.targets[i].kind;
      return k.type === 'note' ? k.midi : 0;
    };

    // ---- static layout ----
    drawText(this, 8, 8, 'HECHICERO', { scale: 2, color: def.accent, depth: 10 });
    const scoreText = drawText(this, W / 2 + 28, 8, '0', { scale: 2, color: 'foam', align: 'center', depth: 10 });
    const comboText = drawText(this, W / 2 + 28, 26, '', { color: 'dim', align: 'center', depth: 10 });
    drawText(this, W - 8, 8, `NIVEL ${data.level}`, { color: 'foam', align: 'right', depth: 10 });
    const waveText = drawText(this, W - 8, 18, '', { color: 'dim', align: 'right', depth: 10 });
    const limitText = drawText(this, W - 8, 28, '', { color: 'dim', align: 'right', depth: 10 });
    drawText(this, 8, 36, levelLabel('chords', data.level), { color: 'dim', depth: 10 });
    const hearts = Array.from({ length: MAX_HEARTS }, (_, i) => this.add.image(8 + i * 10, 24, 'heart').setOrigin(0, 0).setDepth(10));
    const msgBig = drawText(this, W / 2, 76, '', { scale: 2, color: 'amber', align: 'center', depth: 12 });
    const msgSub = drawText(this, W / 2, 94, '', { color: 'foam', align: 'center', depth: 12 });
    drawText(this, W / 2, H - 8, isBass ? 'Toca las notas del acorde en orden   Esc salir' : 'Rasguea el acorde del enemigo   Esc salir', { color: 'dim', align: 'center', depth: 10 });
    const popText = drawText(this, 0, 0, '', { color: 'lime', align: 'center', depth: 12 });
    const nameBig = drawText(this, 86, PANEL_Y + 6, '', { scale: 3, color: 'foam', depth: 10 });
    const labelText = drawText(this, 86, PANEL_Y + 30, '', { color: 'cyan', depth: 10 });
    const tonesText = drawText(this, 86, PANEL_Y + 40, '', { color: 'dim', depth: 10 });
    const nextText = drawText(this, 206, PANEL_Y + 6, '', { color: 'dim', depth: 10 });
    const lineTexts = [0, 1, 2, 3].map((i) => drawText(this, 206, PANEL_Y + 17 + i * 10, '', { color: 'foam', depth: 10 }));
    const chainText = drawText(this, 206, PANEL_Y + 53, '', { color: 'lime', depth: 10 });
    const tabNums = [0, 1, 2, 3].map(() => drawText(this, 0, 0, '', { color: 'abyss', align: 'center', depth: 11 }));
    const foeNames = Array.from({ length: POOL }, () => drawText(this, 0, 0, '', { scale: 2, color: 'foam', depth: 11 }));

    const back = this.add.graphics().setDepth(2);
    const g = this.add.graphics().setDepth(9);
    const top = this.add.graphics().setDepth(11);
    panel(this.add.graphics().setDepth(7), 4, PANEL_Y, W - 8, 60, 'dim', 'abyss', 0.86);
    const wizard = this.add.sprite(WIZ_X, GROUND_Y, 'wizard-idle').setOrigin(0.5, 1).setScale(2).setDepth(6);
    wizard.play('wizard-idle');
    const foes = Array.from({ length: POOL }, () => {
      const s = this.add.sprite(0, 0, 'wisp').setOrigin(0.5, 1).setScale(2).setDepth(6).setVisible(false);
      s.play('wisp');
      return s;
    });
    const bossSprite = this.add.sprite(0, 0, 'wisp-boss').setOrigin(0.5, 1).setScale(2).setDepth(6).setVisible(false);

    const showHud = () => {
      placeText(scoreText, W / 2 + 28, 8, String(run.score), { scale: 2, color: 'foam', align: 'center' });
      const m = run.multiplier;
      placeText(comboText, W / 2 + 28, 26, `RACHA ${run.combo}  ·  x${m}`, { color: m >= 4 ? 'lime' : m >= 2 ? 'cyan' : 'foam', align: 'center' });
      placeText(waveText, W - 8, 18, run.stage === 'boss' ? `JEFE ${run.wave}/${WAVES}` : `OLEADA ${run.wave}/${WAVES}`, { color: run.stage === 'boss' ? 'magenta' : 'dim', align: 'right' });
      placeText(limitText, W - 8, 28, timed ? `TEMPO ${run.bpm} BPM` : `TIEMPO ${run.limit.toFixed(1)} S`, { color: 'dim', align: 'right' });
      hearts.forEach((h, i) => h.setTexture(i < run.hearts ? 'heart' : 'heart-empty'));
    };
    const say = (lines: string | string[], color: PaletteKey, ms = 2200) => {
      const arr = Array.isArray(lines) ? lines : [lines];
      msgLines = arr.flatMap((l) => wrapText(l, 17)).slice(0, 4).map((text) => ({ text, color }));
      msgUntil = this.time.now + ms;
    };
    const popAt = (x: number, y: number, text: string, color: PaletteKey) => {
      pop = { text, x, y, color, born: this.time.now };
    };
    const foeX = (gi: number): number => {
      if (!timed) {
        const live = run.live;
        if (run.stage === 'boss' || !live || live.index !== gi) return run.stage === 'boss' ? 238 : SPAWN_X;
        const frac = Math.max(0, Math.min(1, (run.remaining(now()) ?? 0) / live.limit));
        return Math.round(ARRIVE_X + (SPAWN_X - ARRIVE_X) * frac);
      }
      const x = ARRIVE_X + (arriveBeat(gi) - session.beat()) * PX_BEAT;
      return Math.round(Math.max(ARRIVE_X - 4, x));
    };

    // ---- panel of the live enemy ----
    const showPanel = (gi: number) => {
      panelFoe = gi;
      panelStage = run.stage;
      box?.destroy();
      box = null;
      const gr = groups[gi];
      placeText(nameBig, 86, PANEL_Y + 6, gr.name, { scale: 3, color: runeColor(gr.name) });
      placeText(labelText, 86, PANEL_Y + 30, chordLabel(gr.name), { color: 'cyan' });
      if (!isBass) {
        box = drawChordBox(this, gr.name, 24, PANEL_Y + 19, { sx: 8, sy: 7, labels: true, depth: 8 });
        placeText(tonesText, 86, PANEL_Y + 40, `Notas: ${chordToneNames(gr.name).join(' · ')}`, { color: 'dim' });
      } else {
        const names = ex.targets.slice(gr.first, gr.first + gr.count).map((t) => (t.kind.type === 'note' ? noteName(t.kind.midi) : ''));
        placeText(tonesText, 86, PANEL_Y + 40, `En orden: ${names.join(' · ')}`, { color: 'dim' });
      }
    };

    // ---- waves ----
    const makeExercise = (wave: number, boss: boolean): Exercise => {
      const e = generate(data.skill, { instrument: inst.id, level: data.level, seed: seedOf(wave) + (boss ? BOSS_SEED : 0), length: boss ? bossLength(data.level) : def.length });
      return timed ? { ...e, bpm: run.bpm } : e;
    };

    const spawnFoe = (delay: number) => {
      const gr = groups[foeIdx];
      run.spawn(foeIdx, { name: gr.name, steps: gr.count, boss: run.stage === 'boss' }, now(), timed ? -100 : delay);
      bassMiss = bassWrong = 0;
      bassAllHit = true;
    };

    const wire = (s: GameSession) => {
      offs.forEach((f) => f());
      offs = [
        s.on('wrongAttempt', (r) => onWrong(s, r)),
        s.on('targetResolved', (r) => onResolved(s, r)),
        s.on('finished', (_sum, results) => onFinished(s, results)),
        s.on('heard', (e) => {
          // A strum is being judged (the verdict takes ~0.25 s): the enemy cannot arrive meanwhile and the wizard charges.
          if (s !== session || e.type !== 'onset' || isBass || ended || pending || !run.live) return;
          run.strumHeard(now());
          castStart = this.time.now;
        }),
        trackEnergy(this, s),
      ];
      hooks.fake = s.input instanceof FakeInput ? makeFakeControl(s, s.input) : null;
    };

    const startRound = (boss: boolean) => {
      ex = makeExercise(run.wave, boss);
      groups = groupChords(ex);
      foeIdx = 0;
      skipping = 0;
      platesBroken = 0;
      panelFoe = -1;
      decided.clear();
      pop = null;
      msgLines = [];
      session = session.spawn(ex);
      wire(session);
      session.start();
      spawnFoe(START_DELAY);
      showHud();
    };

    const effectAt = (kind: Fx['kind'], x: number, y: number, color: PaletteKey, big = false) => {
      fx.push({ kind, x, y, born: this.time.now, color, big });
    };

    const describeCast = (res: CastResult, gi: number, boss: boolean): void => {
      const gr = groups[gi];
      const x = Math.min(W - 30, Math.max(40, foeX(gi)));
      last = res.kind;
      lastPoints = res.points;
      castPose = this.time.now;
      effectAt('bolt', x, GROUND_Y - 22, res.kind === 'critical' ? 'lime' : runeColor(gr.name), res.kind === 'critical');
      effectAt('burst', x, GROUND_Y - 22, res.kind === 'critical' ? 'lime' : 'amber', res.kind === 'critical');
      if (res.kind === 'critical') this.cameras.main.flash(90, 200, 255, 61, false);
      const lines = [res.kind === 'critical' ? '¡GOLPE CRÍTICO!' : 'HECHIZO LANZADO', `+${res.points}`];
      if (res.change) lines.push(`CAMBIO x${res.chain}  +${res.bonus}`);
      say(lines, res.kind === 'critical' ? 'lime' : 'cyan');
      popAt(x, 72, `${res.kind === 'critical' ? 'CRÍTICO ' : ''}+${res.points}`, res.kind === 'critical' ? 'lime' : 'amber');
      if (boss) {
        platesBroken++;
        bossHit = this.time.now;
        effectAt('smash', x, GROUND_Y - 30, 'amber', true);
      }
    };

    const fizzleNow = (r: ScoredTarget | null, gi: number) => {
      const gr = groups[gi];
      last = 'fizzle';
      lastPoints = 0;
      effectAt('puff', WIZ_X + 16, GROUND_Y - 24, 'violet');
      let detail = '';
      if (!isBass && r?.chord) {
        const f = chordFeedback(gr.name, r.chord, false);
        detail = f.missing.length ? `Falta ${f.missing.map((m) => m.note).join(' y ')} (cuerda ${[...new Set(f.missingStringIdx.map((i) => stringNumber('guitar', i)))].join(', ')})` : f.foreignText;
      } else if (isBass && r?.heard?.[0] !== undefined) detail = `Tocaste ${noteName(r.heard[0])}`;
      say(['HECHIZO FALLIDO', ...(detail ? [detail] : ['Era ' + gr.name])], 'violet', 2600);
      popAt(Math.min(W - 30, Math.max(40, foeX(gi))), 72, 'FALLÓ', 'violet');
      this.cameras.main.shake(80, 0.004);
      showHud();
    };

    const arriveNow = () => {
      const live = run.live;
      if (!live) return;
      const gi = live.index;
      const stepsLeft = live.steps - live.done;
      const failed = run.arrive();
      last = 'arrived';
      lastPoints = 0;
      hurtAt = this.time.now;
      this.cameras.main.flash(120, 255, 63, 180, false);
      this.cameras.main.shake(140, 0.006);
      say(['TE GOLPEA', `Era ${groups[gi].name}`], 'magenta');
      popAt(WIZ_X + 10, 60, '-1 CORAZÓN', 'magenta');
      showHud();
      if (failed) {
        pending = 'fail';
        return;
      }
      foeIdx++;
      if (!timed) {
        skipping = stepsLeft;
        for (let i = 0; i < stepsLeft; i++) session.skipCurrent();
      }
      if (foeIdx < groups.length) spawnFoe(NEXT_DELAY);
    };

    const nextFoe = () => {
      foeIdx++;
      if (foeIdx < groups.length) spawnFoe(NEXT_DELAY);
    };

    const onWrong = (s: GameSession, r: ScoredTarget) => {
      if (s !== session || ended || pending) return;
      run.strumDone();
      if (!run.live) return;
      if (!run.fizzle(now())) return;
      fizzleNow(r, run.live.index);
    };

    const guitarClean = (r: ScoredTarget, name: string) => !!r.chord && chordFeedback(name, r.chord, true).clean;

    const onResolved = (s: GameSession, r: ScoredTarget) => {
      if (s !== session || ended) return;
      run.strumDone();
      attempted.push(r);
      hooks.judged.push({ index: r.index, judgement: r.judgement, deltaMs: Math.round(r.delta * 1000) });
      if (skipping > 0) {
        skipping--;
        return;
      }
      if (pending || !run.live) return;
      const live = run.live;
      const gi = live.index;
      const gr = groups[gi];
      const accepted = r.judgement === 'hit' || r.judgement === 'early' || r.judgement === 'late';
      const stepIdx = r.index - gr.first;
      if (!timed) {
        if (r.judgement !== 'hit') return;
        if (stepIdx < gr.count - 1) {
          run.step();
          effectAt('burst', Math.min(W - 30, Math.max(40, foeX(gi))), GROUND_Y - 22, 'cyan');
          say([`NOTA ${stepIdx + 1} DE ${gr.count}`, `Ahora: ${noteName(targetMidi(r.index + 1))}`], 'cyan', 1800);
          return;
        }
        const res = run.cast(now(), { clean: isBass ? true : guitarClean(r, gr.name) });
        if (!res) return;
        describeCast(res, gi, live.boss);
        nextFoe();
        showHud();
        return;
      }
      // Timed level: the Judge decides on the beat.
      if (isBass) {
        if (!accepted) {
          if (r.judgement === 'miss') bassMiss++;
          else bassWrong++;
        } else if (r.judgement !== 'hit') bassAllHit = false;
        if (stepIdx < gr.count - 1) {
          if (accepted) run.step();
          return;
        }
        decided.add(gi);
        if (bassMiss > 0) arriveNow();
        else if (bassWrong > 0) {
          run.retreat();
          fizzleNow(r, gi);
          nextFoe();
        } else {
          const res = run.cast(now(), { clean: true, onBeat: bassAllHit });
          if (res) describeCast(res, gi, live.boss);
          nextFoe();
        }
        showHud();
        return;
      }
      decided.add(gi);
      if (accepted) {
        const res = run.cast(now(), { clean: guitarClean(r, gr.name), onBeat: r.judgement === 'hit' });
        if (res) describeCast(res, gi, live.boss);
        nextFoe();
      } else if (r.judgement === 'wrong') {
        run.retreat();
        fizzleNow(r, gi);
        nextFoe();
      } else arriveNow();
      showHud();
    };

    const onFinished = (s: GameSession, results: ScoredTarget[]) => {
      if (s !== session || ended || pending) return;
      completed.push(...results);
      if (run.stage === 'foes' && run.wave === WAVES) {
        pending = 'boss';
        return;
      }
      const end = run.completeWave(run.stage === 'boss');
      showHud();
      if (end.over) finishRun();
      else pending = 'next';
    };

    const finishRun = () => {
      if (ended) return;
      ended = true;
      banner = run.bossDefeated ? '¡JEFE DERROTADO!' : 'FIN';
      bannerSub = '';
      bannerColor = run.bossDefeated ? 'lime' : 'cyan';
      bannerUntil = this.time.now + 5000;
      const pool = completed.length ? completed : attempted;
      const summary = summarize(pool, Math.max(1, pool.length), timed, 0);
      const open = (previousBest: number, newBest: boolean) => {
        if (!this.scene.isActive()) return;
        showResults(this, { params: data.params, mode: data.mode, level: data.level, skill: data.skill, summary, arcade: { score: run.score, bestCombo: run.bestCombo, previousBest, newBest } });
      };
      saveArcadeBest(store, inst.id, def.id, data.level, { score: run.score, bestCombo: run.bestCombo }).then(
        (b) => open(b.previousBest, b.newBest),
        () => open(0, false),
      );
    };

    const step = () => {
      if (ended || !pending) return;
      const what = pending;
      pending = null;
      session.release();
      if (session.input instanceof FakeInput) session.input.clearPending();
      if (what === 'boss') {
        run.enterBoss();
        banner = '¡JEFE!';
        bannerSub = `Rompe su escudo: ${bossLength(data.level)} acordes`;
        bannerColor = 'magenta';
      } else if (what === 'fail') {
        const f: WaveFail = run.failWave();
        if (f.over) {
          showHud();
          finishRun();
          return;
        }
        banner = 'Otra vez, más despacio';
        bannerSub = timed ? `TEMPO ${f.bpm} BPM  ↓` : `MÁS TIEMPO: ${f.limit.toFixed(1)} S POR ENEMIGO`;
        bannerColor = 'amber';
      } else {
        banner = `OLEADA ${run.wave}`;
        bannerSub = timed ? `TEMPO ${run.bpm} BPM` : `TIEMPO ${run.limit.toFixed(1)} S POR ENEMIGO`;
        bannerColor = 'cyan';
      }
      bannerUntil = this.time.now + 2600;
      startRound(run.stage === 'boss');
    };

    // ---- drawing ----
    const foeColor = (gi: number): PaletteKey => runeColor(groups[gi].name);

    /** Rune + name + small chord box (or note pips on bass) over an enemy. */
    const drawBubble = (slot: number, gi: number, cx: number, live: boolean, t: number) => {
      const gr = groups[gi];
      const w = 80;
      const x0 = Math.max(4, Math.min(W - w - 4, Math.round(cx - w / 2)));
      const y0 = 38;
      const col = foeColor(gi);
      const boss = run.stage === 'boss';
      panel(g, x0, y0, w, 28, boss ? 'magenta' : live ? col : 'dim', 'abyss', 0.92);
      // Rune: with steps on bass it fills in band by band.
      const glyph = runeGlyph(gr.name);
      const done = live && run.live ? run.live.done : 0;
      const steps = gr.count;
      if (isBass && steps > 1) {
        const ink = glyph.map((row, ry) => ({ row, band: Math.min(steps - 1, Math.floor((ry * steps) / RUNE_SIZE)) }));
        ink.forEach(({ row, band }, ry) => drawRune(g, [row], x0 + 4, y0 + 5 + ry * 2, 2, col, band < done ? 1 : 0.28));
      } else drawRune(g, glyph, x0 + 4, y0 + 5, 2, col);
      placeText(foeNames[slot], x0 + 26, y0 + 7, gr.name, { scale: 2, color: live ? 'foam' : 'dim' });
      foeNames[slot].setDepth(11);
      if (!isBass) drawMiniChord(g, gr.name, x0 + 56, y0 + 9, 4, 4, live ? 1 : 0.7);
      else {
        for (let k = 0; k < steps; k++) {
          const px = x0 + 54 + k * 6;
          g.fillStyle(paletteInt(k < done ? 'lime' : 'dim'), 1).fillRect(px, y0 + 9, 4, 4);
          if (live && k === done) g.lineStyle(1, paletteInt('foam'), 0.6 + 0.4 * Math.sin(t / 130)).strokeRect(px - 0.5, y0 + 8.5, 5, 5);
        }
        placeText(foeNames[slot], x0 + 26, y0 + 7, gr.name, { scale: 2, color: live ? 'foam' : 'dim' });
      }
    };

    const drawTab = (gi: number, t: number) => {
      const gr = groups[gi];
      const n = inst.openStrings.length;
      const tx = 14;
      const ty = PANEL_Y + 16;
      const gap = 7;
      const colW = 16;
      const w = gr.count * colW + 4;
      const targets = ex.targets.slice(gr.first, gr.first + gr.count);
      for (let s = 0; s < n; s++) {
        const yy = ty + (n - 1 - s) * gap;
        g.fillStyle(paletteInt(stringKey(s)), 0.9).fillRect(tx, yy + 3, w, 1);
      }
      const doneSteps = run.live && run.live.index === gi ? run.live.done : 0;
      targets.forEach((tg, k) => {
        const pos = tg.kind.type === 'note' ? tg.kind.pos : undefined;
        const lab = tabNums[k];
        if (!pos) return;
        const cx = tx + 4 + k * colW + colW / 2;
        const cy = ty + (n - 1 - pos.string) * gap + 3;
        const active = k === doneSteps;
        g.fillStyle(paletteInt('abyss'), 1).fillCircle(cx, cy + 0.5, 6);
        g.fillStyle(paletteInt(stringKey(pos.string)), k < doneSteps ? 1 : active ? 0.6 + 0.4 * Math.sin(t / 140) : 0.5).fillCircle(cx, cy + 0.5, 5);
        if (k < doneSteps) g.lineStyle(1, paletteInt('lime'), 1).strokeCircle(cx, cy + 0.5, 7);
        placeText(lab, cx, cy - 3, String(pos.fret), { color: 'abyss', align: 'center' });
        lab.setVisible(true);
      });
      for (let k = targets.length; k < tabNums.length; k++) tabNums[k].setVisible(false);
      const roles = bassRoles(gr.count);
      placeText(chainText, 206, PANEL_Y + 53, '', { color: 'lime' });
      void roles;
      void BASS_ROLE_ES;
    };

    const redraw = () => {
      step();
      const t = this.time.now;
      const tNow = now();
      // Time over (never while a strum is being judged).
      if (!ended && !pending && !timed && run.live && run.expired(tNow)) arriveNow();
      back.clear();
      g.clear();
      top.clear();
      const live = ended ? null : run.live;
      if (live && (panelFoe !== live.index || panelStage !== run.stage)) showPanel(live.index);
      const casting = !!live && run.casting(tNow);
      if (castWasHeard !== casting) castWasHeard = casting;

      // Ground.
      back.fillStyle(paletteInt('deep'), 0.9).fillRect(0, GROUND_Y, W, PANEL_Y - GROUND_Y);
      back.fillStyle(paletteInt('water'), 1).fillRect(0, GROUND_Y, W, 1);
      for (let x = 0; x < W; x += 16) back.fillStyle(paletteInt('water'), 0.6).fillRect(x, GROUND_Y + 3 + ((x / 16) % 2) * 2, 8, 1);

      // Enemies.
      const views: { gi: number; x: number; live: boolean }[] = [];
      if (!ended) {
        if (!timed) {
          if (live) views.push({ gi: live.index, x: foeX(live.index), live: true });
        } else {
          for (let gi = 0; gi < groups.length; gi++) {
            if (decided.has(gi) || gi < foeIdx) continue;
            if (arriveBeat(gi) - session.beat() > 6.5) continue;
            views.push({ gi, x: foeX(gi), live: !!live && live.index === gi });
          }
        }
      }
      const bossOn = run.stage === 'boss' && !ended;
      foes.forEach((f, i) => {
        const v = views[i];
        if (!v || bossOn) return f.setVisible(false);
        const bob = Math.round(Math.sin(t / 220 + i) * 1.5);
        f.setVisible(true).setTint(paletteInt(foeColor(v.gi))).setPosition(v.x, GROUND_Y - 2 + bob).setAlpha(v.live ? 1 : 0.7);
        drawBubble(i, v.gi, v.x, v.live, t);
      });
      for (let i = views.length; i < POOL; i++) placeText(foeNames[i], 0, 0, '', {});
      if (bossOn) {
        const v = views[0];
        const shake = t - bossHit < 250 ? Math.round(Math.sin(t / 18) * 2) : 0;
        bossSprite.setVisible(true).setTint(paletteInt('magenta')).setPosition(238 + shake, GROUND_Y - 2 + Math.round(Math.sin(t / 260) * 1.5));
        if (v) drawBubble(0, v.gi, 238, true, t);
        // Shield plates: what is left of the progression.
        const total = groups.length;
        const pw = 11;
        const x0 = Math.round(238 - (total * (pw + 2)) / 2);
        for (let k = 0; k < total; k++) {
          const broken = k < platesBroken;
          g.fillStyle(paletteInt('abyss'), 1).fillRect(x0 + k * (pw + 2) - 1, GROUND_Y - 41, pw + 2, 7);
          g.fillStyle(paletteInt(broken ? 'water' : k === platesBroken ? 'amber' : 'cyan'), broken ? 0.5 : 1).fillRect(x0 + k * (pw + 2), GROUND_Y - 40, pw, 5);
        }
      } else bossSprite.setVisible(false);
      if (!bossOn) for (let i = 0; i < POOL; i++) if (!views[i]) foes[i].setVisible(false);

      // Countdown bar (untimed) under the name.
      if (live && !timed) {
        const frac = Math.max(0, Math.min(1, (run.remaining(tNow) ?? 0) / live.limit));
        const rc: PaletteKey = frac > 0.5 ? 'lime' : frac > 0.25 ? 'amber' : 'magenta';
        g.fillStyle(paletteInt('deep'), 1).fillRect(86, PANEL_Y + 51, 110, 5);
        g.fillStyle(paletteInt(rc), 1).fillRect(86, PANEL_Y + 51, Math.round(110 * frac), 5);
      }

      // Wizard: idle, or casting (charging while a strum is judged, then the cast pose).
      const castAge = t - castPose;
      if (casting || castAge < 320) {
        if (wizard.texture.key !== 'wizard-cast') {
          wizard.anims.stop();
          wizard.setTexture('wizard-cast');
        }
      } else if (wizard.texture.key !== 'wizard-idle') {
        wizard.setTexture('wizard-idle');
        wizard.play('wizard-idle');
      }
      wizard.setAlpha(!ended && t - hurtAt < 600 && Math.floor(t / 60) % 2 === 0 ? 0.35 : 1);
      if (casting) {
        // Charge: a ring of sparks gathers on the staff while the verdict is on its way.
        const u = Math.min(1, (t - castStart) / 700);
        const sx = WIZ_X + 24;
        const sy = GROUND_Y - 44;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + t / 160;
          const rr = 14 * (1 - 0.6 * u);
          g.fillStyle(paletteInt(i % 2 ? 'cyan' : 'foam'), 0.9).fillRect(Math.round(sx + Math.cos(a) * rr), Math.round(sy + Math.sin(a) * rr), 2, 2);
        }
        g.fillStyle(paletteInt('cyan'), 0.35 + 0.4 * u).fillCircle(sx, sy, 3 + 3 * u);
      }

      // Effects.
      for (let i = fx.length - 1; i >= 0; i--) {
        const e = fx[i];
        const age = t - e.born;
        const life = e.kind === 'bolt' ? 220 : 500;
        if (age > life) {
          fx.splice(i, 1);
          continue;
        }
        const u = age / life;
        if (e.kind === 'bolt') {
          const sx = WIZ_X + 24;
          const sy = GROUND_Y - 44;
          const hx = sx + (e.x - sx) * Math.min(1, u * 1.6);
          const hy = sy + (e.y - sy) * Math.min(1, u * 1.6);
          top.lineStyle(e.big ? 3 : 2, paletteInt(e.color), 1 - u * 0.6).lineBetween(sx, sy, hx, hy);
          top.lineStyle(1, paletteInt('foam'), 1 - u).lineBetween(sx, sy - 1, hx, hy - 1);
        } else if (e.kind === 'burst') {
          const n = e.big ? 14 : 8;
          for (let k = 0; k < n; k++) {
            const a = (k / n) * Math.PI * 2;
            const d = (e.big ? 22 : 13) * u + 3;
            top.fillStyle(paletteInt(k % 2 ? e.color : 'foam'), 1 - u).fillRect(Math.round(e.x + Math.cos(a) * d), Math.round(e.y + Math.sin(a) * d), 2, 2);
          }
        } else if (e.kind === 'puff') {
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2 + 0.5;
            top.fillStyle(paletteInt(e.color), 0.8 * (1 - u)).fillRect(Math.round(e.x + Math.cos(a) * (4 + 10 * u)), Math.round(e.y - 6 * u + Math.sin(a) * (4 + 6 * u)), 3, 3);
          }
        } else {
          for (let k = 0; k < 10; k++) {
            const a = (k / 10) * Math.PI * 2;
            top.fillStyle(paletteInt('cyan'), 1 - u).fillRect(Math.round(e.x + Math.cos(a) * (6 + 26 * u)), Math.round(e.y + Math.sin(a) * (6 + 20 * u) + u * u * 14), 3, 2);
          }
        }
      }

      // Message block in the panel and banner over the stage.
      const msgOn = t < msgUntil && !ended;
      lineTexts.forEach((tx, i) => {
        const l = msgOn ? msgLines[i] : undefined;
        placeText(tx, 206, PANEL_Y + 17 + i * 10, l?.text ?? '', { color: l?.color ?? 'foam' });
      });
      if (casting) placeText(lineTexts[0], 206, PANEL_Y + 17, 'LANZANDO HECHIZO', { color: 'cyan' });
      const queue = groups.slice(foeIdx + 1, foeIdx + 3).map((gr) => gr.name);
      placeText(nextText, 206, PANEL_Y + 6, queue.length && !ended ? `LUEGO: ${queue.join('  ')}` : run.stage === 'boss' ? 'JEFE' : '', { color: run.stage === 'boss' ? 'magenta' : 'dim' });
      placeText(chainText, 206, PANEL_Y + 53, run.chain > 0 ? `CAMBIOS x${run.chain}` : '', { color: 'lime' });
      if (live && isBass) drawTab(live.index, t);
      else tabNums.forEach((tx) => tx.setVisible(false));

      const bannerOn = t < bannerUntil && banner !== '';
      if (bannerOn) {
        placeText(msgBig, W / 2, 72, banner, { scale: measureText(banner) * 2 <= 170 ? 2 : 1, color: bannerColor, align: 'center' });
        placeText(msgSub, W / 2, 88, bannerSub, { color: 'foam', align: 'center' });
      } else {
        placeText(msgBig, W / 2, 70, '', { scale: 2 });
        placeText(msgSub, W / 2, 88, '', { color: 'foam', align: 'center' });
      }

      if (pop && t - pop.born < 900) {
        const px = Math.max(measureText(pop.text) / 2 + 4, Math.min(W - measureText(pop.text) / 2 - 4, pop.x));
        placeText(popText, px, pop.y + Math.round((t - pop.born) / 60), pop.text, { color: pop.color, align: 'center' });
        popText.setAlpha(t - pop.born < 600 ? 1 : 1 - (t - pop.born - 600) / 300);
      } else popText.setAlpha(0);

      hooks.wizard = {
        stage: run.stage,
        wave: run.wave,
        waves: WAVES,
        attempt: run.attempt,
        restarts: run.restarts,
        hearts: run.hearts,
        score: run.score,
        combo: run.combo,
        bestCombo: run.bestCombo,
        multiplier: run.multiplier,
        chain: run.chain,
        timed,
        limit: run.limit,
        bpm: run.bpm,
        remaining: live ? run.remaining(tNow) : null,
        casting,
        foe: live ? { name: live.name, steps: live.steps, done: live.done, boss: live.boss, rune: runeGlyph(live.name), midis: groupMidis(groups[live.index]) } : null,
        plates: run.stage === 'boss' ? groups.length - platesBroken : 0,
        platesTotal: run.stage === 'boss' ? groups.length : 0,
        last,
        lastPoints,
        banner: bannerOn ? banner : '',
        over: ended,
      };
    };
    this.events.on(Phaser.Scenes.Events.UPDATE, redraw);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.UPDATE, redraw);
      offs.forEach((f) => f());
      box?.destroy();
      session.dispose();
      hooks.wizard = null;
    });

    // Wave 1 runs on the launcher's session.
    hooks.judged = [];
    wire(session);
    beginGame(this, data, { manual: true });
    spawnFoe(START_DELAY);
    banner = 'OLEADA 1';
    bannerSub = timed ? `TEMPO ${run.bpm} BPM` : `TIEMPO ${run.limit.toFixed(1)} S POR ENEMIGO`;
    bannerColor = 'cyan';
    bannerUntil = this.time.now + 2600;
    showHud();
  }
}
