/**
 * Placement test ("Sondeo de nivel"): a neutral screen that runs one small exercise at a time through the usual
 * GameSession and Judge, and at the end unlocks what the player already masters (see src/course/placement.ts).
 *
 *  intro   -> "Empezar desde cero" (default) or "Hacer el sondeo" (tune and calibrate first if needed)
 *  round   -> one probe: untimed ones show what to play and wait; the rhythm probe runs a bar lane against the clock
 *  summary -> what each skill reached and which modules opened
 */
import Phaser from 'phaser';
import { drawText, placeText } from '../art/text';
import { describeTarget } from '../course/describe';
import { nextProbe, placementFromResults, probeProgress, skippedPlacement, type ProbeResult } from '../course/placement';
import { load, recordPlacement } from '../course/service';
import { addBackground, enterScene, H, profileStore, W } from '../engine/kit';
import { hooks, type PlacementHook } from '../engine/hooks';
import { generate, levelLabel } from '../exercises';
import { makeFakeControl } from '../game/fakePlayer';
import { CALIBRATION_SKIPPED, openSession } from '../game/launch';
import type { GameSession } from '../game/session';
import { panel } from '../game/ui';
import { noteName } from '../model/instrument';
import { paletteInt, type PaletteKey } from '../ui/palette';
import { addButtons } from './buttons';
import { fit } from './flow';

interface PlacementData {
  stage?: 'intro' | 'round' | 'summary';
  done?: ProbeResult[];
}

const SKILL_ES: Record<string, string> = { frets: 'Trastes', strings: 'Cuerdas', chords: 'Acordes', scales: 'Escalas', rhythm: 'Ritmo' };
const SKILL_COLOR: Record<string, PaletteKey> = { frets: 'lime', strings: 'blue', chords: 'amber', scales: 'violet', rhythm: 'cyan' };
/** Seconds an untimed probe waits for a note before it counts as not played. */
const WAIT_S = 12;

export class PlacementScene extends Phaser.Scene {
  private session: GameSession | null = null;
  private lines: string[] = [];
  private done: ProbeResult[] = [];
  private hook!: PlacementHook;

  constructor() {
    super('placement');
  }

  create(data: PlacementData): void {
    enterScene(this, 'placement');
    addBackground(this);
    this.lines = [];
    this.session = null;
    this.done = data.done ?? [];
    this.hook = { stage: data.stage ?? 'intro', probe: null, done: this.done.map((d) => ({ skill: d.skill, level: d.level, stars: d.stars })), target: null, unlocked: [], lines: this.lines };
    hooks.placement = this.hook;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.session?.dispose();
      this.session = null;
      hooks.fake = null;
    });
    const stage = data.stage ?? 'intro';
    if (stage === 'intro') this.intro();
    else if (stage === 'round') void this.round();
    else void this.summary();
  }

  private say(x: number, y: number, text: string, opts: Parameters<typeof drawText>[4] = {}): Phaser.GameObjects.BitmapText {
    this.lines.push(text);
    return drawText(this, x, y, text, opts);
  }

  // ---- intro ------------------------------------------------------------------------------------------------
  private intro(): void {
    const store = profileStore(this);
    this.say(W / 2, 8, 'SONDEO DE NIVEL', { scale: 2, color: 'magenta', align: 'center' });
    this.say(W / 2, 28, 'Unos 5 minutos para saltarte lo que ya sabes.', { color: 'foam', align: 'center' });
    const rows = [
      ['Trastes en una cuerda', 'lime'],
      ['Cambios de cuerda', 'blue'],
      [store.profile.instrument === 'guitar' ? 'Dos acordes' : 'Raíz, quinta y octava', 'amber'],
      ['Una escala corta', 'violet'],
      ['Un ritmo corto', 'cyan'],
    ] as const;
    rows.forEach(([t, c], i) => {
      const y = 46 + i * 11;
      this.add.rectangle(92, y + 3, 4, 4, paletteInt(c)).setOrigin(0, 0.5);
      this.say(102, y, t, { color: 'foam' });
    });
    this.say(W / 2, 104, 'No es un examen: lo que falles no cuenta en contra.', { color: 'dim', align: 'center' });
    this.say(W / 2, 116, 'Afina (T) y calibra (C) antes si no lo has hecho.', { color: 'amber', align: 'center' });
    const start = () => void this.begin();
    const zero = () => {
      void recordPlacement(store, skippedPlacement(Date.now())).then(() => this.scene.start('hub'));
    };
    addButtons(this, [{ label: 'Empezar desde cero', id: 'zero', act: zero }, { label: 'Hacer el sondeo', id: 'test', act: start }], H - 30, { w: 120, h: 18, gap: 8 });
    drawText(this, W / 2, H - 9, '←→ elegir  Enter aceptar  T afinar  C calibrar', { color: 'dim', align: 'center' });
    const kb = this.input.keyboard!;
    kb.on('keydown-T', () => this.scene.start('tuner'));
    kb.on('keydown-C', () => this.scene.start('calibration', { then: { scene: 'placement', data: { stage: 'intro' } } }));
    kb.on('keydown-ESC', zero);
  }

  private async begin(): Promise<void> {
    const store = profileStore(this);
    const calibrated = store.profile.settings.latencyOffset !== undefined;
    if (!calibrated && !hooks.useFakeInput && !this.registry.get(CALIBRATION_SKIPPED)) {
      this.scene.start('calibration', { then: { scene: 'placement', data: { stage: 'round', done: [] } } });
      return;
    }
    this.scene.start('placement', { stage: 'round', done: [] });
  }

  // ---- one probe --------------------------------------------------------------------------------------------
  private header(done: ProbeResult[], skill: string, level: number): void {
    const { index, max } = probeProgress(done);
    this.say(W / 2, 6, `SONDEO ${index} DE HASTA ${max}`, { color: 'magenta', align: 'center' });
    this.say(W / 2, 17, `${SKILL_ES[skill]} · nivel ${level} · ${fit(levelLabel(skill as never, level), 150)}`, { color: SKILL_COLOR[skill], align: 'center' });
    const g = this.add.graphics();
    for (let i = 0; i < max; i++) {
      const r = done[i];
      g.fillStyle(paletteInt(r ? (r.stars >= 2 ? 'lime' : 'amber') : i === done.length ? 'cyan' : 'dim'), r || i === done.length ? 1 : 0.5).fillRect(W / 2 - max * 5 + i * 10, 28, 8, 3);
    }
  }

  private async round(): Promise<void> {
    const store = profileStore(this);
    const probe = nextProbe(this.done);
    if (!probe) {
      this.scene.start('placement', { stage: 'summary', done: this.done });
      return;
    }
    const instrument = store.profile.instrument ?? 'guitar';
    const exercise = generate(probe.skill, { instrument, level: probe.level, seed: hooks.useFakeInput ? 1 : Math.floor(Math.random() * 1_000_000), length: probe.length });
    this.header(this.done, probe.skill, probe.level);
    const status = drawText(this, W / 2, 140, 'Abriendo la entrada de audio', { color: 'lime', align: 'center' });
    await new Promise((r) => setTimeout(r, 0)); // the scene is still being created: let it start running first
    const opened = await openSession(this, exercise, true);
    if (opened === null || !this.scene.isActive()) return;
    if (typeof opened === 'string') {
      placeText(status, W / 2, 140, opened, { color: 'magenta', align: 'center' });
      drawText(this, W / 2, H - 9, 'Esc volver al salón', { color: 'dim', align: 'center' });
      this.input.keyboard!.on('keydown-ESC', () => this.scene.start('hub'));
      return;
    }
    status.destroy();
    const { session, fake } = opened;
    this.session = session;
    hooks.fake = fake ? makeFakeControl(session, fake) : null;
    hooks.judged = [];
    this.hook.stage = 'round';
    this.hook.probe = { skill: probe.skill, level: probe.level, timed: exercise.timed };

    const total = exercise.targets.length;
    const results: ('hit' | 'early' | 'late' | 'wrong' | 'miss' | null)[] = Array(total).fill(null);
    const big = drawText(this, W / 2, 56, '', { scale: 3, color: 'foam', align: 'center' });
    const small = drawText(this, W / 2, 84, '', { color: 'dim', align: 'center' });
    const msg = drawText(this, W / 2, 98, '', { color: 'foam', align: 'center' });
    const dots = this.add.graphics();
    const lane = this.add.graphics();
    const countText = drawText(this, W / 2, 120, '', { scale: 2, color: 'cyan', align: 'center' });
    drawText(this, W / 2, H - 9, exercise.timed ? 'Toca en el golpe   Esc salón' : 'S saltar   Esc salón', { color: 'dim', align: 'center' });
    this.input.keyboard!.on('keydown-ESC', () => this.scene.start('hub'));
    this.input.keyboard!.on('keydown-S', () => {
      if (!exercise.timed) session.skipCurrent();
    });

    const colorOf = (j: (typeof results)[number]): PaletteKey => (j === 'hit' ? 'lime' : j === 'early' || j === 'late' ? 'amber' : j ? 'magenta' : 'dim');
    const drawDots = (current: number) => {
      dots.clear();
      const w = 10;
      const x0 = Math.round(W / 2 - (total * w) / 2);
      results.forEach((r, i) => dots.fillStyle(paletteInt(i === current && !r ? 'cyan' : colorOf(r)), r || i === current ? 1 : 0.5).fillRect(x0 + i * w, 128, 7, 4));
    };
    let shownIndex = -1;
    let targetSince = session.input.now();
    const show = (i: number) => {
      if (i === shownIndex || i >= total) return;
      shownIndex = i;
      targetSince = session.input.now();
      const info = describeTarget(exercise, i);
      placeText(big, W / 2, 56, info.big, { scale: info.big.length > 9 ? 2 : 3, color: SKILL_COLOR[probe.skill], align: 'center' });
      placeText(small, W / 2, info.big.length > 9 ? 78 : 84, fit(info.small, W - 20), { color: 'foam', align: 'center' });
      this.lines.push(info.big, info.small);
      this.hook.target = { midis: info.midis, chord: info.chord };
      placeText(msg, W / 2, 98, '', { color: 'foam', align: 'center' });
    };

    session.on('countIn', (b) => placeText(countText, W / 2, 120, String(b), { scale: 2, color: 'cyan', align: 'center' }));
    session.on('go', () => placeText(countText, W / 2, 120, '', { scale: 2, color: 'cyan', align: 'center' }));
    session.on('targetResolved', (r) => {
      results[r.index] = r.judgement;
      hooks.judged.push({ index: r.index, judgement: r.judgement, deltaMs: Math.round(r.delta * 1000) });
      if (r.judgement === 'miss') placeText(msg, W / 2, 98, 'Sin tocar', { color: 'dim', align: 'center' });
      drawDots(session.currentIndex);
    });
    session.on('wrongAttempt', (r) => {
      const heard = r.heard?.[0];
      placeText(msg, W / 2, 98, heard !== undefined ? `Sonó ${noteName(heard)}: prueba otra vez` : 'Otra nota: prueba otra vez', { color: 'amber', align: 'center' });
    });
    let finished = false;
    session.on('finished', (summary) => {
      if (finished) return;
      finished = true;
      const stars = summary.stars;
      const passed = stars >= 2;
      this.hook.target = null;
      this.hook.done = [...this.done, { skill: probe.skill, level: probe.level, stars }].map((d) => ({ skill: d.skill, level: d.level, stars: d.stars }));
      placeText(big, W / 2, 56, passed ? 'Superado' : 'De momento no', { scale: 2, color: passed ? 'lime' : 'amber', align: 'center' });
      placeText(small, W / 2, 78, '', { color: 'dim', align: 'center' });
      placeText(msg, W / 2, 98, `${Math.round(summary.accuracy * 100)} % de precisión`, { color: 'foam', align: 'center' });
      this.time.delayedCall(1100, () => {
        if (this.scene.isActive()) this.scene.start('placement', { stage: 'round', done: [...this.done, { skill: probe.skill, level: probe.level, stars }] });
      });
    });

    const BEAT_PX = 46;
    const HIT_X = 70;
    const tick = () => {
      if (!this.session) return;
      if (exercise.timed) {
        const beat = session.beat();
        lane.clear();
        panel(lane, 20, 78, W - 40, 36, 'water', 'deep', 0.8);
        lane.fillStyle(paletteInt('foam'), 1).fillRect(HIT_X, 74, 1, 44);
        exercise.targets.forEach((t, i) => {
          const x = HIT_X + ((t.beat ?? 0) - beat) * BEAT_PX;
          if (x < 22 || x > W - 22) return;
          lane.fillStyle(paletteInt(results[i] ? colorOf(results[i]) : 'cyan'), 1).fillRect(Math.round(x) - 3, 92, 7, 7);
        });
        placeText(big, W / 2, 50, 'Toca en cada golpe', { scale: 1, color: 'foam', align: 'center' });
        drawDots(-1);
      } else {
        const i = session.currentIndex;
        show(i);
        drawDots(i);
        if (!session.finished && session.input.now() - targetSince > WAIT_S) {
          targetSince = session.input.now();
          session.skipCurrent();
        }
      }
    };
    this.events.on(Phaser.Scenes.Events.UPDATE, tick);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(Phaser.Scenes.Events.UPDATE, tick));
    session.start();
    if (!exercise.timed) show(0);
  }

  // ---- summary ----------------------------------------------------------------------------------------------
  private async summary(): Promise<void> {
    const store = profileStore(this);
    const placement = placementFromResults(this.done, Date.now());
    const change = await recordPlacement(store, placement);
    if (!this.scene.isActive()) return;
    this.say(W / 2, 8, 'SONDEO TERMINADO', { scale: 2, color: 'magenta', align: 'center' });
    let y = 30;
    for (const skill of ['frets', 'strings', 'chords', 'scales', 'rhythm']) {
      const lvl = placement.skills[skill];
      if (lvl === undefined) continue;
      this.say(60, y, SKILL_ES[skill], { color: SKILL_COLOR[skill] });
      this.say(W - 60, y, lvl > 0 ? `llegas al nivel ${lvl}` : 'desde el principio', { color: lvl > 0 ? 'foam' : 'dim', align: 'right' });
      y += 11;
    }
    y += 4;
    this.hook.unlocked = change.unlocked.map((m) => m.id);
    if (change.unlocked.length === 0) this.say(W / 2, y, 'Ningún módulo nuevo: empiezas desde el principio.', { color: 'foam', align: 'center' });
    for (const m of change.unlocked) {
      this.say(W / 2, y, `¡Módulo ${m.title} desbloqueado!`, { color: 'lime', align: 'center' });
      y += 11;
    }
    const l = await load(store);
    if (!this.scene.isActive()) return;
    if (l.state.next) {
      const lvl = l.state.next.level ? ` · nivel ${l.state.next.level}` : '';
      this.say(W / 2, H - 42, fit(`Empiezas en: ${l.state.next.label}${lvl}`, W - 16), { color: 'cyan', align: 'center' });
    }
    this.hook.stage = 'summary';
    addButtons(this, [{ label: 'Ir al curso', id: 'course', act: () => this.scene.start('course') }, { label: 'Salón', id: 'hub', act: () => this.scene.start('hub') }], H - 28, { w: 100, gap: 8 });
  }
}
