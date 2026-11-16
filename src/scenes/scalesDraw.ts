/**
 * Drawing shared by Escalada and Torre: the fretboard of a scale position (same horizontal mapping as the strip of
 * Luciérnagas, tighter vertically because a position crosses every string), note marks and small pixel shapes.
 * Layout maths: src/game/scales/board.ts.
 */
import type Phaser from 'phaser';
import { drawText } from '../art/text';
import { INLAYS, rowY, slotX, type BoardLayout } from '../game/frets/board';
import { panel } from '../game/ui';
import { paletteInt, type PaletteKey } from '../ui/palette';
import { stringKey } from './fretsDraw';

export { ring, setTextColor, stringKey } from './fretsDraw';

/** Vertical margin of the strip above the first and below the last string. */
export const BOARD_MARGIN = 7;

export interface ScaleBoardArt {
  /** Fret number labels by fret; recolour them with `setTextColor`. */
  nums: Map<number, Phaser.GameObjects.BitmapText>;
  top: number;
  bottom: number;
  /** y of the top of the fret numbers. */
  numsY: number;
  destroy(): void;
}

/** Strip, nut, fret wires, inlays at 3/5/7/9/12, one coloured line per string and every fret number (always crisp). */
export function drawScaleBoard(scene: Phaser.Scene, l: BoardLayout, opts: { depth?: number } = {}): ScaleBoardArt {
  const depth = opts.depth ?? 2;
  const g = scene.add.graphics().setDepth(depth);
  const top = rowY(l, l.strings[0]) - BOARD_MARGIN;
  const bottom = rowY(l, l.strings[l.strings.length - 1]) + BOARD_MARGIN;
  panel(g, l.left - 3, top, l.slots * l.step + 6, bottom - top, 'water', 'deep', 0.88);
  const midY = Math.round((top + bottom) / 2);
  g.fillStyle(paletteInt('water'), 1);
  for (const f of INLAYS) {
    if (f > l.maxFret) continue;
    const x = slotX(l, f);
    if (f === 12) {
      g.fillRect(x - 5, midY - 1, 3, 3);
      g.fillRect(x + 3, midY - 1, 3, 3);
    } else g.fillRect(x - 1, midY - 1, 3, 3);
  }
  for (let f = 1; f <= l.slots; f++) {
    const x = l.left + f * l.step;
    if (f === 1) g.fillStyle(paletteInt('foam'), 1).fillRect(x - 1, top + 1, 3, bottom - top - 2);
    else g.fillStyle(paletteInt('dim'), 0.8).fillRect(x, top + 1, 1, bottom - top - 2);
  }
  for (const s of l.strings) {
    const y = rowY(l, s);
    g.fillStyle(paletteInt(stringKey(s)), 0.9).fillRect(l.left, y, l.right - l.left, 1);
  }
  const nums = new Map<number, Phaser.GameObjects.BitmapText>();
  const numsY = bottom + 5;
  for (let f = 0; f <= l.maxFret; f++) nums.set(f, drawText(scene, slotX(l, f), numsY, String(f), { color: 'foam', align: 'center', depth: depth + 3 }));
  return {
    nums,
    top,
    bottom,
    numsY,
    destroy() {
      g.destroy();
      nums.forEach((t) => t.destroy());
    },
  };
}

/** A small octagon (5x5, or 7x7 when `big`) centred on x,y. */
export function pip(g: Phaser.GameObjects.Graphics, x: number, y: number, key: PaletteKey, alpha: number, big = false): void {
  g.fillStyle(paletteInt(key), alpha);
  if (big) {
    g.fillRect(x - 2, y - 3, 5, 7);
    g.fillRect(x - 3, y - 2, 7, 5);
  } else {
    g.fillRect(x - 1, y - 2, 3, 5);
    g.fillRect(x - 2, y - 1, 5, 3);
  }
}

/** Diamond outline of radius r (a root note marker). */
export function diamond(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, key: PaletteKey, alpha = 1): void {
  g.fillStyle(paletteInt(key), alpha);
  for (let i = 0; i <= r; i++) {
    g.fillRect(x - r + i, y - i, 1, 1);
    g.fillRect(x + r - i, y - i, 1, 1);
    g.fillRect(x - r + i, y + i, 1, 1);
    g.fillRect(x + r - i, y + i, 1, 1);
  }
}

/** A 7x7 thick cross: the mark of a note outside the scale. */
export function cross(g: Phaser.GameObjects.Graphics, x: number, y: number, key: PaletteKey, alpha = 1): void {
  g.fillStyle(paletteInt(key), alpha);
  for (let i = -3; i <= 3; i++) {
    g.fillRect(x + i, y + i, 2, 1);
    g.fillRect(x + i, y - i, 2, 1);
  }
}

/** Soft highlight behind a position (one string row tall). */
export function slotCell(g: Phaser.GameObjects.Graphics, l: BoardLayout, string: number, fret: number, key: PaletteKey, alpha: number): void {
  const half = Math.floor(l.rowGap / 2);
  g.fillStyle(paletteInt(key), alpha).fillRect(l.left + fret * l.step + 1, rowY(l, string) - half, l.step - 1, l.rowGap);
}
