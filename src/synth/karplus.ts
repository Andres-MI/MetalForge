/**
 * Plucked-string synthesis (Karplus-Strong with fractional delay). Used to build test audio for the
 * detector and, in the game, to play examples the player should imitate.
 */
import { midiToFreq } from '../model/instrument';

export interface PluckedNote {
  /** Seconds. */
  time: number;
  midi: number;
  /** Notes sharing a string cut each other off; notes on different strings ring together. */
  string: number;
  /** Cents of detuning, to imitate a guitar that is slightly out of tune. */
  detune?: number;
  velocity?: number;
}

/** Deterministic pseudo-random generator so fixtures are reproducible. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RenderOptions {
  sampleRate: number;
  duration: number;
  /** RMS of added white noise (0 = clean). */
  noise?: number;
  seed?: number;
  /** Seconds a note takes to fade to silence, roughly. */
  sustain?: number;
}

export function renderPlucks(notes: PluckedNote[], opts: RenderOptions): Float32Array {
  const { sampleRate, duration } = opts;
  const rand = rng(opts.seed ?? 1);
  const out = new Float32Array(Math.ceil(duration * sampleRate));
  const sorted = [...notes].sort((a, b) => a.time - b.time);

  sorted.forEach((note, idx) => {
    const startSample = Math.round(note.time * sampleRate);
    // The string keeps ringing until the next note on the same string, or until the end.
    const next = sorted.slice(idx + 1).find((n) => n.string === note.string);
    const endSample = Math.min(out.length, next ? Math.round(next.time * sampleRate) : out.length);
    const freq = midiToFreq(note.midi) * Math.pow(2, (note.detune ?? 0) / 1200);
    const period = sampleRate / freq - 0.5; // the averaging filter adds half a sample of delay
    const n = Math.floor(period);
    const frac = period - n;
    const size = n + 2;
    const line = new Float32Array(size);
    const vel = note.velocity ?? 0.8;
    // Excitation: noise burst, lightly low-passed so it sounds like a pick rather than a hiss.
    let lp = 0;
    for (let i = 0; i < size; i++) {
      lp = 0.5 * lp + 0.5 * (rand() * 2 - 1);
      line[i] = lp * vel;
    }
    // Per-period loss chosen so the note fades over `sustain` seconds regardless of pitch.
    const decay = Math.pow(0.001, 1 / ((opts.sustain ?? 2.5) * freq));
    let w = 0;
    let prev = 0;
    for (let s = startSample; s < endSample; s++) {
      const r1 = line[(w + size - n) % size];
      const r2 = line[(w + size - n - 1) % size];
      const y = (1 - frac) * r1 + frac * r2;
      const filtered = decay * 0.5 * (y + prev);
      prev = y;
      line[w] = filtered;
      w = (w + 1) % size;
      out[s] += y;
    }
  });

  const noise = opts.noise ?? 0;
  if (noise > 0) {
    for (let i = 0; i < out.length; i++) out[i] += (rand() * 2 - 1) * noise * Math.SQRT2 * 1.2247;
  }
  // Leave headroom: several strings ringing together must not clip.
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0.95) for (let i = 0; i < out.length; i++) out[i] *= 0.95 / peak;
  return out;
}

/** 16-bit mono WAV. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(bytes.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, Math.round(s * 32767), true);
  }
  return bytes;
}
