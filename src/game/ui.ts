/** Small drawing helpers shared by the game scenes (all on the 320x180 canvas, palette colours only). */
import type Phaser from 'phaser';
import { paletteInt, type PaletteKey } from '../ui/palette';
import type { Judgement } from '../model/exercise';

export function panel(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, border: PaletteKey = 'dim', fill: PaletteKey = 'abyss', alpha = 0.85): void {
  g.fillStyle(paletteInt(fill), alpha).fillRect(x, y, w, h);
  g.lineStyle(1, paletteInt(border), 1).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

const STAR = [
  '....#....',
  '....#....',
  '...###...',
  '#########',
  '.#######.',
  '..#####..',
  '..#####..',
  '.###.###.',
  '.##...##.',
];

/** A 9x9 pixel star; `scale` is the integer pixel size. */
export function star(g: Phaser.GameObjects.Graphics, x: number, y: number, scale: number, color: PaletteKey, alpha = 1): void {
  g.fillStyle(paletteInt(color), alpha);
  STAR.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) if (row[i] === '#') g.fillRect(x + i * scale, y + j * scale, scale, scale);
  });
}
export const STAR_SIZE = 9;

/** "+23 ms", "-8 ms", "0 ms". */
export function fmtMs(ms: number): string {
  const r = Math.round(ms);
  return `${r > 0 ? '+' : ''}${r} ms`;
}

export interface JudgementStyle {
  label: string;
  color: PaletteKey;
}

/** Spanish label and colour of each judgement, shared by every timed game. */
export const JUDGEMENT_STYLE: Record<Judgement, JudgementStyle> = {
  hit: { label: 'A TIEMPO', color: 'lime' },
  early: { label: 'PRONTO', color: 'amber' },
  late: { label: 'TARDE', color: 'magenta' },
  wrong: { label: 'NOTA DISTINTA', color: 'violet' },
  miss: { label: 'SIN GOLPE', color: 'dim' },
};
