/**
 * Writes a WAV with the chords of a Forja exercise (plucked-string synth), each strummed low to high with 12 ms between
 * strings, 3 s apart after 3 s of silence, letting them ring, to be used as the fake microphone:
 *   npx tsx scripts/make-chords-wav.ts <out.wav> [correct|wrong] [level] [seed]
 * `correct` = the chords of the exercise; `wrong` = for each one its nearest wrong neighbour (E for Em, ...).
 * Prints the chords. scripts/chords-audio.cjs fixes the game's seed with the same value (default 424242).
 */
import { writeFileSync } from 'node:fs';
import { generate } from '../src/exercises';
import { encodeWav, renderPlucks, type PluckedNote } from '../src/synth/karplus';
import { nearestWrong, shapeOf } from './bench-chords';

const out = process.argv[2] ?? 'test-results/chords.wav';
const variant = process.argv[3] ?? 'correct';
const level = Number(process.argv[4] ?? 1);
const seed = Number(process.argv[5] ?? 424242);
const lead = 3;
const gap = 3;
const ex = generate('chords', { instrument: 'guitar', level, seed, length: 8 });
const names = ex.targets.map((t) => (t.kind.type === 'chord' ? t.kind.name : '?'));
const played = names.map((n) => (variant === 'wrong' ? nearestWrong(n)[0] : n));
const notes: PluckedNote[] = [];
played.forEach((name, i) => shapeOf(name).forEach((n, k) => notes.push({ time: lead + i * gap + k * 0.012, midi: n.midi, string: n.string, velocity: 0.8 })));
const sr = 48000;
writeFileSync(out, encodeWav(renderPlucks(notes, { sampleRate: sr, duration: lead + played.length * gap + 2, noise: 0.002, sustain: 2.5 }), sr));
console.log(JSON.stringify({ out, variant, level, seed, expected: names, played }));
