/** "Hear the chord": strums the shape (or plays the bass notes one after another) with the plucked-string synth. */
import { renderPlucks } from '../../synth/karplus';

let own: AudioContext | null = null;
const cache = new Map<string, AudioBuffer>();

/**
 * Plays `midis` (lowest first). `gap` is the delay between notes: 0.012 s strums a chord, about 0.5 s plays bass notes
 * as a sequence. Uses the game's context when given, else one of its own.
 */
export function hearChord(midis: number[], gap: number, context?: AudioContext | null): void {
  try {
    const ctx = context ?? (own ??= new AudioContext());
    void ctx.resume();
    const key = `${midis.join(',')}@${gap}@${ctx.sampleRate}`;
    let buf = cache.get(key);
    if (!buf) {
      const sr = ctx.sampleRate;
      const notes = midis.map((midi, i) => ({ time: 0.02 + i * gap, midi, string: i, velocity: 0.75 }));
      const data = renderPlucks(notes, { sampleRate: sr, duration: 0.02 + midis.length * gap + 1.8, sustain: 1.4 });
      buf = ctx.createBuffer(1, data.length, sr);
      buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
      cache.set(key, buf);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = 0.7;
    src.connect(gain).connect(ctx.destination);
    src.start();
  } catch {
    // No audio output available: the hint just does not sound.
  }
}
