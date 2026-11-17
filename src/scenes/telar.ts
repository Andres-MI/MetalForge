import Phaser from 'phaser';
import { drawText, placeText } from '../art/text';
import { addBackground, enterScene, H, profileStore, W } from '../engine/kit';
import { hooks } from '../engine/hooks';
import { levelLabel } from '../exercises';
import { beginGame } from '../game/scene';
import { fretWords, skipText, stringLabel, targetPositions, wrongHint, type WrongHint } from '../game/strings';
import type { GameSceneData } from '../game/types';
import { fmtMs, JUDGEMENT_STYLE, panel } from '../game/ui';
import type { Judgement } from '../model/exercise';
import { INSTRUMENTS } from '../model/instrument';
import { paletteInt, type PaletteKey } from '../ui/palette';
import { arcPoints, playHint, stringKey } from './stringsView';

const PANEL = { x: 4, y: 40, w: W - 8, h: 100 };
const LEFT = 64; // threads start here; labels live to the left
const RIGHT = W - 8;
const CUR_X = 120; // untimed: where the knot that waits sits
const GAP = 30; // untimed: pixels between knots
const HIT_X = 104; // timed: hit line
const PPB = 56; // timed: pixels per beat
const METER = { x: 200, y: 147, w: 112 };
const METER_MS = 150;

interface Mark {
  judgement: Judgement;
  wrongAttempts: number;
  deltaMs: number;
}

/**
 * Telar: the sober LEARN game for strings. The strings are threads (lowest-pitched at the bottom, each in its
 * fixed colour); the sequence is a row of knots on them. Untimed levels wait for the player (a wrong note shows
 * the thread that sounded and an arrow toward the right one; S skips, H plays the target). Timed levels scroll
 * the pattern against the metronome with early/on time/late feedback and no fail state.
 */
export class TelarScene extends Phaser.Scene {
  constructor() {
    super('telar');
  }

  create(data: GameSceneData): void {
    enterScene(this, 'telar');
    addBackground(this);
    const { session, exercise } = data;
    const store = profileStore(this);
    const inst = INSTRUMENTS[exercise.instrument];
    const n = inst.openStrings.length;
    const pos = targetPositions(exercise);
    const timed = exercise.timed;
    const total = exercise.targets.length;
    const fixedFret = pos.every((p) => p.fret === pos[0].fret) && pos[0].fret > 0 ? pos[0].fret : 0;
    const showFrets = pos.some((p) => p.fret > 0);
    const sp = n >= 6 ? 16 : n === 5 ? 19 : 22;
    const yBottom = Math.round(PANEL.y + PANEL.h / 2 + 4 + ((n - 1) * sp) / 2);
    const yOf = (s: number) => yBottom - s * sp;
    const marks = new Map<number, Mark>();
    const recent: number[] = [];
    let shown = 0;
    let wrong: { hint: WrongHint; at: number; target: number } | null = null;
    let flash: Mark | null = null;
    let flashAt = -1e9;
    let hintAt = -1e9;
    let done = 0;
    let finished = false;

    // ---- static layout ----
    drawText(this, 8, 6, 'TELAR', { scale: 2, color: 'blue' });
    drawText(this, W - 8, 8, timed ? `NIVEL ${data.level}  ·  ${exercise.bpm} BPM` : `NIVEL ${data.level}`, { color: 'foam', align: 'right' });
    drawText(this, W - 8, 18, levelLabel('strings', data.level, exercise.instrument), { color: 'dim', align: 'right' });
    const progress = drawText(this, 8, 26, '', { color: 'dim' });
    const back = this.add.graphics().setDepth(1);
    panel(back, PANEL.x, PANEL.y, PANEL.w, PANEL.h, 'water', 'deep', 0.8);
    const g = this.add.graphics().setDepth(4);
    const count = drawText(this, W / 2, 22, '', { scale: 2, color: 'lime', align: 'center', depth: 8 });
    const info = drawText(this, 8, 146, '', { color: 'foam', depth: 8 });
    const info2 = drawText(this, 8, 157, '', { color: 'dim', depth: 8 });
    const verdict = drawText(this, HIT_X, 44, '', { color: 'foam', align: 'center', depth: 8 });
    const keys = drawText(this, W / 2, H - 10, '', { color: 'dim', align: 'center', depth: 8 });
    const weaver = this.add.sprite(0, 0, 'weaver').setDepth(7).setVisible(false);
    weaver.play('weaver');
    for (let s = 0; s < n; s++) {
      const fixed = fixedFret ? ` tr.${fixedFret}` : '';
      drawText(this, 8, yOf(s) - 3, stringLabel(exercise.instrument, s) + fixed, { color: stringKey(s), depth: 3 });
    }
    // Fret numbers inside the knots (only when the level uses fretted notes).
    const digits = showFrets ? pos.map((p) => drawText(this, 0, 0, String(p.fret), { color: 'abyss', align: 'center', depth: 6 })) : [];

    const showKeys = () =>
      placeText(keys, W / 2, H - 10, timed ? `H oír la nota   M metrónomo: ${session.metronome.isMuted ? 'no' : 'sí'}   Esc salir` : 'H oír la nota   S saltar esta nota   Esc salir', { color: 'dim', align: 'center' });
    showKeys();
    const kb = this.input.keyboard;
    kb?.on('keydown-H', () => {
      const i = Math.min(total - 1, Math.max(0, timed ? session.exercise.targets.findIndex((_, k) => !marks.has(k)) : session.currentIndex));
      const t = exercise.targets[i].kind;
      if (t.type === 'note') {
        playHint(t.midi, session.input.context);
        hintAt = this.time.now;
      }
    });
    if (timed) {
      kb?.on('keydown-M', () => {
        session.metronome.setMuted(!session.metronome.isMuted);
        void store.setSettings({ metronomeOn: !session.metronome.isMuted });
        showKeys();
      });
    } else {
      kb?.on('keydown-S', () => session.skipCurrent());
    }

    // ---- events ----
    if (timed) session.on('countIn', (b) => placeText(count, W / 2, 22, `PREPARADOS  ${b}`, { scale: 2, color: b === session.clock.countInBeats ? 'lime' : 'foam', align: 'center' }));
    if (timed) session.on('go', () => placeText(count, W / 2, 22, 'YA', { scale: 2, color: 'lime', align: 'center' }));
    const hintFor = (idx: number, midi: number): WrongHint => wrongHint(exercise.instrument, data.level, pos[idx], midi);
    session.on('wrongAttempt', (r) => {
      if (r.heard?.length) wrong = { hint: hintFor(r.index, r.heard[0]), at: this.time.now, target: pos[r.index].string };
    });
    session.on('targetResolved', (r) => {
      const m: Mark = { judgement: r.judgement, wrongAttempts: r.wrongAttempts, deltaMs: r.delta * 1000 };
      marks.set(r.index, m);
      done++;
      placeText(progress, 8, 26, `${done} / ${total}`, { color: 'dim' });
      if (timed) {
        flash = m;
        flashAt = this.time.now;
        if (r.judgement !== 'miss' && r.judgement !== 'wrong') {
          recent.push(m.deltaMs);
          if (recent.length > 8) recent.shift();
        }
        if (r.judgement === 'wrong' && r.heard?.length) wrong = { hint: hintFor(r.index, r.heard[0]), at: this.time.now, target: pos[r.index].string };
      } else wrong = null;
    });
    session.on('finished', () => {
      finished = true;
      if (timed) placeText(count, W / 2, 22, 'FIN', { scale: 2, color: 'cyan', align: 'center' });
    });
    placeText(progress, 8, 26, `0 / ${total}`, { color: 'dim' });

    // ---- drawing ----
    const dot = (x: number, y: number, key: PaletteKey, alpha: number, size = 1) => {
      if (x < LEFT || x > RIGHT) return;
      g.fillStyle(paletteInt(key), alpha).fillRect(x, y, size, size);
    };
    const line = (x0: number, y0: number, x1: number, y1: number, key: PaletteKey, alpha: number, every = 1) => {
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let k = 0; k <= steps; k += every) dot(Math.round(x0 + ((x1 - x0) * k) / (steps || 1)), Math.round(y0 + ((y1 - y0) * k) / (steps || 1)), key, alpha);
    };

    const redraw = () => {
      const beat = session.beat();
      g.clear();
      back.clear();
      panel(back, PANEL.x, PANEL.y, PANEL.w, PANEL.h, 'water', 'deep', 0.8);
      if (beat >= 1.5 || (!timed && beat >= 0.5)) count.setAlpha(finished ? 1 : 0);
      const cursor = finished ? total : timed ? exercise.targets.findIndex((_, k) => !marks.has(k)) : session.currentIndex;
      const cur = cursor < 0 ? total : cursor;
      shown += (cur - shown) * 0.22;
      if (Math.abs(cur - shown) < 0.01) shown = cur;
      const xOf = (i: number) => (timed ? Math.round(HIT_X + ((exercise.targets[i].beat ?? 0) - beat) * PPB) : Math.round(CUR_X + (i - shown) * GAP));
      const targetS = cur < total ? pos[cur].string : -1;

      // Beat marks (timed): bar lines and beats along the bottom of the panel.
      if (timed) {
        const first = Math.floor(beat - (HIT_X - LEFT) / PPB) - 1;
        const last = Math.ceil(beat + (RIGHT - HIT_X) / PPB) + 1;
        for (let b = first; b <= last; b++) {
          if (b < -session.clock.countInBeats) continue;
          const x = Math.round(HIT_X + (b - beat) * PPB);
          const bar = ((b % 4) + 4) % 4 === 0;
          dot(x, PANEL.y + PANEL.h - (bar ? 7 : 4), bar ? 'dim' : 'water', 1, 1);
          if (bar) g.fillStyle(paletteInt('dim'), 0.5).fillRect(Math.max(LEFT, Math.min(RIGHT, x)), PANEL.y + PANEL.h - 7, x >= LEFT && x <= RIGHT ? 1 : 0, 6);
        }
        const pulse = 1 - Math.min(1, Math.max(0, beat - Math.floor(beat)) * 2.5);
        g.fillStyle(paletteInt('cyan'), 0.12 + 0.18 * pulse).fillRect(HIT_X - 6, PANEL.y + 3, 13, PANEL.h - 6);
        g.fillStyle(paletteInt('cyan'), 1).fillRect(HIT_X, PANEL.y + 3, 1, PANEL.h - 6);
      }

      // Threads.
      for (let s = 0; s < n; s++) {
        const y = yOf(s);
        const key = stringKey(s);
        const on = s === targetS;
        g.fillStyle(paletteInt(key), on ? 1 : 0.5).fillRect(LEFT, y, RIGHT - LEFT, 1);
        if (on) g.fillStyle(paletteInt(key), 0.35).fillRect(LEFT, y - 1, RIGHT - LEFT, 3);
      }

      // Connectors between consecutive knots; skips are arcs hopping over the skipped threads.
      for (let i = 1; i < total; i++) {
        const x0 = xOf(i - 1);
        const x1 = xOf(i);
        if (x1 < LEFT - 4 || x0 > RIGHT + 4) continue;
        const y0 = yOf(pos[i - 1].string);
        const y1 = yOf(pos[i].string);
        const past = i < cur;
        if (Math.abs(pos[i].string - pos[i - 1].string) >= 2) {
          const pts = arcPoints(x0, y0, x1, y1, 7 + 2 * Math.abs(pos[i].string - pos[i - 1].string));
          const a = past ? 0.3 : 0.95;
          for (const p of pts) {
            const y = Math.max(PANEL.y + 2, p.y);
            dot(p.x, y, 'foam', a, 2);
          }
          const tip = pts[pts.length - 1];
          const before = pts[pts.length - 3];
          // Arrow head where the arc lands.
          const ax = Math.sign(tip.x - before.x);
          const ay = Math.sign(tip.y - before.y);
          dot(tip.x - ax * 3, tip.y - ay * 3 + 2, 'foam', a, 2);
          dot(tip.x - ax * 4, tip.y - ay * 4 - 2, 'foam', a, 2);
        } else line(x0, y0, x1, y1, 'dim', past ? 0.35 : 0.8, 2);
      }

      // Knots.
      let curX = -100;
      for (let i = 0; i < total; i++) {
        const x = xOf(i);
        const visible = x >= LEFT - 4 && x <= RIGHT + 4;
        if (digits[i]) digits[i].setVisible(visible && x >= LEFT && x <= RIGHT);
        if (!visible) continue;
        const y = yOf(pos[i].string);
        const key = stringKey(pos[i].string);
        const m = marks.get(i);
        const isCur = i === cur;
        if (isCur) curX = x;
        const ring: PaletteKey = m
          ? timed
            ? JUDGEMENT_STYLE[m.judgement].color
            : m.judgement === 'miss'
              ? 'dim'
              : m.wrongAttempts > 0
                ? 'amber'
                : 'lime'
          : isCur
            ? 'foam'
            : 'abyss';
        const faded = !!m && m.judgement === 'miss';
        const alpha = m ? (faded ? 0.35 : 0.6) : 1;
        // Octagon-ish knot: border (ring) then fill (string colour).
        g.fillStyle(paletteInt(ring), 1).fillRect(x - 5, y - 4, 11, 9).fillRect(x - 4, y - 5, 9, 11);
        g.fillStyle(paletteInt('abyss'), 1).fillRect(x - 4, y - 3, 9, 7).fillRect(x - 3, y - 4, 7, 9);
        g.fillStyle(paletteInt(key), alpha).fillRect(x - 4, y - 3, 9, 7).fillRect(x - 3, y - 4, 7, 9);
        if (isCur && !finished) {
          const k = 0.5 + 0.5 * Math.sin(this.time.now / 160);
          g.lineStyle(1, paletteInt('foam'), 0.4 + 0.5 * k).strokeRect(x - 8.5, y - 8.5, 17, 17);
          g.lineStyle(1, paletteInt(key), 0.25 + 0.3 * k).strokeRect(x - 10.5, y - 10.5, 21, 21);
        }
        if (digits[i]) placeText(digits[i], x, y - 3, String(pos[i].fret), { color: 'abyss', align: 'center' });
      }

      // Wrong note: the thread that was heard and an arrow to the right one.
      const showWrong = wrong && (timed ? this.time.now - wrong.at < 1500 : true);
      weaver.setVisible(false);
      let hintText = '';
      if (wrong && showWrong) {
        const hs = wrong.hint.heardString;
        const mx = timed ? HIT_X : curX > 0 ? curX : CUR_X;
        const ts = wrong.target;
        hintText = wrong.hint.text;
        if (hs !== null && ts >= 0) {
          const hy = yOf(hs);
          weaver.setVisible(true).setPosition(mx, hy);
          g.lineStyle(1, paletteInt('violet'), 1).strokeRect(mx - 8.5, hy - 8.5, 17, 17);
          if (hs !== ts) {
            const ty = yOf(ts);
            const ax = mx + 16;
            const dir = Math.sign(ty - hy);
            g.fillStyle(paletteInt('amber'), 1).fillRect(ax, Math.min(hy, ty), 2, Math.abs(ty - hy));
            g.fillRect(ax - 3, ty - dir * 4, 8, 2);
            g.fillRect(ax - 1, ty - dir * 6, 4, 2);
            g.fillRect(ax - 3, hy, 8, 1);
          }
        }
      }

      // Texts.
      if (finished) placeText(info, 8, 146, 'Telar completado', { color: 'cyan' });
      else if (cur < total) {
        const p = pos[cur];
        placeText(info, 8, 146, `Toca la ${stringLabel(exercise.instrument, p.string)} ${fretWords(p.fret)}`, { color: stringKey(p.string) });
        const sk = cur > 0 ? skipText(pos[cur - 1].string, p.string) : null;
        const note = this.time.now - hintAt < 1600 ? 'Escucha la nota de ejemplo' : '';
        placeText(info2, 8, 157, hintText || note || sk || (timed ? 'Sin prisa: solo se mide si vas pronto o tarde' : 'Sin prisa: el hilo espera'), { color: hintText ? 'amber' : note ? 'cyan' : sk ? 'foam' : 'dim' });
      }

      // Timed feedback: verdict above the hit line and a meter of the last hits.
      if (timed) {
        g.fillStyle(paletteInt('deep'), 0.9).fillRect(METER.x, METER.y, METER.w, 8);
        g.lineStyle(1, paletteInt('dim'), 1).strokeRect(METER.x + 0.5, METER.y + 0.5, METER.w - 1, 7);
        g.fillStyle(paletteInt('lime'), 0.25).fillRect(METER.x + METER.w / 2 - 9, METER.y + 1, 18, 6);
        g.fillStyle(paletteInt('foam'), 1).fillRect(METER.x + METER.w / 2, METER.y - 2, 1, 12);
        recent.forEach((ms, k) => {
          const c = Math.max(-METER_MS, Math.min(METER_MS, ms));
          const x = Math.round(METER.x + METER.w / 2 + (c / METER_MS) * (METER.w / 2 - 3));
          g.fillStyle(paletteInt(Math.abs(ms) <= 90 ? 'lime' : ms < 0 ? 'amber' : 'magenta'), 0.35 + 0.65 * ((k + 1) / recent.length)).fillRect(x - 1, METER.y + 1, 3, 6);
        });
        const age = this.time.now - flashAt;
        if (flash && age < 1100) {
          const st = JUDGEMENT_STYLE[flash.judgement];
          placeText(verdict, HIT_X, 44, flash.judgement === 'miss' ? st.label : `${st.label}  ${fmtMs(flash.deltaMs)}`, { color: st.color, align: 'center' });
          verdict.setAlpha(age < 800 ? 1 : 1 - (age - 800) / 300);
        } else verdict.setAlpha(0);
      }

      hooks.telar = {
        current: cur,
        strings: pos.map((p) => p.string),
        midis: exercise.targets.map((t) => (t.kind.type === 'note' ? t.kind.midi : -1)),
        frets: pos.map((p) => p.fret),
        skips: pos.map((p, i) => i > 0 && Math.abs(p.string - pos[i - 1].string) >= 2),
        heardString: wrong?.hint.heardString ?? -1,
        hint: hintText,
        threadY: Array.from({ length: n }, (_, s) => yOf(s)),
        over: finished,
      };
    };
    this.events.on(Phaser.Scenes.Events.UPDATE, redraw);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.UPDATE, redraw);
      hooks.telar = null;
    });

    beginGame(this, data);
  }
}
