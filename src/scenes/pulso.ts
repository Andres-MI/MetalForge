import Phaser from 'phaser';
import { drawText, placeText } from '../art/text';
import { addBackground, enterScene, H, profileStore, W } from '../engine/kit';
import { levelLabel } from '../exercises';
import { beginGame } from '../game/scene';
import type { GameSceneData } from '../game/types';
import { fmtMs, JUDGEMENT_STYLE, panel } from '../game/ui';
import type { Judgement } from '../model/exercise';
import { paletteInt, type PaletteKey } from '../ui/palette';

const HIT_X = 64;
const PPB = 52; // pixels per beat
const LANE_Y = 92;
const TRACK_TOP = 62;
const TRACK_H = 60;
const METER_Y = 150;
const METER_W = 160; // ±150 ms
const METER_MS = 150;

interface Mark {
  judgement: Judgement;
  deltaMs: number;
}

/** Pulso: the sober LEARN game for rhythm. The pattern scrolls toward the hit line; play anything on each mark. */
export class PulsoScene extends Phaser.Scene {
  constructor() {
    super('pulso');
  }

  create(data: GameSceneData): void {
    enterScene(this, 'pulso');
    addBackground(this);
    const { session, exercise } = data;
    const store = profileStore(this);
    const marks = new Map<number, Mark>();
    const recent: number[] = [];
    let flashAt = -1e9;
    let flash: Mark | null = null;
    let done = 0;

    // ---- static layout ----
    drawText(this, 8, 8, 'PULSO', { scale: 2, color: 'cyan' });
    drawText(this, W - 8, 8, `NIVEL ${data.level}  ·  ${exercise.bpm} BPM`, { color: 'foam', align: 'right' });
    drawText(this, W - 8, 18, levelLabel('rhythm', data.level), { color: 'dim', align: 'right' });
    const progress = drawText(this, 8, 26, '', { color: 'dim' });
    const bg = this.add.graphics().setDepth(1);
    panel(bg, 4, TRACK_TOP, W - 8, TRACK_H, 'water', 'deep', 0.8);
    const g = this.add.graphics().setDepth(5);
    const count = drawText(this, W / 2, 36, '', { scale: 2, color: 'lime', align: 'center', depth: 6 });
    const verdict = drawText(this, HIT_X, 128, '', { scale: 2, color: 'foam', align: 'center', depth: 6 });
    const detail = drawText(this, HIT_X, 142, '', { color: 'foam', align: 'center', depth: 6 });
    drawText(this, W - 8, METER_Y - 2 - 8, 'PRONTO ←   → TARDE', { color: 'dim', align: 'right', depth: 6 });
    const hint = drawText(this, W / 2, H - 10, '', { color: 'dim', align: 'center', depth: 6 });
    drawText(this, W / 2, 53, 'toca cualquier nota en cada marca', { color: 'dim', align: 'center' });

    const showHint = () =>
      placeText(hint, W / 2, H - 10, `M metrónomo: ${session.metronome.isMuted ? 'no' : 'sí'}    Esc salir`, { color: 'dim', align: 'center' });
    showHint();
    this.input.keyboard?.on('keydown-M', () => {
      session.metronome.setMuted(!session.metronome.isMuted);
      void store.setSettings({ metronomeOn: !session.metronome.isMuted });
      showHint();
    });

    // ---- events ----
    session.on('countIn', (b) => {
      placeText(count, W / 2, 36, `PREPARADOS  ${b}`, { scale: 2, color: b === session.clock.countInBeats ? 'lime' : 'foam', align: 'center' });
    });
    session.on('go', () => placeText(count, W / 2, 36, 'YA', { scale: 2, color: 'lime', align: 'center' }));
    session.on('targetResolved', (r) => {
      const m: Mark = { judgement: r.judgement, deltaMs: r.delta * 1000 };
      marks.set(r.index, m);
      flash = m;
      flashAt = this.time.now;
      done++;
      if (r.judgement !== 'miss') {
        recent.push(m.deltaMs);
        if (recent.length > 8) recent.shift();
      }
      placeText(progress, 8, 26, `${done} / ${exercise.targets.length}`, { color: 'dim' });
    });
    session.on('finished', () => placeText(count, W / 2, 36, 'FIN', { scale: 2, color: 'cyan', align: 'center' }));

    placeText(progress, 8, 26, `0 / ${exercise.targets.length}`, { color: 'dim' });

    // ---- drawing ----
    const redraw = () => {
      const beat = session.beat();
      if (beat >= 1.5) count.setAlpha(session.finished ? 1 : 0);
      g.clear();
      const xOf = (b: number) => Math.round(HIT_X + (b - beat) * PPB);
      const x0 = 8;
      const x1 = W - 8;
      // Beat grid: bar lines tall, beat lines medium, sixteenth dots faint.
      const first = Math.floor(beat - (HIT_X - x0) / PPB) - 1;
      const last = Math.ceil(beat + (x1 - HIT_X) / PPB) + 1;
      for (let b = first; b <= last; b++) {
        if (b < -session.clock.countInBeats) continue;
        for (const q of [0.25, 0.5, 0.75]) {
          const x = xOf(b + q);
          if (x > x0 && x < x1) g.fillStyle(paletteInt('water'), 1).fillRect(x, LANE_Y - 1, 1, 3);
        }
        const x = xOf(b);
        if (x < x0 || x > x1) continue;
        const bar = ((b % 4) + 4) % 4 === 0;
        g.fillStyle(paletteInt(bar ? 'dim' : 'water'), 1).fillRect(x, bar ? TRACK_TOP + 3 : LANE_Y - 10, 1, bar ? TRACK_H - 6 : 20);
      }
      // Lane and hit line.
      g.fillStyle(paletteInt('water'), 1).fillRect(x0, LANE_Y, x1 - x0, 1);
      const pulse = 1 - Math.min(1, Math.max(0, beat - Math.floor(beat)) * 2.5);
      g.fillStyle(paletteInt('cyan'), 0.18 + 0.22 * pulse).fillRect(HIT_X - 5, TRACK_TOP + 2, 11, TRACK_H - 4);
      g.fillStyle(paletteInt('cyan'), 1).fillRect(HIT_X, TRACK_TOP + 2, 1, TRACK_H - 4);
      // Notes.
      exercise.targets.forEach((t, i) => {
        const x = xOf(t.beat ?? 0);
        if (x < x0 - 6 || x > x1 + 6) return;
        const m = marks.get(i);
        const color: PaletteKey = m ? JUDGEMENT_STYLE[m.judgement].color : 'cyan';
        const alpha = m && m.judgement === 'miss' ? 0.5 : 1;
        g.fillStyle(paletteInt('abyss'), 1).fillRect(x - 4, LANE_Y - 4, 9, 9);
        g.fillStyle(paletteInt(color), alpha).fillRect(x - 3, LANE_Y - 3, 7, 7);
        if (!m) g.fillStyle(paletteInt('foam'), 1).fillRect(x - 1, LANE_Y - 1, 3, 3);
        else if (m.judgement !== 'miss') {
          // Where the player actually landed, as a tick under the note.
          const px = Math.round(x + (m.deltaMs / 1000) * (exercise.bpm! / 60) * PPB);
          g.fillStyle(paletteInt(color), 1).fillRect(px, LANE_Y + 6, 1, 7);
        }
      });
      // Timing meter: last hits as dots, ±150 ms.
      const mx = Math.round(W / 2 - METER_W / 2) + 40;
      g.fillStyle(paletteInt('deep'), 0.9).fillRect(mx, METER_Y, METER_W, 8);
      g.lineStyle(1, paletteInt('dim'), 1).strokeRect(mx + 0.5, METER_Y + 0.5, METER_W - 1, 7);
      g.fillStyle(paletteInt('lime'), 0.25).fillRect(mx + METER_W / 2 - 12, METER_Y + 1, 24, 6);
      g.fillStyle(paletteInt('foam'), 1).fillRect(mx + METER_W / 2, METER_Y - 2, 1, 12);
      recent.forEach((ms, k) => {
        const c = Math.max(-METER_MS, Math.min(METER_MS, ms));
        const x = Math.round(mx + METER_W / 2 + (c / METER_MS) * (METER_W / 2 - 3));
        g.fillStyle(paletteInt(Math.abs(ms) <= 90 ? 'lime' : ms < 0 ? 'amber' : 'magenta'), 0.35 + 0.65 * ((k + 1) / recent.length)).fillRect(x - 1, METER_Y + 1, 3, 6);
      });
      // Feedback on the last hit, for about a second.
      const age = this.time.now - flashAt;
      if (flash && age < 1100) {
        const st = JUDGEMENT_STYLE[flash.judgement];
        const a = age < 800 ? 1 : 1 - (age - 800) / 300;
        placeText(verdict, HIT_X, 128, st.label, { scale: 2, color: st.color, align: 'center', alpha: a });
        verdict.setAlpha(a);
        detail.setAlpha(a);
        placeText(detail, HIT_X, 146, flash.judgement === 'miss' ? 'no se oyó nada' : fmtMs(flash.deltaMs), { color: st.color, align: 'center' });
        detail.setAlpha(a);
      } else {
        verdict.setAlpha(0);
        detail.setAlpha(0);
      }
    };
    this.events.on(Phaser.Scenes.Events.UPDATE, redraw);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(Phaser.Scenes.Events.UPDATE, redraw));

    beginGame(this, data);
  }
}
