/** Pure sprite maths: character grids to RGBA pixels. No Phaser, so it runs under Node tests. */
import { PALETTE, type PaletteKey } from '../ui/palette';

/** One frame is an array of equal-length strings, one character per pixel. */
export type Frame = readonly string[];
/** Maps a character to a palette KEY NAME (never a raw hex). '.' and ' ' are always transparent. */
export type Legend = Readonly<Record<string, PaletteKey>>;

export interface SpriteDef {
  /** At least one frame; more than one makes an animation. */
  frames: readonly Frame[];
  legend: Legend;
  /** Animation speed in frames per second (default 4). */
  fps?: number;
}

export interface Pixels {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel. */
  data: Uint8ClampedArray;
}

export const TRANSPARENT_CHARS = '. ';

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function frameSize(frame: Frame): { width: number; height: number } {
  return { width: frame[0]?.length ?? 0, height: frame.length };
}

/** Throws a readable error when a frame is ragged or uses a character missing from the legend. */
export function validateFrame(name: string, frame: Frame, legend: Legend): void {
  const { width, height } = frameSize(frame);
  if (width === 0 || height === 0) throw new Error(`${name}: empty frame`);
  frame.forEach((row, y) => {
    if (row.length !== width) throw new Error(`${name}: row ${y} has ${row.length} chars, expected ${width}`);
    for (const ch of row) {
      if (TRANSPARENT_CHARS.includes(ch)) continue;
      if (!(ch in legend)) throw new Error(`${name}: char '${ch}' not in legend`);
      if (!(legend[ch] in PALETTE)) throw new Error(`${name}: '${legend[ch]}' is not a palette key`);
    }
  });
}

export function spriteToPixels(frame: Frame, legend: Legend, name = 'sprite'): Pixels {
  validateFrame(name, frame, legend);
  const { width, height } = frameSize(frame);
  const data = new Uint8ClampedArray(width * height * 4);
  frame.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      const ch = row[x];
      if (TRANSPARENT_CHARS.includes(ch)) continue;
      const [r, g, b] = hexToRgb(PALETTE[legend[ch]]);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  });
  return { width, height, data };
}

/** All frames of a sprite laid side by side in one strip (what becomes the Phaser texture). */
export function spriteStrip(def: SpriteDef, legendOverride: Legend = {}, name = 'sprite'): Pixels {
  const legend = { ...def.legend, ...legendOverride };
  const frames = def.frames.map((f, i) => spriteToPixels(f, legend, `${name}[${i}]`));
  const { width, height } = frames[0];
  const data = new Uint8ClampedArray(width * frames.length * height * 4);
  frames.forEach((fr, i) => {
    if (fr.width !== width || fr.height !== height) throw new Error(`${name}: all frames must have the same size`);
    for (let y = 0; y < height; y++) {
      const src = y * width * 4;
      data.set(fr.data.subarray(src, src + width * 4), (y * width * frames.length + i * width) * 4);
    }
  });
  return { width: width * frames.length, height, data };
}
