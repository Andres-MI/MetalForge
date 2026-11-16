/**
 * Original backing for the boss rooms of Torre and the "oír la escala" key of Escalada, all synthesised here with the
 * plucked-string synth (src/synth/karplus.ts). Nothing is copied from any song: a two-chord drone vamp built from the
 * scale's own root (the first chord on the root, the second a fourth above, two bars each, repeating) with a low root
 * pulse. The soft click comes from the session's metronome.
 * `backingPlan` is pure and tested (every note belongs to the scale); `renderBacking` makes the samples and
 * `playBuffer` sends them to a Web Audio context.
 */
import { renderPlucks, type PluckedNote } from '../../synth/karplus';

export interface BackingPlan {
  bpm: number;
  bars: number;
  /** Seconds the backing lasts (bars x 4 beats). */
  duration: number;
  notes: PluckedNote[];
}

export const BEATS_PER_BAR = 4;

/** Lowest root of the vamp: the pitch class placed in MIDI 36..47 (C2..B2). */
export function vampRoot(rootPc: number): number {
  return 36 + ((((rootPc - 36) % 12) + 12) % 12);
}

export function backingPlan(rootPc: number, bpm: number, bars: number): BackingPlan {
  const spb = 60 / bpm;
  const root = vampRoot(rootPc);
  const notes: PluckedNote[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const chordRoot = root + ((Math.floor(bar / 2) % 2) * 5); // I I IV IV I I IV IV ...
    const t0 = bar * BEATS_PER_BAR * spb;
    // The drone: root and its fifth, ringing the whole bar (each on its own "string" so they sustain together).
    notes.push({ time: t0, midi: chordRoot, string: 0, velocity: 0.8 });
    notes.push({ time: t0, midi: chordRoot + 7, string: 1, velocity: 0.5 });
    notes.push({ time: t0, midi: chordRoot + 12, string: 2, velocity: 0.35 });
    // A soft pulse of the root on beats 3 and the "and" of 4: enough to feel the bar without being a riff.
    notes.push({ time: t0 + 2 * spb, midi: chordRoot, string: 0, velocity: 0.55 });
    notes.push({ time: t0 + 3.5 * spb, midi: chordRoot + 12, string: 2, velocity: 0.3 });
  }
  return { bpm, bars, duration: bars * BEATS_PER_BAR * spb, notes };
}

export function renderBacking(plan: BackingPlan, sampleRate: number): Float32Array {
  return renderPlucks(plan.notes, { sampleRate, duration: plan.duration + 0.5, sustain: 2.2 });
}

/** Plays samples at a context time with the given volume. Fails silently when there is no audio output. */
export function playBuffer(ctx: AudioContext, samples: Float32Array, when: number, volume = 0.5): { stop(): void } {
  try {
    void ctx.resume();
    const buf = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain).connect(ctx.destination);
    src.start(Math.max(when, ctx.currentTime));
    return { stop: () => { try { src.stop(); } catch { /* already stopped */ } } };
  } catch {
    return { stop() {} };
  }
}

export interface RunSound {
  /** Seconds between notes and the whole duration. */
  gap: number;
  duration: number;
}

let own: AudioContext | null = null;

/** "Hear the whole scale": the run played one note after another with the plucked-string synth. */
export function playRun(midis: readonly number[], ctx?: AudioContext | null, gap = 0.34): RunSound {
  const sound: RunSound = { gap, duration: midis.length * gap + 1 };
  if (typeof AudioContext === 'undefined') return sound;
  try {
    const c = ctx ?? (own ??= new AudioContext());
    const sr = c.sampleRate;
    const notes: PluckedNote[] = midis.map((midi, i) => ({ time: 0.02 + i * gap, midi, string: 0, velocity: 0.8 }));
    playBuffer(c, renderPlucks(notes, { sampleRate: sr, duration: sound.duration, sustain: 0.9 }), c.currentTime, 0.7);
  } catch {
    // No audio output: nothing sounds.
  }
  return sound;
}
