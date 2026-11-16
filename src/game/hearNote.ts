/** "Show me": plays one note of the exercise with the plucked-string synth (Web Audio), so the player can hear the target. */
import { renderPlucks } from '../synth/karplus';
let own: AudioContext | null = null;
const cache = new Map<number, AudioBuffer>();

/** Plays `midi` for about a second and a half. Uses the game's context when given, else one of its own. */
export function hearNote(midi: number, context?: AudioContext | null): void {
  try {
    const ctx = context ?? (own ??= new AudioContext());
    void ctx.resume();
    const key = midi * 100000 + ctx.sampleRate;
    let buf = cache.get(key);
    if (!buf) {
      const sr = ctx.sampleRate;
      const data = renderPlucks([{ time: 0.02, midi, string: 0, velocity: 0.8 }], { sampleRate: sr, duration: 1.6, sustain: 1.2 });
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

