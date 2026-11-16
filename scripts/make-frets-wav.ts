/**
 * Writes a WAV with the notes of a Luciérnagas exercise (plucked-string synth), one every `gap` seconds after `lead`
 * seconds of silence, to be used as the fake microphone (the game is untimed, so the spacing is not critical):
 *   npx tsx scripts/make-frets-wav.ts <out.wav> [guitar|bass4|bass5] [level] [seed] [gapSec]
 * Prints the target midis. `scripts/frets-audio.cjs` fixes the game's seed with the same value (default 424242).
 */
import { writeFileSync } from 'node:fs';
import { generate } from '../src/exercises';
import { encodeWav, renderPlucks } from '../src/synth/karplus';

const out = process.argv[2] ?? 'test-results/frets.wav';
const instrument = (process.argv[3] ?? 'guitar') as 'guitar' | 'bass4' | 'bass5';
const level = Number(process.argv[4] ?? 1);
const seed = Number(process.argv[5] ?? 424242);
const gap = Number(process.argv[6] ?? 1.5);
const lead = 3;
const ex = generate('frets', { instrument, level, seed, length: 12 });
const notes = ex.targets.map((t, i) => {
  if (t.kind.type !== 'note') throw new Error('note expected');
  return { time: lead + i * gap, midi: t.kind.midi, string: 0 };
});
const sr = 48000;
writeFileSync(out, encodeWav(renderPlucks(notes, { sampleRate: sr, duration: lead + ex.targets.length * gap + 2, noise: 0.002, sustain: 1.2 }), sr));
console.log(JSON.stringify({ out, instrument, level, seed, midis: notes.map((n) => n.midi) }));
