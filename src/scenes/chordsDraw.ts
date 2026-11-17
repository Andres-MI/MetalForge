/** Drawing of the chord box shared by Forja and Hechicero (data and text: src/game/chords/diagram.ts). */
import type Phaser from 'phaser';
import { drawText } from '../art/text';
import { chordDiagram, DIAGRAM_ROWS, type ChordDiagram } from '../game/chords/diagram';
import { INLAYS, rowY, slotX, type BoardLayout } from '../game/frets/board';
import { panel } from '../game/ui';
import { paletteInt, type PaletteKey } from '../ui/palette';
import { stringKey } from './fretsDraw';

export interface ChordBoxOptions {
  /** Distance between strings and between fret rows, pixels. */
  sx: number;
  sy: number;
  depth?: number;
  /** Fret numbers at the left, string numbers under the box and finger numbers inside the dots. */
  labels?: boolean;
  /** Radius of the dots. */
  radius?: number;
}

export interface ChordBoxArt {
  diagram: ChordDiagram;
  /** Box rectangle: x of the first string, y of the nut, width and height of the grid. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Where each string's marker is (dot, "o" or "x"), by string index. */
  spot(string: number): { x: number; y: number };
  /** Highlights on the dynamic layer: strings that sounded (lime ring) and tones that did not (pulsing magenta ring). */
  mark(g: Phaser.GameObjects.Graphics, present: number[], missing: number[], t: number): void;
  destroy(): void;
}

/** Draws the box with the nut at (x, y): strings left to right from the lowest, one row per fret. */
export function drawChordBox(scene: Phaser.Scene, name: string, x: number, y: number, o: ChordBoxOptions): ChordBoxArt {
  const d = chordDiagram(name);
  const depth = o.depth ?? 4;
  const r = o.radius ?? Math.max(2, Math.floor(Math.min(o.sx, o.sy) * 0.42));
  const n = d.strings.length;
  const width = (n - 1) * o.sx;
  const height = DIAGRAM_ROWS * o.sy;
  const g = scene.add.graphics().setDepth(depth);
  const texts: Phaser.GameObjects.BitmapText[] = [];
  const sxOf = (s: number) => x + s * o.sx;
  const rowY = (row: number) => y + Math.round((row + 0.5) * o.sy);
  const markY = y - (o.labels ? 7 : 4);

  // Background plate.
  g.fillStyle(paletteInt('abyss'), 0.75).fillRect(x - 5, y - (o.labels ? 14 : 8), width + 10, height + (o.labels ? 14 + 12 : 8 + 3));
  // Fret lines and nut.
  for (let k = 0; k <= DIAGRAM_ROWS; k++) {
    const yy = y + k * o.sy;
    if (k === 0 && d.baseFret === 1) g.fillStyle(paletteInt('foam'), 1).fillRect(x - 1, yy - 1, width + 3, 3);
    else g.fillStyle(paletteInt('dim'), 0.9).fillRect(x, yy, width + 1, 1);
  }
  // Strings in their colour.
  d.strings.forEach((s) => {
    g.fillStyle(paletteInt(stringKey(s.string)), s.state === 'muted' ? 0.35 : 0.95).fillRect(sxOf(s.string), y, 1, height);
  });
  // Barre as a bar behind the dots.
  if (d.barre) {
    const b = d.barre;
    g.fillStyle(paletteInt('foam'), 0.9).fillRect(sxOf(b.from) - r, rowY(b.row) - r, sxOf(b.to) - sxOf(b.from) + 2 * r + 1, 2 * r + 1);
  }
  // Dots, open and muted markers.
  const spots: { x: number; y: number }[] = [];
  d.strings.forEach((s) => {
    const cx = sxOf(s.string);
    if (s.state === 'fret') {
      const cy = rowY(s.row);
      spots.push({ x: cx, y: cy });
      g.fillStyle(paletteInt('abyss'), 1).fillCircle(cx + 0.5, cy + 0.5, r + 1);
      g.fillStyle(paletteInt(stringKey(s.string)), 1).fillCircle(cx + 0.5, cy + 0.5, r);
      if (o.labels && s.finger && r >= 4) texts.push(drawText(scene, cx, cy - 3, String(s.finger), { color: 'abyss', align: 'center', depth: depth + 2 }));
    } else {
      spots.push({ x: cx, y: markY + 3 });
      if (s.state === 'open') {
        g.lineStyle(1, paletteInt(stringKey(s.string)), 1).strokeCircle(cx + 0.5, markY + 3.5, o.labels ? 3 : 2);
      } else {
        const m = o.labels ? 3 : 2;
        g.lineStyle(1, paletteInt('dim'), 1).lineBetween(cx - m, markY + 3 - m, cx + m, markY + 3 + m).lineBetween(cx - m, markY + 3 + m, cx + m, markY + 3 - m);
      }
    }
  });
  if (o.labels) {
    // Fret numbers on the left (the first row says where the box starts when it is not at the nut) and string numbers below.
    for (let k = 0; k < DIAGRAM_ROWS; k++) {
      // Small boxes: rows are too close for four numbers, so only the starting fret is said when it is not the nut.
      if (o.sy < 10 && !(d.baseFret > 1 && k === 0)) continue;
      texts.push(drawText(scene, x - 8, rowY(k) - 3, String(d.baseFret + k), { color: d.baseFret > 1 && k === 0 ? 'lime' : 'dim', align: 'right', depth: depth + 2 }));
    }
    d.strings.forEach((s) => {
      texts.push(drawText(scene, sxOf(s.string), y + height + 4, String(n - s.string), { color: 'dim', align: 'center', depth: depth + 2 }));
    });
  }

  return {
    diagram: d,
    x,
    y,
    width,
    height,
    spot: (string) => spots[string] ?? { x: sxOf(string), y },
    mark(gm, present, missing, t) {
      for (const s of present) {
        const p = spots[s];
        if (p && d.strings[s].state !== 'muted') gm.lineStyle(1, paletteInt('lime'), 1).strokeCircle(p.x + 0.5, p.y + 0.5, r + 2);
      }
      const pulse = 0.55 + 0.45 * Math.sin(t / 110);
      for (const s of missing) {
        const p = spots[s];
        if (!p) continue;
        gm.lineStyle(1, paletteInt('magenta'), pulse).strokeCircle(p.x + 0.5, p.y + 0.5, r + 2);
        gm.lineStyle(1, paletteInt('magenta'), pulse * 0.6).strokeCircle(p.x + 0.5, p.y + 0.5, r + 4);
        // The whole string glows so it is found at once.
        gm.fillStyle(paletteInt('magenta'), 0.22 * pulse).fillRect(sxOf(s) - 1, y, 3, height);
      }
    },
    destroy() {
      g.destroy();
      texts.forEach((tx) => tx.destroy());
    },
  };
}

/** Pixel rune (see game/chords/rune.ts) drawn into `g` at (x, y) with an integer pixel scale. */
export function drawRune(g: Phaser.GameObjects.Graphics, glyph: readonly string[], x: number, y: number, scale: number, color: PaletteKey, alpha = 1): void {
  g.fillStyle(paletteInt(color), alpha);
  glyph.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) if (row[i] === '#') g.fillRect(x + i * scale, y + j * scale, scale, scale);
  });
}

/** A tiny chord box (graphics only, no text) for the enemies' bubbles: nut line, strings in their colours, dots, open and muted marks. */
export function drawMiniChord(g: Phaser.GameObjects.Graphics, name: string, x: number, y: number, sx = 4, sy = 4, alpha = 1): void {
  const d = chordDiagram(name);
  const width = (d.strings.length - 1) * sx;
  g.fillStyle(paletteInt(d.baseFret === 1 ? 'foam' : 'dim'), alpha).fillRect(x - 1, y, width + 3, d.baseFret === 1 ? 2 : 1);
  for (let k = 1; k <= DIAGRAM_ROWS; k++) g.fillStyle(paletteInt('dim'), 0.7 * alpha).fillRect(x, y + k * sy, width + 1, 1);
  d.strings.forEach((s) => {
    const cx = x + s.string * sx;
    g.fillStyle(paletteInt(stringKey(s.string)), (s.state === 'muted' ? 0.3 : 0.8) * alpha).fillRect(cx, y, 1, DIAGRAM_ROWS * sy);
    if (s.state === 'fret') g.fillStyle(paletteInt('foam'), alpha).fillRect(cx - 1, y + s.row * sy + Math.floor(sy / 2) - 1, 3, 3);
    else if (s.state === 'open') g.lineStyle(1, paletteInt(stringKey(s.string)), alpha).strokeRect(cx - 1 + 0.5, y - 5 + 0.5, 2, 2);
    else g.fillStyle(paletteInt('dim'), alpha).fillRect(cx - 1, y - 5, 3, 1).fillRect(cx, y - 6, 1, 3);
  });
}

export interface BassBoardArt {
  nums: Map<number, Phaser.GameObjects.BitmapText>;
  destroy(): void;
}

/** Compact fretboard of a bass chord (Forja): strip, nut, frets, one line per string of the zone and the fret numbers. */
export function drawBassBoard(scene: Phaser.Scene, l: BoardLayout, depth = 2): BassBoardArt {
  const g = scene.add.graphics().setDepth(depth);
  const half = 12;
  const top = rowY(l, l.strings[0]) - half;
  const bottom = rowY(l, l.strings[l.strings.length - 1]) + half;
  panel(g, l.left - 3, top, l.slots * l.step + 6, bottom - top, 'water', 'deep', 0.88);
  const midY = Math.round((top + bottom) / 2);
  g.fillStyle(paletteInt('water'), 1);
  for (const f of INLAYS) if (f <= l.maxFret) g.fillRect(slotX(l, f) - 1, bottom - 4, 3, 2);
  void midY;
  for (let f = 1; f <= l.slots; f++) {
    const x = l.left + f * l.step;
    if (f === 1) g.fillStyle(paletteInt('foam'), 1).fillRect(x - 1, top + 1, 3, bottom - top - 2);
    else g.fillStyle(paletteInt('dim'), 0.8).fillRect(x, top + 1, 1, bottom - top - 2);
  }
  for (const s of l.strings) {
    const y = rowY(l, s);
    g.fillStyle(paletteInt(stringKey(s)), 1).fillRect(l.left, y, l.slots * l.step, 1);
  }
  const nums = new Map<number, Phaser.GameObjects.BitmapText>();
  for (let f = 0; f <= l.maxFret; f++) nums.set(f, drawText(scene, slotX(l, f), bottom + 4, String(f), { color: 'foam', align: 'center', depth: depth + 3 }));
  return {
    nums,
    destroy() {
      g.destroy();
      nums.forEach((t) => t.destroy());
    },
  };
}
