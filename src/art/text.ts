/** Draws text with the bitmap font in any palette colour. All in-game text goes through here. */
import type Phaser from 'phaser';
import { CAP_TOP, measureText } from './font';
import { FONT_KEY } from './textures';
import { paletteInt, type PaletteKey } from '../ui/palette';

export interface TextOptions {
  color?: PaletteKey;
  /** Integer pixel scale (default 1). */
  scale?: number;
  align?: 'left' | 'center' | 'right';
  alpha?: number;
  depth?: number;
}

/** x is the anchor (left, centre or right per `align`); y is the top of the capital letters. */
export function drawText(scene: Phaser.Scene, x: number, y: number, text: string, opts: TextOptions = {}): Phaser.GameObjects.BitmapText {
  const t = scene.add.bitmapText(0, 0, FONT_KEY, text);
  t.setOrigin(0, 0);
  t.setAlpha(opts.alpha ?? 1);
  if (opts.depth !== undefined) t.setDepth(opts.depth);
  placeText(t, x, y, text, opts);
  return t;
}

export function placeText(t: Phaser.GameObjects.BitmapText, x: number, y: number, text: string, opts: TextOptions = {}): void {
  const scale = opts.scale ?? 1;
  const anchor = opts.align === 'center' ? 0.5 : opts.align === 'right' ? 1 : 0;
  t.setText(text);
  t.setScale(scale);
  t.setTint(paletteInt(opts.color ?? 'foam'));
  t.setPosition(Math.round(x - measureText(text) * scale * anchor), Math.round(y - CAP_TOP * scale));
}

export function setTextColor(t: Phaser.GameObjects.BitmapText, color: PaletteKey): void {
  t.setTint(paletteInt(color));
}
