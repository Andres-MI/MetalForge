/**
 * Writes a WAV with the right notes of a strings exercise (each on its own string, strings keep ringing), to be
 * the fake microphone of Telar (untimed levels):
 *   npx tsx scripts/make-strings-wav.ts <out.wav> <guitar|bass4|bass5> <level> <seed> [gapSeconds] [firstAtSeconds]
 */
import { writeFileSync } from 'node:fs';
import { generate } from '../src/exercises';
import { targetPositions } from '../src/game/strings';
import type { InstrumentId } from '../src/model/instrument';
import { encodeWav, renderPlucks, type PluckedNote } from '../src/synth/karplus';

const [out = 'test-results/strings.wav', inst = 'guitar', level = '1', seed = '1', gap = '1.5', first = '2.5'] = process.argv.slice(2);
const ex = generate('strings', { instrument: inst as InstrumentId, level: Number(level), seed: Number(seed), length: 16 });
const pos = targetPositions(ex);
const notes: PluckedNote[] = ex.targets.map((t, i) => ({ time: Number(first) + i * Number(gap), midi: t.kind.type === 'note' ? t.kind.midi : 0, string: pos[i].string }));
const sr = 48000;
writeFileSync(out, encodeWav(renderPlucks(notes, { sampleRate: sr, duration: Number(first) + ex.targets.length * Number(gap) + 3, noise: 0.002 }), sr));
console.log('escrito', out, ex.targets.length, 'notas');
