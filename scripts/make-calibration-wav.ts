/**
 * Writes a WAV of plucks aligned to the calibration metronome, to be used as the fake microphone:
 *   npx tsx scripts/make-calibration-wav.ts <out.wav> [lagMs]
 * The calibration scene puts beat 0 at CAL_BEAT0_AFTER_CAPTURE seconds after the first captured sample,
 * and the test microphone file starts at the first captured sample, so plucks at those times should be
 * measured as ~0 ms offset (plus the chain's own latency). `lagMs` shifts every pluck by that much.
 */
import { writeFileSync } from 'node:fs';
import { CAL_BEAT0_AFTER_CAPTURE, CAL_BPM, CAL_CLICKS, CAL_COUNT_IN } from '../src/game/calibration';
import { encodeWav, renderPlucks } from '../src/synth/karplus';

const out = process.argv[2] ?? 'test-results/calibration.wav';
const lag = Number(process.argv[3] ?? 0) / 1000;
const spb = 60 / CAL_BPM;
const notes = [];
for (let k = -CAL_COUNT_IN; k < CAL_CLICKS; k++) notes.push({ time: CAL_BEAT0_AFTER_CAPTURE + k * spb + lag, midi: 52 + (k & 3), string: 0 });
const sr = 48000;
writeFileSync(out, encodeWav(renderPlucks(notes, { sampleRate: sr, duration: CAL_BEAT0_AFTER_CAPTURE + CAL_CLICKS * spb + 3, noise: 0.002 }), sr));
console.log('escrito', out, 'beat0 =', CAL_BEAT0_AFTER_CAPTURE, 'spb =', spb);
