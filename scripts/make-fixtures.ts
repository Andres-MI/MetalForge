/** `npm run fixtures` — writes WAV files used as a fake microphone in browser tests. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { INSTRUMENTS } from '../src/model/instrument';
import { encodeWav, renderPlucks } from '../src/synth/karplus';
import { SR } from './bench-lib';

mkdirSync('tests/fixtures', { recursive: true });
for (const inst of Object.values(INSTRUMENTS)) {
  // Each open string, low to high, two seconds apart.
  const notes = inst.openStrings.map((midi, string) => ({ time: 0.5 + string * 2, midi, string: 0 }));
  const audio = renderPlucks(notes, { sampleRate: SR, duration: 0.5 + notes.length * 2, noise: 0.002 });
  writeFileSync(`tests/fixtures/${inst.id}-open-strings.wav`, encodeWav(audio, SR));
}
console.log('fixtures escritos en tests/fixtures');
