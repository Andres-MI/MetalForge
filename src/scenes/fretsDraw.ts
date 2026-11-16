/** Drawing of the fretboard strip shared by Luciérnagas and Ninja (layout maths: src/game/frets/board.ts). */
import type Phaser from 'phaser';
import { drawText, setTextColor } from '../art/text';
import { INLAYS, rowY, slotX, type BoardLayout } from '../game/frets/board';
import { panel } from '../game/ui';
import { paletteInt, STRING_COLOR_KEYS, type PaletteKey } from '../ui/palette';

export const stringKey = (string: number): PaletteKey => STRING_COLOR_KEYS[string % STRING_COLOR_KEYS.length];

export interface BoardArt {
  /** Fret number labels by fret; recolour them with `setTextColor`. */
  nums: Map<number, Phaser.GameObjects.BitmapText>;
  /** y of the top and bottom of the strip. */
  top: number;
  bottom: number;
  destroy(): void;
}

/** Draws strip, nut, fret wires, inlays at 3/5/7/9/12, one coloured line per string and the fret numbers (always visible). */
export function drawBoard(scene: Phaser.Scene, l: BoardLayout, opts: { depth?: number; numColor?: PaletteKey } = {}): BoardArt {
  const depth = opts.depth ?? 2;
  const g = scene.add.graphics().setDepth(depth);
  const top = rowY(l, l.strings[0]) - 17;
  const bottom = rowY(l, l.strings[l.strings.length - 1]) + 17;
  panel(g, l.left - 3, top, l.slots * l.step + 6, bottom - top, 'water', 'deep', 0.88);
  // Inlays: between the strings (double dot at 12); on a single string they sit under the line.
  const midY = Math.round((top + bottom) / 2);
  const single = l.strings.length === 1;
  g.fillStyle(paletteInt('water'), 1);
  for (const f of INLAYS) {
    if (f > l.maxFret) continue;
    const x = slotX(l, f);
    if (f === 12) {
      g.fillRect(x - 5, single ? midY + 10 : midY - 1, 3, 3);
      g.fillRect(x + 3, single ? midY + 10 : midY - 1, 3, 3);
    } else g.fillRect(x - 1, single ? midY + 10 : midY - 1, 3, 3);
  }
  // Fret wires and nut.
  for (let f = 1; f <= l.slots; f++) {
    const x = l.left + f * l.step;
    if (f === 1) g.fillStyle(paletteInt('foam'), 1).fillRect(x - 1, top + 1, 3, bottom - top - 2);
    else g.fillStyle(paletteInt('dim'), 0.8).fillRect(x, top + 1, 1, bottom - top - 2);
  }
  // Strings: bright where the zone uses the string, faint beyond its last used fret.
  for (const s of l.strings) {
    const y = rowY(l, s);
    const used = Math.max(...(l.frets.get(s) ?? [0]));
    const xUsed = l.left + (used + 1) * l.step;
    g.fillStyle(paletteInt(stringKey(s)), 1).fillRect(l.left, y, xUsed - l.left, 1);
    if (xUsed < l.right) g.fillStyle(paletteInt(stringKey(s)), 0.25).fillRect(xUsed, y, l.right - xUsed, 1);
  }
  const nums = new Map<number, Phaser.GameObjects.BitmapText>();
  const ny = bottom + 5;
  for (let f = 0; f <= l.maxFret; f++) {
    nums.set(f, drawText(scene, slotX(l, f), ny, String(f), { color: opts.numColor ?? 'foam', align: 'center', depth: depth + 3 }));
  }
  const words: Phaser.GameObjects.BitmapText[] = [];
  words.push(drawText(scene, l.left, ny + 10, '0 = al aire', { color: 'dim', depth: depth + 3 }));
  return {
    nums,
    top,
    bottom,
    destroy() {
      g.destroy();
      nums.forEach((t) => t.destroy());
      words.forEach((t) => t.destroy());
    },
  };
}

/** Soft cell highlight behind a position. */
export function cell(g: Phaser.GameObjects.Graphics, l: BoardLayout, string: number, fret: number, color: PaletteKey, alpha: number): void {
  const x = l.left + fret * l.step;
  const y = rowY(l, string);
  g.fillStyle(paletteInt(color), alpha).fillRect(x + 1, y - 13, l.step - 1, 27);
}

/** Pixel ring (square-ish circle) of radius r around x,y. */
export function ring(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, color: PaletteKey, alpha = 1): void {
  g.lineStyle(1, paletteInt(color), alpha).strokeCircle(x + 0.5, y + 0.5, r);
}

export interface BridgeArt {
  /** Plank numbers by `${string}:${fret}`; recolour them with `setTextColor`. */
  nums: Map<string, Phaser.GameObjects.BitmapText>;
  top: number;
  bottom: number;
  destroy(): void;
}

export const PLANK_H = 15;

/** Ninja's bridge: one plank per position of the zone, numbered like the frets, on the same x as Luciérnagas' board. */
export function drawBridge(scene: Phaser.Scene, l: BoardLayout, depth = 2): BridgeArt {
  const g = scene.add.graphics().setDepth(depth);
  const nums = new Map<string, Phaser.GameObjects.BitmapText>();
  const top = rowY(l, l.strings[0]) - PLANK_H / 2 - 1;
  const bottom = rowY(l, l.strings[l.strings.length - 1]) + PLANK_H / 2 + 1;
  // Posts at both ends and a gate at the nut (between the open plank and fret 1).
  g.fillStyle(paletteInt('dim'), 1).fillRect(l.left - 3, top - 4, 2, bottom - top + 14);
  g.fillRect(l.right + 1, top - 4, 2, bottom - top + 14);
  g.fillStyle(paletteInt('foam'), 0.9).fillRect(l.nutX - 1, top - 2, 2, bottom - top + 4);
  for (const s of l.strings) {
    const y = rowY(l, s);
    for (const f of [...(l.frets.get(s) ?? [])]) {
      const x = l.left + f * l.step;
      g.fillStyle(paletteInt('abyss'), 1).fillRect(x + 1, y - 7, l.step - 1, PLANK_H);
      g.fillStyle(paletteInt('water'), 1).fillRect(x + 1, y - 6, l.step - 2, PLANK_H - 2);
      g.fillStyle(paletteInt(stringKey(s)), 1).fillRect(x + 1, y - 7, l.step - 2, 2);
      g.fillStyle(paletteInt('deep'), 1).fillRect(x + 1, y + 6, l.step - 2, 1);
      nums.set(`${s}:${f}`, drawText(scene, slotX(l, f), y - 3, String(f), { color: 'foam', align: 'center', depth: depth + 3 }));
    }
  }
  return {
    nums,
    top,
    bottom,
    destroy() {
      g.destroy();
      nums.forEach((t) => t.destroy());
    },
  };
}

export { setTextColor };
