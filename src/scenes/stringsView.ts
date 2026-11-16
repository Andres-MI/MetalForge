/** Drawing helpers shared by Telar and Portero (Phaser side). */
import { renderPlucks } from '../synth/karplus';
import { STRING_COLOR_KEYS, type PaletteKey } from '../ui/palette';

/** Palette key of a string's fixed colour. */
export const stringKey = (s: number): PaletteKey => STRING_COLOR_KEYS[s % STRING_COLOR_KEYS.length];

/** Points of a quadratic arc from (x0,y0) to (x1,y1) that bulges `bulge` px toward the upper side (for skips). */
export function arcPoints(x0: number, y0: number, x1: number, y1: number, bulge: number, steps = 18): { x: number; y: number }[] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  // Normal with a negative y component (up on screen), whichever way the segment goes.
  let nx = dy / len;
  let ny = -dx / len;
  if (ny > 0 || (ny === 0 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  const cx = (x0 + x1) / 2 + nx * bulge * 2;
  const cy = (y0 + y1) / 2 + ny * bulge * 2;
  const pts: { x: number; y: number }[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const u = 1 - t;
    pts.push({ x: Math.round(u * u * x0 + 2 * u * t * cx + t * t * x1), y: Math.round(u * u * y0 + 2 * u * t * cy + t * t * y1) });
  }
  return pts;
}

let hintCtx: AudioContext | null = null;

/** Plays one plucked note (synth) so the player hears the target. Safe to call without audio support. */
export function playHint(midi: number, ctx?: AudioContext | null): void {
  try {
    const c = ctx ?? hintCtx ?? (hintCtx = new AudioContext());
    void c.resume();
    const samples = renderPlucks([{ time: 0, midi, string: 0 }], { sampleRate: c.sampleRate, duration: 1.6, sustain: 1.2 });
    const buf = c.createBuffer(1, samples.length, c.sampleRate);
    buf.copyToChannel(samples as unknown as Float32Array<ArrayBuffer>, 0);
    const src = c.createBufferSource();
    src.buffer = buf;
    const gain = c.createGain();
    gain.gain.value = 0.7;
    src.connect(gain).connect(c.destination);
    src.start();
  } catch {
    /* no audio output: the visual hint still shows */
  }
}
