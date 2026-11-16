import Phaser from 'phaser';
import { drawText, placeText } from '../art/text';
import { addBackground, enterScene, H, W } from '../engine/kit';
import { hooks } from '../engine/hooks';
import { fretsZone, levelLabel } from '../exercises';
import { boardLayout, directionHint, playedOnBoard, rowY, slotX, type BoardLayout } from '../game/frets/board';
import { hearNote } from '../game/hearNote';
import { beginGame } from '../game/scene';
import type { GameSceneData } from '../game/types';
import { GAMES } from '../game/registry';
import { INSTRUMENTS, noteName } from '../model/instrument';
import { paletteInt, type PaletteKey } from '../ui/palette';
import { cell, drawBoard, ring, setTextColor, stringKey, type BoardArt } from './fretsDraw';

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  color: PaletteKey;
}

/**
 * Luciérnagas: the sober LEARN game for frets. A firefly lights up on a fret of the board and waits: no clock, no
 * penalty. Play that fret and it is caught; play another and the board shows where that note is and which way to go.
 * S skips a target, H plays the target so you hear it.
 */
export class FirefliesScene extends Phaser.Scene {
  constructor() {
    super('fireflies');
  }

  create(data: GameSceneData): void {
    enterScene(this, 'fireflies');
    addBackground(this);
    const { session, exercise } = data;
    const def = GAMES[data.params.gameId];
    const inst = INSTRUMENTS[exercise.instrument];
    const layout: BoardLayout = boardLayout(fretsZone(inst.id, data.level, data.params.seed ?? 1));
    const art: BoardArt = drawBoard(this, layout);
    const total = exercise.targets.length;
    const targetPos = (i: number) => {
      const k = exercise.targets[Math.min(i, total - 1)].kind;
      if (k.type !== 'note' || !k.pos) throw new Error('Luciérnagas needs note targets with a position');
      return { pos: k.pos, midi: k.midi };
    };

    let index = 0;
    let caught = 0;
    let skipped = 0;
    let appearAt = this.time.now;
    let wrong: { midi: number; fret: number | null; hint: string; name: string } | null = null;
    let showName = false;
    let nameShown = -1;
    let over = false;
    const sparks: Spark[] = [];

    // ---- static layout ----
    drawText(this, 8, 8, 'LUCIÉRNAGAS', { scale: 2, color: def.accent, depth: 10 });
    drawText(this, W - 8, 8, `NIVEL ${data.level}`, { color: 'foam', align: 'right', depth: 10 });
    drawText(this, W - 8, 18, levelLabel('frets', data.level), { color: 'dim', align: 'right', depth: 10 });
    const progress = drawText(this, 8, 26, '', { color: 'dim', depth: 10 });
    drawText(this, W / 2, 40, 'Toca el traste donde brilla la luz', { color: 'dim', align: 'center', depth: 10 });
    const hintText = drawText(this, W / 2, 138, '', { scale: 2, color: 'amber', align: 'center', depth: 10 });
    const subText = drawText(this, W / 2, 156, '', { color: 'foam', align: 'center', depth: 10 });
    const verdict = drawText(this, W / 2, 138, '', { scale: 2, color: 'lime', align: 'center', depth: 10 });
    drawText(this, W / 2, H - 9, 'H oír la nota   S saltar   Esc salir', { color: 'dim', align: 'center', depth: 10 });
    const bug = this.add.sprite(0, 0, 'glowbug').setDepth(6).setScale(2);
    bug.play('glowbug');
    const back = this.add.graphics().setDepth(3);
    const g = this.add.graphics().setDepth(7);
    const showProgress = () => placeText(progress, 8, 26, `${caught + skipped} / ${total}   atrapadas ${caught}`, { color: 'dim' });
    showProgress();

    // ---- input ----
    const kb = this.input.keyboard;
    kb?.on('keydown-S', () => {
      if (!over && index < total) session.skipCurrent();
    });
    kb?.on('keydown-H', () => {
      if (over || index >= total) return;
      hearNote(targetPos(index).midi, session.input.context);
      showName = true;
    });

    // ---- events ----
    let flashAt = -1e9;
    session.on('wrongAttempt', (r) => {
      const heard = r.heard?.[0];
      if (heard === undefined) return;
      const t = targetPos(r.index);
      const where = playedOnBoard(layout, inst, heard, t.pos);
      const d = directionHint(heard, t.midi);
      wrong = { midi: heard, fret: where.pos?.fret ?? null, hint: d.text, name: noteName(heard) };
      wrongPos = where.pos;
    });
    let wrongPos: { string: number; fret: number } | null = null;
    session.on('targetResolved', (r) => {
      const t = targetPos(r.index);
      const x = slotX(layout, t.pos.fret);
      const y = rowY(layout, t.pos.string);
      if (r.judgement === 'hit') {
        caught++;
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          sparks.push({ x, y, vx: Math.cos(a) * (0.5 + (i % 3) * 0.35), vy: Math.sin(a) * (0.5 + (i % 3) * 0.35) - 0.2, born: this.time.now, color: i % 2 ? stringKey(t.pos.string) : 'foam' });
        }
        placeText(verdict, W / 2, 138, '¡ATRAPADA!', { scale: 2, color: 'lime', align: 'center' });
        flashAt = this.time.now;
      } else {
        skipped++;
        placeText(verdict, W / 2, 138, 'Siguiente', { scale: 2, color: 'dim', align: 'center' });
        flashAt = this.time.now;
      }
      index = r.index + 1;
      appearAt = this.time.now;
      wrong = null;
      wrongPos = null;
      showName = false;
      showProgress();
      if (index >= total) over = true;
    });

    // ---- drawing ----
    const redraw = () => {
      const now = this.time.now;
      g.clear();
      back.clear();
      art.nums.forEach((t) => setTextColor(t, 'foam'));
      const live = index < total;
      if (live) {
        const t = targetPos(index);
        const x = slotX(layout, t.pos.fret);
        const y = rowY(layout, t.pos.string);
        const col = stringKey(t.pos.string);
        const fade = Math.min(1, (now - appearAt) / 250);
        const pulse = 0.5 + 0.5 * Math.sin(now / 260);
        cell(back, layout, t.pos.string, t.pos.fret, col, 0.14 + 0.1 * pulse);
        back.fillStyle(paletteInt(col), (0.1 + 0.08 * pulse) * fade).fillCircle(x, y, 13);
        back.fillStyle(paletteInt(col), (0.14 + 0.1 * pulse) * fade).fillCircle(x, y, 8);
        bug.setVisible(true).setTint(paletteInt(col)).setAlpha(fade).setPosition(x, y - 1 + Math.round(Math.sin(now / 300) * 2));
        setTextColor(art.nums.get(t.pos.fret)!, 'lime');
        if (showName) {
          if (nameShown !== t.midi) nameShown = t.midi;
          placeText(subText, W / 2, 156, `Suena ${noteName(t.midi)}  ·  cuerda ${t.pos.string + 1}`, { color: 'cyan', align: 'center' });
        }
      } else bug.setVisible(false);

      if (wrong && live) {
        if (wrongPos) {
          const px = slotX(layout, wrongPos.fret);
          const py = rowY(layout, wrongPos.string);
          ring(g, px, py, 6, 'violet');
          ring(g, px, py, 7, 'violet', 0.5);
          g.fillStyle(paletteInt('violet'), 1).fillRect(px - 1, py - 1, 3, 3);
          setTextColor(art.nums.get(wrongPos.fret)!, 'violet');
        }
        placeText(hintText, W / 2, 138, wrong.hint, { scale: 2, color: 'amber', align: 'center' });
        hintText.setAlpha(1);
        verdict.setAlpha(0);
        placeText(subText, W / 2, 156, wrongPos ? `Tocaste ${wrong.name}: traste ${wrongPos.fret}` : `Tocaste ${wrong.name}: fuera del mástil mostrado`, { color: 'violet', align: 'center' });
      } else {
        hintText.setAlpha(0);
        if (!showName) placeText(subText, W / 2, 156, '', { color: 'foam', align: 'center' });
        const age = now - flashAt;
        verdict.setAlpha(age < 700 ? 1 : age < 1000 ? 1 - (age - 700) / 300 : 0);
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        const age = (now - s.born) / 16;
        if (age > 40) {
          sparks.splice(i, 1);
          continue;
        }
        g.fillStyle(paletteInt(s.color), 1 - age / 40).fillRect(Math.round(s.x + s.vx * age), Math.round(s.y + s.vy * age + age * age * 0.004), 2, 2);
      }

      const t = live ? targetPos(index) : null;
      hooks.fireflies = {
        index,
        total,
        string: t?.pos.string ?? -1,
        fret: t?.pos.fret ?? -1,
        midi: t?.midi ?? -1,
        caught,
        skipped,
        hint: wrong && live ? wrong.hint : '',
        wrongFret: wrong?.fret ?? null,
        targetX: t ? slotX(layout, t.pos.fret) : -1,
        over,
      };
    };
    this.events.on(Phaser.Scenes.Events.UPDATE, redraw);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.UPDATE, redraw);
      hooks.fireflies = null;
    });

    beginGame(this, data);
  }
}
